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
	loadBook,
	loadModelProfile,
	loadCharacterSheet,
	extractFirstTurnInsert,
	buildIdentityHeader,
} from '$lib/server/books-v2';
import type { AgentRole, CharacterName, OnboardingState } from '$lib/server/books-v2';
import { callModel, streamModel } from '$lib/server/openrouter';
import {
	formatTranscript,
	formatMemoryContext,
	mergeForDirectorUser,
	parseDirectorOutput,
	mergeDirectorToPerformer,
	mergeForDirectorCharacter,
	mergeForCutter,
	parseCutterOutput,
} from '$lib/server/merge';
import type { PipelineContext, MergeMeta } from '$lib/server/merge';

// --- Configuration ---

export interface AgentWindows {
	director: number;
	actress: number;
	reviewer: number;
	cutter: number;
	archivist: number;
	directorUser: number;
	actorUser: number;
}

const DEFAULT_WINDOWS: AgentWindows = {
	director: 20,
	actress: 5,
	reviewer: 5,
	cutter: 20,
	archivist: 20,
	directorUser: 20,
	actorUser: 5,
};

export interface PipelineConfig {
	sessionId?: number;
	characterName: CharacterName;
	userInfo: OnboardingState & { characterDisplayName?: string };
	mode: 'production' | 'fixture';
	windows?: Partial<AgentWindows>;
	models?: Partial<ModelConfig>;
}

interface ModelConfig {
	director: string;
	actress: string;
	reviewer: string;
	cutter: string;
	archivist: string;
}

const DEFAULT_MODELS: ModelConfig = {
	director: 'deepseek/deepseek-v4-flash',
	actress: 'nousresearch/hermes-4-70b',
	reviewer: 'deepseek/deepseek-v4-flash',
	cutter: 'deepseek/deepseek-v4-flash',
	archivist: 'deepseek/deepseek-v4-flash',
};

const ACTRESS_PARAMS: Record<string, Record<string, number | string>> = {
	'nousresearch/hermes-4-70b': {
		temperature: 0.8, top_p: 0.95, top_k: 20,
		repetition_penalty: 1.1, max_tokens: 320,
	},
};

const DIRECTOR_PARAMS: Record<string, Record<string, number | string>> = {
	'deepseek/deepseek-v4-flash': { temperature: 0.3, top_p: 1.0, max_tokens: 500, reasoning_effort: 'none' },
};

// --- Pipeline Events ---

export type PipelineEvent =
	| { type: 'stage'; stage: string; content: string; model: string; meta?: MergeMeta; attempt?: number }
	| { type: 'generating'; stage: string }
	| { type: 'retry'; stage: string; attempt: number; fault: string }
	| { type: 'fallback'; stage: string; content: string; reason: string }
	| { type: 'warning'; stage: string; error: string; reviewed?: boolean }
	| { type: 'archivist-queued'; trigger: string }
	| { type: 'summary'; turnNumber: number; totalStages: number; retries: number; meta: Record<string, MergeMeta> }
	| { type: 'error'; content: string }
	| { type: 'done'; turnNumber: number };

// --- Prompt Assembly ---

function assembleSystemPrompt(role: AgentRole, characterName: CharacterName, models: ModelConfig): string {
	const bookText = loadBook(role);

	const modelKey = role === 'director-user' ? models.director
		: role === 'actor-user' ? models.actress
		: models[role as keyof ModelConfig];
	const profile = loadModelProfile(role, modelKey);

	let prompt = bookText;
	if (profile) prompt += '\n\n' + profile;

	return prompt;
}

function assembleActressPrompt(
	characterName: CharacterName,
	onboarding: OnboardingState,
	models: ModelConfig,
): { cached: string; identityHeader: string } {
	const bookText = loadBook('actress');
	const profile = loadModelProfile('actress', models.actress);
	const sheet = loadCharacterSheet(characterName);

	let cached = bookText;
	if (profile) cached += '\n\n' + profile;
	cached += '\n\n' + sheet.voiceBlock;

	const identityHeader = buildIdentityHeader(characterName, onboarding);

	return { cached, identityHeader };
}

