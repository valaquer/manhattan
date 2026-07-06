import type { RequestHandler } from './$types';
import {
	getOrCreateSession,
	getNextTurnNumber,
	saveMessage,
	savePipelineOutput,
	saveMemory,
	getMemory,
	getRecentMessages,
} from '$lib/server/db';
import {
	assembleDirectorBooks,
	assembleActressBooks,
	assembleCutterBooks,
	assembleUserDirectorBooks,
	assembleActorForUserBooks,
	ACTRESS_PARAMS,
	DIRECTOR_PARAMS,
} from '$lib/server/books';
import { callModel, streamModel, parseJsonFromText } from '$lib/server/openrouter';

const DIRECTOR_MODEL = 'deepseek/deepseek-v4-flash';
const ACTRESS_MODEL = 'thedrummer/cydonia-24b-v4.1';
const CUTTER_MODEL = 'deepseek/deepseek-v4-flash';

function buildTranscriptFromMessages(messages: Array<{ sender: string; content: string }>): string {
	return messages.map((m) => `${m.sender}: ${m.content}`).join('\n');
}

function buildMemoryContext(sessionId: number): string {
	const memories = getMemory(sessionId);
	if (memories.length === 0) return '';
	return memories.map((m) => `[${m.type} | turn ${m.turn_updated}] ${m.content}`).join('\n');
}

