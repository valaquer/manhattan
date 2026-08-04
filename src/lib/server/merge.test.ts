import { describe, it, expect } from 'vitest';
import {
	formatTranscript,
	formatMemoryContext,
	mergeForDirectorUser,
	parseDirectorOutput,
	mergeDirectorToPerformer,
	mergeForDirectorCharacter,
	mergeForCutter,
	parseCutterOutput,
} from './merge';
import type { PipelineContext, DirectorResult } from './merge';

// --- formatTranscript ---

describe('formatTranscript', () => {
	it('formats messages as sender: content lines', () => {
		const messages = [
			{ sender: 'Marcus', content: 'Hello Sophie' },
			{ sender: 'Sophie', content: 'Hi Marcus!' },
		];
		expect(formatTranscript(messages)).toBe('Marcus: Hello Sophie\nSophie: Hi Marcus!');
	});

	it('returns empty string for empty array', () => {
		expect(formatTranscript([])).toBe('');
	});
});

// --- formatMemoryContext ---

describe('formatMemoryContext', () => {
	it('formats memories with type and turn metadata', () => {
		const memories = [
			{ type: 'tier1', content: '{"his_real_life": ["lives alone"]}', turn_updated: 2 },
			{ type: 'emotion_echo', content: 'curious and open', turn_updated: 3 },
		];
		const result = formatMemoryContext(memories);
		expect(result).toBe('[tier1 | turn 2] {"his_real_life": ["lives alone"]}\n[emotion_echo | turn 3] curious and open');
	});

	it('returns empty string for empty array', () => {
		expect(formatMemoryContext([])).toBe('');
	});
});

// --- mergeForDirectorUser ---

describe('mergeForDirectorUser', () => {
	it('concatenates all three sections when present', () => {
		const ctx: PipelineContext = {
			memoryContext: '[tier1 | turn 1] some memory',
			transcript: 'Marcus: hey\nSophie: hi',
			lastSophieMessage: 'hi',
		};
		const result = mergeForDirectorUser(ctx);
		expect(result.value).toContain('ACCUMULATED MEMORY:\n[tier1 | turn 1] some memory');
		expect(result.value).toContain('RECENT TURNS:\nMarcus: hey\nSophie: hi');
		expect(result.value).toContain('Sophie just said: hi');
		expect(result.meta.memoryIncluded).toBe(true);
		expect(result.meta.transcriptTurns).toBe(2);
	});

	it('omits ACCUMULATED MEMORY when memory is empty', () => {
		const ctx: PipelineContext = {
			memoryContext: '',
			transcript: 'Marcus: hey',
			lastSophieMessage: 'hi',
		};
		const result = mergeForDirectorUser(ctx);
		expect(result.value).not.toContain('ACCUMULATED MEMORY');
		expect(result.meta.memoryIncluded).toBe(false);
	});

	it('omits RECENT TURNS when transcript is empty', () => {
		const ctx: PipelineContext = {
			memoryContext: 'some memory',
			transcript: '',
			lastSophieMessage: 'hi',
		};
		const result = mergeForDirectorUser(ctx);
		expect(result.value).not.toContain('RECENT TURNS');
		expect(result.meta.transcriptTurns).toBe(0);
	});

	it('outputs start-of-conversation when no Sophie messages', () => {
		const ctx: PipelineContext = {
			memoryContext: '',
			transcript: '',
			lastSophieMessage: null,
		};
		const result = mergeForDirectorUser(ctx);
		expect(result.value).toBe('This is the start of the conversation.');
	});
});

// --- parseDirectorOutput ---

describe('parseDirectorOutput', () => {
	it('parses valid JSON', () => {
		const raw = '{"world": {"facts": "lives in Berlin"}, "scene": {"read": "ask about her day"}, "checks": ["Berlin"], "strategy": "early bonding"}';
		const result = parseDirectorOutput(raw);
		expect(result.refused).toBe(false);
		if (!result.refused) {
			expect(result.world).toEqual({ facts: 'lives in Berlin' });
			expect(result.scene).toEqual({ read: 'ask about her day' });
			expect(result.checks).toEqual(['Berlin']);
			expect(result.strategy).toBe('early bonding');
		}
	});

	it('strips markdown code fences', () => {
		const raw = '```json\n{"world": null, "scene": {"read": "flirt gently"}, "checks": [], "strategy": ""}\n```';
		const result = parseDirectorOutput(raw);
		expect(result.refused).toBe(false);
		if (!result.refused) {
			expect(result.scene).toEqual({ read: 'flirt gently' });
		}
	});

	it('wraps unparseable text as scene fallback', () => {
		const raw = 'Just have Marcus ask about her hobbies';
		const result = parseDirectorOutput(raw);
		expect(result.refused).toBe(false);
		if (!result.refused) {
			expect(result.scene).toBe(raw);
			expect(result.strategy).toBe('');
		}
	});

	it('detects empty string as refusal', () => {
		const result = parseDirectorOutput('');
		expect(result.refused).toBe(true);
	});

	it('detects whitespace-only as refusal', () => {
		const result = parseDirectorOutput('   ');
		expect(result.refused).toBe(true);
	});

	it('detects known refusal prefixes', () => {
		const refusals = [
			'I cannot generate that kind of content.',
			"I'm sorry, I can't help with that.",
			'I am unable to produce this response.',
			'As an AI language model, I must decline.',
		];
		for (const raw of refusals) {
			const result = parseDirectorOutput(raw);
			expect(result.refused).toBe(true);
			if (result.refused) {
				expect(result.raw).toBe(raw);
			}
		}
	});

	it('does not false-positive on content containing refusal-like words', () => {
		const raw = '{"world": null, "scene": {"read": "I cannot believe how beautiful you are"}, "checks": [], "strategy": "rooftop date"}';
		const result = parseDirectorOutput(raw);
		expect(result.refused).toBe(false);
	});
});