// --- Core Orchestrator ---

export async function* runPipeline(config: PipelineConfig): AsyncGenerator<PipelineEvent> {
	const windows = { ...DEFAULT_WINDOWS, ...config.windows };
	const models = { ...DEFAULT_MODELS, ...config.models };
	const sessionId = config.sessionId ?? getOrCreateSession();
	const turnNumber = getNextTurnNumber(sessionId);
	const sheet = loadCharacterSheet(config.characterName);
	const allMeta: Record<string, MergeMeta> = {};
	let retryCount = 0;

	try {
		// --- Context assembly ---
		const recentMessages = getRecentMessages(sessionId, windows.director);
		const transcript = formatTranscript(recentMessages);
		const memories = getMemory(sessionId);
		const memoryContext = formatMemoryContext(memories);
		const lastCharacterMessage = recentMessages
			.filter(m => m.sender !== 'Marcus')
			.pop();

		const ctx: PipelineContext = {
			memoryContext,
			transcript,
			lastSophieMessage: lastCharacterMessage?.content ?? null,
		};

		let userMessage = '';

		// === Fixture mode: user-side calls ===
		if (config.mode === 'fixture') {
			// Call 1: Director-for-User
			const dirUserPrompt = assembleSystemPrompt('director-user', config.characterName, models);
			const dirUserMerge = mergeForDirectorUser(ctx);
			allMeta['director-user'] = dirUserMerge.meta;

			const dirUserRaw = await callModel(
				models.director,
				dirUserPrompt,
				[{ role: 'user', content: dirUserMerge.value }],
				DIRECTOR_PARAMS[models.director] || {},
			);

			const dirUserResult = parseDirectorOutput(dirUserRaw);
			const dirUserContent = dirUserResult.refused
				? `[REFUSED] ${dirUserResult.raw}`
				: JSON.stringify({ direction: dirUserResult.direction, environment: dirUserResult.environment }, null, 2);

			savePipelineOutput(sessionId, turnNumber, 'director-for-user', models.director, dirUserContent);
			yield { type: 'stage', stage: 'director-for-user', content: dirUserContent, model: models.director, meta: dirUserMerge.meta };

			if (dirUserResult.refused) {
				savePipelineOutput(sessionId, turnNumber, 'actor-for-user', models.actress, '[SKIPPED: Director refused]');
				yield { type: 'stage', stage: 'actor-for-user', content: '[SKIPPED: Director refused]', model: models.actress };
				yield { type: 'done', turnNumber };
				return;
			}

			// Call 2: Actor-for-User
			const actorMerge = mergeDirectorToPerformer(dirUserResult);
			if (typeof actorMerge.value === 'object' && actorMerge.value.refused) {
				yield { type: 'done', turnNumber };
				return;
			}

			const actorPrompt = assembleSystemPrompt('actor-user', config.characterName, models);
			const actorRaw = await callModel(
				models.actress,
				actorPrompt,
				[{ role: 'user', content: actorMerge.value as string }],
				ACTRESS_PARAMS[models.actress] || {},
			);

			userMessage = actorRaw.trim();
			saveMessage(sessionId, turnNumber, 'Marcus', userMessage);
			savePipelineOutput(sessionId, turnNumber, 'actor-for-user', models.actress, userMessage);
			yield { type: 'stage', stage: 'actor-for-user', content: userMessage, model: models.actress, meta: actorMerge.meta };
			allMeta['actor-for-user'] = actorMerge.meta;
		}

		// === Call 3: Director-for-Character ===
		const directorPrompt = assembleSystemPrompt('director', config.characterName, models);
		const directorCtx: PipelineContext = config.mode === 'fixture'
			? { ...ctx, transcript: formatTranscript(getRecentMessages(sessionId, windows.director)) }
			: ctx;

		// In production mode, user's message is already in DB
		if (config.mode === 'production') {
			const latestMessages = getRecentMessages(sessionId, 1);
			userMessage = latestMessages[latestMessages.length - 1]?.content ?? '';
		}

		const directorMerge = mergeForDirectorCharacter(directorCtx, userMessage);

		allMeta['director'] = directorMerge.meta;

		// Check first-turn insert
		const hasHistory = memories.length > 0;
		let directorTrayAddition = '';
		if (!hasHistory) {
			const directorBookText = loadBook('director');
			directorTrayAddition = extractFirstTurnInsert(directorBookText);
		}

		const directorUserContent = directorTrayAddition
			? directorMerge.value + '\n\n' + directorTrayAddition
			: directorMerge.value;

		const directorRaw = await callModel(
			models.director,
			directorPrompt,
			[{ role: 'user', content: directorUserContent }],
			DIRECTOR_PARAMS[models.director] || {},
		);

		const directorResult = parseDirectorOutput(directorRaw);
		const directorContent = directorResult.refused
			? `[REFUSED] ${directorResult.raw}`
			: JSON.stringify({ direction: directorResult.direction, environment: directorResult.environment }, null, 2);

		savePipelineOutput(sessionId, turnNumber, 'director-for-character', models.director, directorContent);
		yield { type: 'stage', stage: 'director-for-character', content: directorContent, model: models.director, meta: directorMerge.meta };

		if (directorResult.refused) {
			savePipelineOutput(sessionId, turnNumber, 'actress-for-character', models.actress, '[SKIPPED: Director refused]');
			yield { type: 'stage', stage: 'actress-for-character', content: '[SKIPPED: Director refused]', model: models.actress };
			yield { type: 'done', turnNumber };
			return;
		}

		// === Call 4: Actress-for-Character (buffered) + Reviewer loop ===
		const actressMerge = mergeDirectorToPerformer(directorResult);
		if (typeof actressMerge.value === 'object' && actressMerge.value.refused) {
			yield { type: 'done', turnNumber };
			return;
		}

		const { cached: actressCached, identityHeader } = assembleActressPrompt(
			config.characterName, config.userInfo, models,
		);

		const actressSystemPrompt = actressCached;

		// Actress dialogue uses trimmed window
		const actressMessages = getRecentMessages(sessionId, windows.actress);
		const actressDialogue = formatTranscript(actressMessages);
		const actressUserContent = [
			identityHeader,
			actressDialogue,
			actressMerge.value as string,
		].filter(Boolean).join('\n\n');

		let characterResponse = await generateActressBuffered(
			models.actress, actressSystemPrompt, actressUserContent,
		);

		allMeta['actress'] = actressMerge.meta;

		// Reviewer evaluation (best-effort per Decision 2B)
		let reviewPassed = false;
		let reviewAttempt = 0;

		try {
			const reviewerPrompt = assembleSystemPrompt('reviewer', config.characterName, models);
			const reviewInput = buildReviewerInput(characterResponse, directorContent, actressDialogue, sheet);

			const reviewRaw = await callModel(
				models.reviewer,
				reviewerPrompt,
				[{ role: 'user', content: reviewInput }],
				DIRECTOR_PARAMS[models.reviewer] || {},
			);

			const verdict = parseReviewerVerdict(reviewRaw);
			reviewAttempt = 1;

			if (verdict.verdict === 'pass') {
				if (verdict.edits) characterResponse = verdict.edits;
				reviewPassed = true;
			} else if (verdict.verdict === 'reject') {
				yield { type: 'retry', stage: 'reviewer', attempt: 1, fault: verdict.fault ?? 'performance' };
				retryCount++;

				let retryDirection = actressMerge.value as string;
				if (verdict.fault === 'brief') {
					// Re-run Director
					const dirRetryRaw = await callModel(
						models.director, directorPrompt,
						[{ role: 'user', content: directorUserContent }],
						DIRECTOR_PARAMS[models.director] || {},
					);
					const dirRetryResult = parseDirectorOutput(dirRetryRaw);
					if (!dirRetryResult.refused) {
						const dirRetryMerge = mergeDirectorToPerformer(dirRetryResult);
						if (typeof dirRetryMerge.value === 'string') retryDirection = dirRetryMerge.value;
					}
				} else {
					retryDirection += `\n\n[RETRY DIRECTION: ${verdict.reason ?? 'performance issue'}]`;
				}

				// Re-run Actress
				characterResponse = await generateActressBuffered(
					models.actress, actressSystemPrompt,
					actressDialogue ? actressDialogue + '\n\n' + retryDirection : retryDirection,
				);

				// Second review
				const review2Input = buildReviewerInput(characterResponse, directorContent, actressDialogue, sheet, true);
				const review2Raw = await callModel(
					models.reviewer, reviewerPrompt,
					[{ role: 'user', content: review2Input }],
					DIRECTOR_PARAMS[models.reviewer] || {},
				);

				const verdict2 = parseReviewerVerdict(review2Raw);
				reviewAttempt = 2;

				if (verdict2.verdict === 'pass') {
					if (verdict2.edits) characterResponse = verdict2.edits;
					reviewPassed = true;
				} else {
					// Double rejection → fallback
					const fallbackLine = sheet.fallbackPool[Math.floor(Math.random() * sheet.fallbackPool.length)]
						?? '[fallback unavailable]';
					characterResponse = fallbackLine;
					retryCount++;
					yield { type: 'fallback', stage: 'actress-for-character', content: fallbackLine, reason: verdict2.reason ?? 'double rejection' };
				}
			}
		} catch (reviewErr) {
			// Decision 2B: deliver Actress response with quality-flag
			const errMsg = reviewErr instanceof Error ? reviewErr.message : String(reviewErr);
			yield { type: 'warning', stage: 'reviewer', error: errMsg, reviewed: false };
		}

		// Save final response
		saveMessage(sessionId, turnNumber, config.characterName, characterResponse);
		savePipelineOutput(sessionId, turnNumber, 'actress-for-character', models.actress, characterResponse);
		yield {
			type: 'stage', stage: 'actress-for-character', content: characterResponse,
			model: models.actress, meta: actressMerge.meta,
			attempt: reviewAttempt > 1 ? reviewAttempt : undefined,
		};

		// === Call 5: Cutter ===
		try {
			const cutterPrompt = assembleSystemPrompt('cutter', config.characterName, models);
			const cutterMerge = mergeForCutter(memoryContext, userMessage || '', characterResponse);
			allMeta['cutter'] = cutterMerge.meta;

			const cutterRaw = await callModel(
				models.cutter, cutterPrompt,
				[{ role: 'user', content: cutterMerge.value }],
				DIRECTOR_PARAMS[models.cutter] || {},
			);

			const cutterResult = parseCutterOutput(cutterRaw);
			let cutterContent: string;

			if (cutterResult.parsed) {
				cutterContent = JSON.stringify({
					tier_1: cutterResult.tier_1,
					tier_2: cutterResult.tier_2,
					emotion_echo: cutterResult.emotion_echo,
					rolling_arc_summary: cutterResult.rolling_arc_summary,
				}, null, 2);

				if (cutterResult.tier_1) saveMemory(sessionId, 'tier1', JSON.stringify(cutterResult.tier_1), turnNumber);
				if (cutterResult.tier_2) saveMemory(sessionId, 'tier2', JSON.stringify(cutterResult.tier_2), turnNumber);
				if (cutterResult.emotion_echo) saveMemory(sessionId, 'emotion_echo', cutterResult.emotion_echo, turnNumber);
				if (cutterResult.rolling_arc_summary) saveMemory(sessionId, 'rolling_arc', cutterResult.rolling_arc_summary, turnNumber);

				// Archivist trigger check (stubbed persistence per Decision 1A)
				if (hasEpisodeBoundary(cutterRaw)) {
					yield { type: 'archivist-queued', trigger: 'episode_boundary' };
				}
			} else {
				cutterContent = cutterResult.raw || '[no output]';
			}

			savePipelineOutput(sessionId, turnNumber, 'artisan-cutter', models.cutter, cutterContent);
			yield { type: 'stage', stage: 'artisan-cutter', content: cutterContent, model: models.cutter, meta: cutterMerge.meta };
		} catch (cutterErr) {
			const errMsg = cutterErr instanceof Error ? cutterErr.message : String(cutterErr);
			yield { type: 'warning', stage: 'cutter', error: errMsg };
		}

		// === Summary ===
		yield {
			type: 'summary', turnNumber,
			totalStages: config.mode === 'fixture' ? 7 : 5,
			retries: retryCount, meta: allMeta,
		};
		yield { type: 'done', turnNumber };

	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		yield { type: 'error', content: msg };
	}
}

