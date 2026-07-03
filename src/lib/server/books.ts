import { readFileSync } from 'fs';
import { join } from 'path';

// Configurable path — update when Boss decides final destination
const BOOKS_DIR = '/Users/deepak-macmini/honeybloom/recovery/cernere/quinn';

const DIRECTOR_BOOKS = join(BOOKS_DIR, 'director-books');
const ACTRESS_BOOKS = join(BOOKS_DIR, 'actress-books');
const CUTTER_BOOKS = join(BOOKS_DIR, 'cutter-books');

function readModule(dir: string, filename: string): string {
	return readFileSync(join(dir, filename), 'utf-8');
}

// === Director Assembly ===
// Assembly order: 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11
// Swap rules: 02 by director model, 05 by character, 06 by actress model

interface TurnContext {
	turnNumber: number;
	timestamp: string;
	stage: string;
	pacing: string;
}

type DirectorModel = 'deepseek' | 'grok';
type ActressModel = 'cydonia' | 'hermes';

export function getDirectorModules(directorModel: DirectorModel, actressModel: ActressModel): string[] {
	return [
		'01-core-identity.md',
		directorModel === 'deepseek' ? '02-output-format-deepseek.md' : '02-output-format-grok.md',
		'03-north-star.md',
		'04-full-emotional-range.md',
		'05-character-sophie.md',
		actressModel === 'cydonia' ? '06-actor-model-cydonia-v41.md' : '06-actor-model-hermes-3-70b.md',
		'07-session-context.md',
		'08-environment-injection.md',
		'09-inner-voice.deprecated.md',
		'10-vulnerability-detection.md',
		'11-failure-mode-countermeasures.md',
	];
}

export function assembleDirectorBooks(
	directorModel: DirectorModel,
	actressModel: ActressModel,
	turnContext: TurnContext
): { prompt: string; modules: string[] } {
	const modules = getDirectorModules(directorModel, actressModel);
	const parts = modules.map((f) => readModule(DIRECTOR_BOOKS, f));

	let prompt = parts.join('\n\n');

	// Fill Module 07 placeholders
	prompt = prompt
		.replace('{turn_number}', String(turnContext.turnNumber))
		.replace('{timestamp}', turnContext.timestamp)
		.replace('{stage}', turnContext.stage)
		.replace('{inferred_pacing}', turnContext.pacing);

	return { prompt, modules };
}

// === Actress Assembly ===
// Assembly order: 01 → 02 → 03 → 04 → 05
// Swap rules: 04 by character

export function getActressModules(): string[] {
	return [
		'01-core-identity.md',
		'02-voice-and-tone.md',
		'03-constraints.md',
		'04-character-sophie.md',
		'05-receiving-direction.md',
	];
}

export function assembleActressBooks(): { prompt: string; modules: string[] } {
	const modules = getActressModules();
	const parts = modules.map((f) => readModule(ACTRESS_BOOKS, f));
	return { prompt: parts.join('\n\n'), modules };
}

// === Cutter Assembly ===
// Assembly order: 01 → 02 → 03 → 04 → 05 (→ 06 for Grok only, via json_schema param)
// Swap rules: 01 by cutter model

export function getCutterModules(cutterModel: DirectorModel): string[] {
	return [
		cutterModel === 'deepseek' ? '01-core-identity-deepseek.md' : '01-core-identity-grok.md',
		'02-tier-1-extraction.md',
		'03-tier-2-extraction.md',
		'04-emotion-echo.md',
		'05-rolling-arc.md',
		// Module 06: DeepSeek skips (schema in 01). Grok uses json_schema param.
	];
}

export function assembleCutterBooks(cutterModel: DirectorModel): { prompt: string; modules: string[] } {
	const modules = getCutterModules(cutterModel);
	const parts = modules.map((f) => readModule(CUTTER_BOOKS, f));
	return { prompt: parts.join('\n\n'), modules };
}

// === Grok Response Format Schemas ===

const useAnyOf = false;
const nullable = (baseType: string) => useAnyOf
	? { anyOf: [{ type: baseType }, { type: 'null' }] }
	: { type: [baseType, 'null'] };

const nullableArray = (itemType: string) => useAnyOf
	? { anyOf: [{ type: 'array', items: { type: itemType } }, { type: 'null' }] }
	: { type: ['array', 'null'], items: { type: itemType } };

export const GROK_DIRECTOR_FORMAT = {
	type: 'json_schema',
	json_schema: {
		name: 'director_output',
		strict: true,
		schema: {
			type: 'object',
			properties: {
				direction: { type: 'string' },
				environment: nullable('string'),
				show_inner_voice: { type: 'boolean' },
			},
			required: ['direction', 'environment', 'show_inner_voice'],
			additionalProperties: false,
		},
	},
};

export const GROK_CUTTER_FORMAT = {
	type: 'json_schema',
	json_schema: {
		name: 'cutter_output',
		strict: true,
		schema: {
			type: 'object',
			properties: {
				tier_1: {
					...nullable('object'),
					properties: {
						his_real_life: nullableArray('string'),
						her_promises: nullableArray('string'),
						shared_history: nullableArray('string'),
						his_preferences: nullableArray('string'),
						his_inner_world: nullableArray('string'),
						their_language: nullableArray('string'),
					},
					required: ['his_real_life', 'her_promises', 'shared_history', 'his_preferences', 'his_inner_world', 'their_language'],
				},
				tier_2: nullableArray('string'),
				emotion_echo: { type: 'string' },
				rolling_arc_update: { type: 'string' },
				rolling_arc_summary: { type: 'string' },
				arc_boundary: { type: 'boolean' },
				closed_arc: nullable('string'),
			},
			required: ['tier_1', 'tier_2', 'emotion_echo', 'rolling_arc_update', 'rolling_arc_summary', 'arc_boundary', 'closed_arc'],
			additionalProperties: false,
		},
	},
};

// === Model Parameters ===

export const ACTRESS_PARAMS: Record<string, Record<string, number>> = {
	'thedrummer/cydonia-24b-v4.1': {
		temperature: 0.85, top_p: 0.95, min_p: 0.05,
		repetition_penalty: 1.05, max_tokens: 320,
	},
	'nousresearch/hermes-3-llama-3.1-70b': {
		temperature: 0.8, top_p: 0.95, top_k: 20,
		repetition_penalty: 1.1, max_tokens: 320,
	},
};

export const DIRECTOR_PARAMS: Record<string, Record<string, number>> = {
	'deepseek/deepseek-v4-flash': { temperature: 0.3, top_p: 1.0, max_tokens: 500 },
	'x-ai/grok-4.1-fast': { temperature: 0.3, top_p: 1.0, max_tokens: 500 },
};