// --- mergeDirectorToPerformer ---

describe('mergeDirectorToPerformer', () => {
	it('stringifies valid Director output', () => {
		const director: DirectorResult = { refused: false, world: { facts: 'Berlin' }, scene: { read: 'be playful' }, checks: [], strategy: 'coffee shop date' };
		const result = mergeDirectorToPerformer(director);
		expect(typeof result.value).toBe('string');
		const parsed = JSON.parse(result.value as string);
		expect(parsed.world).toEqual({ facts: 'Berlin' });
		expect(parsed.scene).toEqual({ read: 'be playful' });
		expect(parsed.strategy).toBe('coffee shop date');
	});

	it('returns refused marker on Director refusal', () => {
		const director: DirectorResult = { refused: true, raw: 'I cannot help' };
		const result = mergeDirectorToPerformer(director);
		expect(result.value).toEqual({ refused: true });
		expect(result.meta.inputChars).toBe(0);
	});
});

// --- mergeForDirectorCharacter ---

describe('mergeForDirectorCharacter', () => {
	it('concatenates memory, transcript, and Marcus message', () => {
		const ctx: PipelineContext = {
			memoryContext: '[tier1 | turn 1] memory data',
			transcript: 'Marcus: hey\nSophie: hi',
			lastSophieMessage: 'hi',
		};
		const result = mergeForDirectorCharacter(ctx, 'How was your day?');
		expect(result.value).toContain('ACCUMULATED MEMORY');
		expect(result.value).toContain('RECENT TURNS');
		expect(result.value).toContain('Marcus just said: How was your day?');
		expect(result.meta.sourceStages).toContain('actor-for-user');
	});

	it('omits memory and transcript when empty', () => {
		const ctx: PipelineContext = {
			memoryContext: '',
			transcript: '',
			lastSophieMessage: null,
		};
		const result = mergeForDirectorCharacter(ctx, 'Hello');
		expect(result.value).toBe('Marcus just said: Hello');
	});
});

// --- mergeForCutter ---

describe('mergeForCutter', () => {
	it('includes prior extractions and current turn', () => {
		const result = mergeForCutter('[tier1 | turn 1] facts', 'Hey there', 'Hi! How are you?');
		expect(result.value).toContain('PRIOR EXTRACTIONS:\n[tier1 | turn 1] facts');
		expect(result.value).toContain('CURRENT TURN:\nMarcus: Hey there\n\nSophie: Hi! How are you?');
		expect(result.meta.memoryIncluded).toBe(true);
	});

	it('omits prior extractions when memory is empty', () => {
		const result = mergeForCutter('', 'Hello', 'Hi!');
		expect(result.value).not.toContain('PRIOR EXTRACTIONS');
		expect(result.value).toBe('CURRENT TURN:\nMarcus: Hello\n\nSophie: Hi!');
		expect(result.meta.memoryIncluded).toBe(false);
	});

	it('handles empty Sophie message (stream failure)', () => {
		const result = mergeForCutter('', 'Hello', '');
		expect(result.value).toContain('Sophie: ');
	});
});

// --- parseCutterOutput ---

describe('parseCutterOutput', () => {
	it('parses valid JSON with all fields', () => {
		const raw = JSON.stringify({
			operations: [{ verb: 'ADD', bucket: 'his_real_life', content: 'lives in Berlin' }],
			emotion_echo: '[SALIENCE: 5] | {curious} | Asked about city -> She shared -> Warm opening',
			rolling_arc_update: 'Turn 3: [SALIENCE: 5] | {curious} | Early sharing',
			rolling_arc_summary: 'early bonding phase',
		});
		const result = parseCutterOutput(raw);
		expect(result.parsed).toBe(true);
		if (result.parsed) {
			expect(result.operations).toEqual([{ verb: 'ADD', bucket: 'his_real_life', content: 'lives in Berlin' }]);
			expect(result.emotion_echo).toContain('SALIENCE');
			expect(result.rolling_arc_update).toContain('Turn 3');
			expect(result.rolling_arc_summary).toBe('early bonding phase');
		}
	});

	it('handles partial fields -- only operations present', () => {
		const raw = JSON.stringify({ operations: [{ verb: 'ADD', bucket: 'his_real_life', content: 'has a dog' }] });
		const result = parseCutterOutput(raw);
		expect(result.parsed).toBe(true);
		if (result.parsed) {
			expect(result.operations).toEqual([{ verb: 'ADD', bucket: 'his_real_life', content: 'has a dog' }]);
			expect(result.emotion_echo).toBeNull();
			expect(result.rolling_arc_update).toBeNull();
			expect(result.rolling_arc_summary).toBeNull();
		}
	});

	it('strips markdown code fences', () => {
		const raw = '```json\n{"operations": [], "emotion_echo": "neutral"}\n```';
		const result = parseCutterOutput(raw);
		expect(result.parsed).toBe(true);
		if (result.parsed) {
			expect(result.emotion_echo).toBe('neutral');
		}
	});

	it('returns unparsed for empty string', () => {
		const result = parseCutterOutput('');
		expect(result.parsed).toBe(false);
		if (!result.parsed) {
			expect(result.raw).toBe('');
		}
	});

	it('returns unparsed for malformed text', () => {
		const result = parseCutterOutput('This is not JSON at all');
		expect(result.parsed).toBe(false);
		if (!result.parsed) {
			expect(result.raw).toBe('This is not JSON at all');
		}
	});
});