// --- Helpers ---

async function generateActressBuffered(
	model: string,
	systemPrompt: string,
	userContent: string,
): Promise<string> {
	let buffer = '';
	for await (const chunk of streamModel(
		model, systemPrompt,
		[{ role: 'user', content: userContent }],
		ACTRESS_PARAMS[model] || {},
	)) {
		buffer += chunk;
	}
	return buffer.trim();
}

interface ReviewerVerdict {
	verdict: 'pass' | 'reject';
	fault?: 'performance' | 'brief';
	reason?: string;
	edits?: string;
	check?: number;
}

function parseReviewerVerdict(raw: string): ReviewerVerdict {
	try {
		let cleaned = raw.trim();
		if (cleaned.startsWith('```')) {
			cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
		}
		const parsed = JSON.parse(cleaned) as Record<string, unknown>;
		return {
			verdict: parsed.verdict === 'reject' ? 'reject' : 'pass',
			fault: parsed.fault === 'brief' ? 'brief' : parsed.fault === 'performance' ? 'performance' : undefined,
			reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
			edits: typeof parsed.edited_text === 'string' ? parsed.edited_text : undefined,
			check: typeof parsed.check === 'number' ? parsed.check : undefined,
		};
	} catch {
		throw new Error('Reviewer returned unparseable output');
	}
}

