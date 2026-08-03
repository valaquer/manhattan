// --- Types ---

export interface PipelineContext {
	memoryContext: string;
	transcript: string;
	lastSophieMessage: string | null;
}

export interface DirectorOutput {
	refused: false;
	world: unknown;
	scene: unknown;
	checks: unknown[];
	strategy: string;
}

export interface DirectorRefusal {
	refused: true;
	raw: string;
}

export type DirectorResult = DirectorOutput | DirectorRefusal;

export interface CutterParsed {
	parsed: true;
	operations: unknown[] | null;
	emotion_echo: string | null;
	rolling_arc_update: string | null;
	rolling_arc_summary: string | null;
}

export interface CutterUnparsed {
	parsed: false;
	raw: string;
}

export type CutterResult = CutterParsed | CutterUnparsed;

export interface MergeMeta {
	inputChars: number;
	memoryIncluded: boolean;
	transcriptTurns: number;
	sourceStages: string[];
}

export interface MergeResult<T> {
	value: T;
	meta: MergeMeta;
}

// --- Refusal detection ---

const REFUSAL_PREFIXES = [
	'i cannot',
	'i can\'t',
	'i\'m sorry, i can\'t',
	'i\'m sorry, i cannot',
	'i am sorry, i cannot',
	'i\'m unable to',
	'i am unable to',
	'as an ai',
];

function isRefusal(text: string): boolean {
	if (!text || text.trim().length === 0) return true;
	const lower = text.trim().toLowerCase();
	return REFUSAL_PREFIXES.some(prefix => lower.startsWith(prefix));
}

// --- JSON parsing (copied from openrouter.ts to avoid $env dependency) ---

function parseJsonFromText(text: string): unknown {
	let cleaned = text.trim();
	if (cleaned.startsWith('```')) {
		cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
	}
	return JSON.parse(cleaned);
}

// --- Formatters ---

export function formatTranscript(messages: Array<{ sender: string; content: string }>): string {
	return messages.map(m => `${m.sender}: ${m.content}`).join('\n');
}

export function formatMemoryContext(memories: Array<{ type: string; content: string; turn_updated: number }>): string {
	if (memories.length === 0) return '';
	return memories.map(m => `[${m.type} | turn ${m.turn_updated}] ${m.content}`).join('\n');
}

// --- Merge functions ---

export function mergeForDirectorUser(ctx: PipelineContext): MergeResult<string> {
	const parts: string[] = [];

	if (ctx.memoryContext) {
		parts.push(`ACCUMULATED MEMORY:\n${ctx.memoryContext}\n\n`);
	}
	if (ctx.transcript) {
		parts.push(`CONVERSATION HISTORY:\n${ctx.transcript}\n\n`);
	}
	parts.push(
		ctx.lastSophieMessage
			? `Sophie just said: ${ctx.lastSophieMessage}`
			: 'This is the start of the conversation.'
	);

	const value = parts.join('');
	const transcriptTurns = ctx.transcript ? ctx.transcript.split('\n').length : 0;

	return {
		value,
		meta: {
			inputChars: value.length,
			memoryIncluded: !!ctx.memoryContext,
			transcriptTurns,
			sourceStages: ['memory', 'transcript'],
		},
	};
}

export function parseDirectorOutput(raw: string): DirectorResult {
	if (isRefusal(raw)) {
		return { refused: true, raw };
	}

	try {
		const parsed = parseJsonFromText(raw) as Record<string, unknown>;
		return {
			refused: false,
			world: parsed.world ?? null,
			scene: parsed.scene ?? null,
			checks: Array.isArray(parsed.checks) ? parsed.checks : [],
			strategy: typeof parsed.strategy === 'string' ? parsed.strategy : '',
		};
	} catch {
		return {
			refused: false,
			world: null,
			scene: raw,
			checks: [],
			strategy: '',
		};
	}
}

export function mergeDirectorToPerformer(directorResult: DirectorResult): MergeResult<string | { refused: true }> {
	if (directorResult.refused) {
		return {
			value: { refused: true },
			meta: {
				inputChars: 0,
				memoryIncluded: false,
				transcriptTurns: 0,
				sourceStages: ['director'],
			},
		};
	}

	const value = JSON.stringify({ world: directorResult.world, scene: directorResult.scene, checks: directorResult.checks, strategy: directorResult.strategy });

	return {
		value,
		meta: {
			inputChars: value.length,
			memoryIncluded: false,
			transcriptTurns: 0,
			sourceStages: ['director'],
		},
	};
}

export function mergeForDirectorCharacter(
	ctx: PipelineContext, marcusMessage: string,
	retry?: { rejectedTake: string; feedback: string },
): MergeResult<string> {
	const parts: string[] = [];

	if (ctx.memoryContext) {
		parts.push(`ACCUMULATED MEMORY:\n${ctx.memoryContext}\n\n`);
	}
	if (ctx.transcript) {
		parts.push(`CONVERSATION HISTORY:\n${ctx.transcript}\n\n`);
	}
	parts.push(`Marcus just said: ${marcusMessage}`);

	if (retry) {
		parts.push(`\n\nREJECTED TAKE:\n${retry.rejectedTake}`);
		parts.push(`\n\nUSER FEEDBACK:\n${retry.feedback}`);
	}

	const value = parts.join('');
	const transcriptTurns = ctx.transcript ? ctx.transcript.split('\n').length : 0;

	return {
		value,
		meta: {
			inputChars: value.length,
			memoryIncluded: !!ctx.memoryContext,
			transcriptTurns,
			sourceStages: ['memory', 'transcript', 'actor-for-user'],
		},
	};
}

export function mergeForCutter(memoryContext: string, marcusMessage: string, sophieMessage: string): MergeResult<string> {
	const parts: string[] = [];

	if (memoryContext) {
		parts.push(`PRIOR EXTRACTIONS:\n${memoryContext}\n\n`);
	}
	parts.push(`CURRENT TURN:\nMarcus: ${marcusMessage}\n\nSophie: ${sophieMessage}`);

	const value = parts.join('');

	return {
		value,
		meta: {
			inputChars: value.length,
			memoryIncluded: !!memoryContext,
			transcriptTurns: 0,
			sourceStages: ['memory', 'actor-for-user', 'actress-for-character'],
		},
	};
}

export function parseCutterOutput(raw: string): CutterResult {
	if (!raw || raw.trim().length === 0) {
		return { parsed: false, raw: raw || '' };
	}

	try {
		const json = parseJsonFromText(raw) as Record<string, unknown>;
		return {
			parsed: true,
			operations: Array.isArray(json.operations) ? json.operations : null,
			emotion_echo: json.emotion_echo != null ? String(json.emotion_echo) : null,
			rolling_arc_update: json.rolling_arc_update != null ? String(json.rolling_arc_update) : null,
			rolling_arc_summary: json.rolling_arc_summary != null ? String(json.rolling_arc_summary) : null,
		};
	} catch {
		return { parsed: false, raw };
	}
}
