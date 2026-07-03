import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
	getOrCreateSession,
	createTurn,
	getNextTurnNumber,
	saveBlock,
	getTurns,
} from '$lib/server/db';
import {
	assembleDirectorBooks,
	assembleActressBooks,
	assembleCutterBooks,
	ACTRESS_PARAMS,
	DIRECTOR_PARAMS,
} from '$lib/server/books';
import { callModel, streamModel, parseJsonFromText } from '$lib/server/openrouter';

const MARCUS_MODEL = 'thedrummer/cydonia-24b-v4.1';
const DIRECTOR_MODEL = 'deepseek/deepseek-v4-flash';
const ACTRESS_MODEL = 'thedrummer/cydonia-24b-v4.1';
const CUTTER_MODEL = 'deepseek/deepseek-v4-flash';

// Load Marcus persona — "As He Sees It" section only (avoids breaking immersion)
const MARCUS_PERSONA_PATH = '/Users/deepak-macmini/honeybloom/recovery/cernere/quinn/user-ai-profiles/01-marcus-webb-whale.md';
function loadMarcusPrompt(): string {
	const full = readFileSync(MARCUS_PERSONA_PATH, 'utf-8');
	const asHeSees = full.match(/## As He Sees It\n\n([\s\S]*?)(?=\n---)/);
	return asHeSees ? asHeSees[1].trim() : full;
}

function buildConversationTranscript(sessionId: number): string {
	const turns = getTurns(sessionId);
	const lines: string[] = [];
	for (const turn of turns) {
		for (const block of turn.blocks) {
			if (block.type === 'user') {
				lines.push(`Marcus: ${block.content}`);
			} else if (block.type === 'actress') {
				lines.push(`Sophie: ${block.content}`);
			}
		}
	}
	return lines.join('\n');
}

function buildChatHistory(sessionId: number): Array<{ role: 'user' | 'assistant'; content: string }> {
	const turns = getTurns(sessionId);
	const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
	for (const turn of turns) {
		for (const block of turn.blocks) {
			if (block.type === 'user') {
				history.push({ role: 'user', content: block.content });
			} else if (block.type === 'actress') {
				history.push({ role: 'assistant', content: block.content });
			}
		}
	}
	return history;
}

export const POST: RequestHandler = async () => {
	const sessionId = getOrCreateSession();
	const turnNumber = getNextTurnNumber(sessionId);
	const turnId = createTurn(sessionId, turnNumber);

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			function emit(type: string, sender: string, content: string, streaming = false) {
				const event = JSON.stringify({ type, sender, content, turnNumber, streaming });
				controller.enqueue(encoder.encode(`data: ${event}\n\n`));
			}

			function safeSave(turnId: number, type: string, sender: string, content: string): void {
				safeSave(turnId, type, sender, content || '[no output]');
			}

			try {
				// 1. Marcus — generate via Cydonia
				const marcusPrompt = loadMarcusPrompt();
				const chatHistory = buildChatHistory(sessionId);
				const marcusRaw = await callModel(
					MARCUS_MODEL,
					marcusPrompt,
					chatHistory,
					ACTRESS_PARAMS[MARCUS_MODEL] || {}
				);
				const userMessage = marcusRaw.trim();
				safeSave(turnId, 'user', 'Marcus', userMessage);
				emit('user', 'Marcus', userMessage);

				// 2. Director — assemble books, call DeepSeek V4 Flash
				// TODO: stage and pacing should come from TC config file (Hana's studio deliverable)
				const turnContext = {
					turnNumber,
					timestamp: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
					stage: 'Acquaintance',
					pacing: 'Standard',
				};
				const directorBooks = assembleDirectorBooks('deepseek', 'cydonia', turnContext);
				// Director expects a narrative transcript, not chat-format messages
				const priorTranscript = buildConversationTranscript(sessionId);
				const directorInput = priorTranscript
					? `${priorTranscript}\nMarcus: ${userMessage}`
					: `Marcus: ${userMessage}`;

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
					// If JSON parse fails, wrap in a simple object
					directorJson = { direction: directorRaw, environment: '' };
				}

				const directorContent = JSON.stringify(directorJson, null, 2);
				safeSave(turnId, 'director', 'Director', directorContent);
				emit('director', 'Director', directorContent);

				// 3. Sophie — stream via Cydonia
				const actressBooks = assembleActressBooks();
				const sophieMessages = [{ role: 'user' as const, content: JSON.stringify(directorJson) }];

				let sophieContent = '';
				emit('actress', 'Sophie', '', true); // signal streaming start

				for await (const chunk of streamModel(
					ACTRESS_MODEL,
					actressBooks.prompt,
					sophieMessages,
					ACTRESS_PARAMS[ACTRESS_MODEL] || {}
				)) {
					sophieContent += chunk;
					const chunkEvent = JSON.stringify({ type: 'actress_chunk', content: chunk });
					controller.enqueue(encoder.encode(`data: ${chunkEvent}\n\n`));
				}

				safeSave(turnId, 'actress', 'Sophie', sophieContent);
				emit('actress', 'Sophie', sophieContent); // signal streaming complete

				// 4. Cutter — call DeepSeek V4 Flash
				const cutterBooks = assembleCutterBooks('deepseek');
				const cutterMessages = [{
					role: 'user' as const,
					content: `Marcus: ${userMessage}\n\nSophie: ${sophieContent}`,
				}];

				const cutterRaw = await callModel(
					CUTTER_MODEL,
					cutterBooks.prompt,
					cutterMessages,
					DIRECTOR_PARAMS[CUTTER_MODEL] || {}
				);

				let cutterContent: string;
				try {
					const cutterJson = parseJsonFromText(cutterRaw);
					cutterContent = JSON.stringify(cutterJson, null, 2);
				} catch {
					cutterContent = cutterRaw;
				}

				safeSave(turnId, 'cutter', 'Cutter', cutterContent);
				emit('cutter', 'Cutter', cutterContent);

				// 5. Notify Klara via Aether — send turn summary for evaluation
				const klaraSummary = `[Manhattan Turn ${turnNumber}]\n\nMarcus: ${userMessage}\n\nDirector: ${directorContent}\n\nSophie: ${sophieContent}\n\nCutter: ${cutterContent}\n\nPlease evaluate each stage using post_klara_review(turnNumber: ${turnNumber}, stage, feedback).`;
				try {
					await fetch('http://localhost:51730/api/message', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ sender: 'system', room: 'direct-klara', body: klaraSummary }),
					});
				} catch {
					// Aether may be unreachable — non-blocking
				}
				emit('klara_pending', 'System', `Turn ${turnNumber} sent to Klara for evaluation`);

				// Done — pipeline complete, Klara evaluates asynchronously
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