function hasEpisodeBoundary(raw: string): boolean {
	try {
		let cleaned = raw.trim();
		if (cleaned.startsWith('```')) {
			cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
		}
		const parsed = JSON.parse(cleaned) as Record<string, unknown>;
		const boundary = parsed.episode_boundary as Record<string, unknown> | undefined;
		return boundary?.detected === true;
	} catch {
		return false;
	}
}

// Reviewer tray items 4-5 (checks list, precomputed mismatches) require refusal taxonomy -- deferred to D11 session
function buildReviewerInput(
	actressResponse: string,
	directorBrief: string,
	dialogue: string,
	sheet: ReturnType<typeof loadCharacterSheet>,
	isSecondReview = false,
): string {
	const parts: string[] = [];
	if (dialogue) parts.push(`RECENT DIALOGUE:\n${dialogue}`);
	parts.push(`DIRECTOR'S BRIEF:\n${directorBrief}`);
	const canonSections = [
		sheet.canon.lifeFacts, sheet.canon.backstory, sheet.canon.sensitivities,
		sheet.canon.wantsAndFears, sheet.canon.eroticSelf,
	].filter(Boolean).join('\n\n');
	parts.push(`CHARACTER SHEET:\n${canonSections}\n\nCASTING:\n${sheet.casting}`);
	parts.push(`ACTRESS'S REPLY:\n${actressResponse}`);
	if (isSecondReview) parts.push('[SECOND AND FINAL REVIEW]');
	return parts.join('\n\n');
}