export const POST: RequestHandler = async () => {
	const sessionId = getOrCreateSession();
	const turnNumber = getNextTurnNumber(sessionId);

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			function emit(type: string, sender: string, content: string, streaming = false) {
				const event = JSON.stringify({ type, sender, content, turnNumber, streaming });
				controller.enqueue(encoder.encode(`data: ${event}\n\n`));
			}

			try {
				const turnContext = {
					turnNumber,
					timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
					stage: 'Acquaintance',
					pacing: 'Standard',
				};

				const recentMessages = getRecentMessages(sessionId, 20);
				const transcript = buildTranscriptFromMessages(recentMessages);
				const memoryContext = buildMemoryContext(sessionId);

				// === Call 1: Director-for-User ===
				const userDirectorBooks = assembleUserDirectorBooks(turnContext);
				const lastSophieMessage = recentMessages.filter((m) => m.sender === 'Sophie').pop();
				const userDirectorInput = [
					memoryContext ? `ACCUMULATED MEMORY:\n${memoryContext}\n\n` : '',
					transcript ? `CONVERSATION HISTORY:\n${transcript}\n\n` : '',
					lastSophieMessage ? `Sophie just said: ${lastSophieMessage.content}` : 'This is the start of the conversation.',
				].join('');

				const userDirectorRaw = await callModel(
					DIRECTOR_MODEL,
					userDirectorBooks.prompt,
					[{ role: 'user', content: userDirectorInput }],
					DIRECTOR_PARAMS[DIRECTOR_MODEL] || {}
				);

				let userDirectorJson: { direction: string; environment: string };
				try {
					userDirectorJson = parseJsonFromText(userDirectorRaw) as { direction: string; environment: string };
				} catch {
					userDirectorJson = { direction: userDirectorRaw, environment: '' };
				}

				const userDirectorContent = JSON.stringify(userDirectorJson, null, 2);
				savePipelineOutput(sessionId, turnNumber, 'director-for-user', DIRECTOR_MODEL, userDirectorContent);
				emit('director-for-user', 'Director for User', userDirectorContent);

				// === Call 2: Actor-for-User (Marcus) ===
				const actorBooks = assembleActorForUserBooks();
				const marcusRaw = await callModel(
					ACTRESS_MODEL,
					actorBooks.prompt,
					[{ role: 'user', content: JSON.stringify(userDirectorJson) }],
					ACTRESS_PARAMS[ACTRESS_MODEL] || {}
				);

				const marcusMessage = marcusRaw.trim();
				saveMessage(sessionId, turnNumber, 'Marcus', marcusMessage);
				savePipelineOutput(sessionId, turnNumber, 'actor-for-user', ACTRESS_MODEL, marcusMessage);
				emit('actor-for-user', 'Actor for User', marcusMessage);

				// === Call 3: Director-for-Character ===
				const directorBooks = assembleDirectorBooks('deepseek', 'cydonia', turnContext);
				const directorInput = [
					memoryContext ? `ACCUMULATED MEMORY:\n${memoryContext}\n\n` : '',
					transcript ? `CONVERSATION HISTORY:\n${transcript}\n\n` : '',
					`Marcus just said: ${marcusMessage}`,
				].join('');

				const directorRaw = await callModel(
					DIRECTOR_MODEL,
					directorBooks.prompt,
					[{ role: 'user', content: directorInput }],
					DIRECTOR_PARAMS[DIRECTOR_MODEL] || {}
				);

				let directorJson: { direction: string; environment: string };
				try {
					directorJson = parseJsonFromText(directorRaw) as { direction: string; environment: string };
				} catch {
					directorJson = { direction: directorRaw, environment: '' };
				}

				const directorContent = JSON.stringify(directorJson, null, 2);
				savePipelineOutput(sessionId, turnNumber, 'director-for-character', DIRECTOR_MODEL, directorContent);
				emit('director-for-character', 'Director for Character', directorContent);

				// === Call 4: Actress-for-Character (Sophie) — streaming ===
				const actressBooks = assembleActressBooks();
				let sophieContent = '';
				emit('actress-for-character', 'Actress for Character', '', true);

				for await (const chunk of streamModel(
					ACTRESS_MODEL,
					actressBooks.prompt,
					[{ role: 'user', content: JSON.stringify(directorJson) }],
					ACTRESS_PARAMS[ACTRESS_MODEL] || {}
				)) {
					sophieContent += chunk;
					const chunkEvent = JSON.stringify({ type: 'actress_chunk', content: chunk });
					controller.enqueue(encoder.encode(`data: ${chunkEvent}\n\n`));
				}

				saveMessage(sessionId, turnNumber, 'Sophie', sophieContent);
				savePipelineOutput(sessionId, turnNumber, 'actress-for-character', ACTRESS_MODEL, sophieContent);
				emit('actress-for-character', 'Actress for Character', sophieContent);

				// === Call 5: Artisan Cutter ===
				const cutterBooks = assembleCutterBooks('deepseek');
				const priorMemory = memoryContext ? `PRIOR EXTRACTIONS:\n${memoryContext}\n\n` : '';
				const cutterInput = `${priorMemory}CURRENT TURN:\nMarcus: ${marcusMessage}\n\nSophie: ${sophieContent}`;

				const cutterRaw = await callModel(
					CUTTER_MODEL,
					cutterBooks.prompt,
					[{ role: 'user', content: cutterInput }],
					DIRECTOR_PARAMS[CUTTER_MODEL] || {}
				);

				let cutterContent: string;
				try {
					const cutterJson = parseJsonFromText(cutterRaw);
					cutterContent = JSON.stringify(cutterJson, null, 2);

					// Persist Cutter extractions to memory table
					const cj = cutterJson as Record<string, unknown>;
					if (cj.tier_1) saveMemory(sessionId, 'tier1', JSON.stringify(cj.tier_1), turnNumber);
					if (cj.tier_2) saveMemory(sessionId, 'tier2', JSON.stringify(cj.tier_2), turnNumber);
					if (cj.emotion_echo) saveMemory(sessionId, 'emotion_echo', String(cj.emotion_echo), turnNumber);
					if (cj.rolling_arc_summary) saveMemory(sessionId, 'rolling_arc', String(cj.rolling_arc_summary), turnNumber);
				} catch {
					cutterContent = cutterRaw;
				}

				savePipelineOutput(sessionId, turnNumber, 'artisan-cutter', CUTTER_MODEL, cutterContent);
				emit('artisan-cutter', 'Artisan Cutter', cutterContent);

				// === Klara notification (async, non-blocking) ===
				const turnSummary = `[Manhattan Turn ${turnNumber}]\n\nDirector for User: ${userDirectorContent}\n\nActor for User (Marcus): ${marcusMessage}\n\nDirector for Character: ${directorContent}\n\nActress for Character (Sophie): ${sophieContent}\n\nArtisan Cutter: ${cutterContent}`;
				try {
					await fetch('http://localhost:51730/api/message', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ sender: 'system', room: 'huddle-hana', body: turnSummary }),
					});
				} catch {
					// Aether may be unreachable — non-blocking
				}
				emit('notification', 'System', `Turn ${turnNumber} sent to Hana's huddle`);

				controller.enqueue(encoder.encode('data: [DONE]\n\n'));
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				const errorEvent = JSON.stringify({ type: 'error', content: msg });
				controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`));
			} finally {
				controller.close();
			}
		},
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
		},
	});
};
