import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock books (user-side book stubs for testing)
vi.mock('$lib/server/books', async () => {
	const actual = await vi.importActual<typeof import('./books')>('./books');
	return {
		...actual,
		loadBook: vi.fn((role: string) => {
			if (role === 'director-user' || role === 'actor-user') return 'stub book content for testing';
			return actual.loadBook(role as any);
		}),
	};
});

// Mock DB
vi.mock('$lib/server/db', () => ({
	getOrCreateSession: vi.fn(() => 1),
	getNextTurnNumber: vi.fn(() => 1),
	saveMessage: vi.fn(() => 1),
	savePipelineOutput: vi.fn(() => 1),
	saveMemory: vi.fn(() => 1),
	getMemory: vi.fn(() => []),
	getRecentMessages: vi.fn(() => []),
}));

// Mock OpenRouter
vi.mock('$lib/server/openrouter', () => ({
	callModel: vi.fn(async () => '{"world":null,"scene":{"read":"test direction"},"checks":[],"strategy":"test env"}'),
	streamModel: vi.fn(async function* () { yield 'Hello '; yield 'world.'; }),
}));

import { runPipeline } from './engine';
import type { PipelineConfig, PipelineEvent } from './engine';
import { callModel } from '$lib/server/openrouter';
import { getMemory, getRecentMessages } from '$lib/server/db';

const mockedCallModel = vi.mocked(callModel);
const mockedGetMemory = vi.mocked(getMemory);
const mockedGetRecentMessages = vi.mocked(getRecentMessages);

async function collectEvents(config: PipelineConfig): Promise<PipelineEvent[]> {
	const events: PipelineEvent[] = [];
	for await (const event of runPipeline(config)) {
		events.push(event);
	}
	return events;
}

const fixtureConfig: PipelineConfig = {
	characterName: 'Sophie',
	userInfo: { hasName: true, hasAlias: false, userName: 'Marcus' },
	mode: 'fixture',
	sessionId: 1,
};

const productionConfig: PipelineConfig = {
	characterName: 'Sophie',
	userInfo: { hasName: true, hasAlias: false, userName: 'Marcus' },
	mode: 'production',
	sessionId: 1,
};

beforeEach(() => {
	vi.clearAllMocks();
	mockedGetMemory.mockReturnValue([]);
	mockedGetRecentMessages.mockReturnValue([]);

	// Default: Director returns valid JSON, Reviewer passes, Cutter returns valid JSON
	mockedCallModel.mockImplementation(async (_model, _sys, _msgs) => {
		return '{"world":null,"scene":{"read":"test direction"},"checks":[],"strategy":"test env"}';
	});
});

describe('runPipeline - fixture mode', () => {
	it('emits stage events for all fixture calls + summary + done', async () => {
		let callCount = 0;
		mockedCallModel.mockImplementation(async () => {
			callCount++;
			if (callCount <= 2) return '{"world":null,"scene":"test","checks":[],"strategy":"env"}'; // Directors
			if (callCount === 3) return 'Hello from actor'; // Actor
			if (callCount === 4) return '{"world":null,"scene":"char dir","checks":[],"strategy":"char env"}'; // Director-for-char
			if (callCount === 5) return '{"verdict":"pass"}'; // Reviewer
			if (callCount === 6) return '{"operations":[],"emotion_echo":"neutral","rolling_arc_update":"","rolling_arc_summary":"test"}'; // Cutter
			return '{}';
		});

		const events = await collectEvents(fixtureConfig);
		const stages = events.filter(e => e.type === 'stage').map(e => (e as any).stage);
		const done = events.find(e => e.type === 'done');

		expect(stages).toContain('director-for-user');
		expect(stages).toContain('actor-for-user');
		expect(stages).toContain('director-for-character');
		expect(stages).toContain('actress-for-character');
		expect(stages).toContain('artisan-cutter');
		expect(done).toBeTruthy();
	});
});

describe('runPipeline - production mode', () => {
	it('skips user-side calls and emits 5-call stages', async () => {
		mockedGetRecentMessages.mockReturnValue([
			{ sender: 'Marcus', content: 'Hello Sophie', turn_number: 1 },
		]);

		let callCount = 0;
		mockedCallModel.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) return '{"world":null,"scene":"dir","checks":[],"strategy":"env"}'; // Director
			if (callCount === 2) return '{"verdict":"pass"}'; // Reviewer
			if (callCount === 3) return '{"operations":[],"emotion_echo":"ok","rolling_arc_update":"","rolling_arc_summary":"arc"}'; // Cutter
			return '{}';
		});

		const events = await collectEvents(productionConfig);
		const stages = events.filter(e => e.type === 'stage').map(e => (e as any).stage);

		expect(stages).not.toContain('director-for-user');
		expect(stages).not.toContain('actor-for-user');
		expect(stages).toContain('director-for-character');
		expect(stages).toContain('actress-for-character');
		expect(stages).toContain('artisan-cutter');
	});
});

describe('Director refusal - abort', () => {
	it('aborts pipeline when Director-for-User refuses in fixture mode', async () => {
		mockedCallModel.mockResolvedValueOnce('I cannot assist with that');

		const events = await collectEvents(fixtureConfig);
		const stages = events.filter(e => e.type === 'stage').map(e => (e as any).stage);
		const done = events.find(e => e.type === 'done');

		expect(stages).toContain('director-for-user');
		expect(stages).toContain('actor-for-user');
		expect((events.find(e => e.type === 'stage' && (e as any).stage === 'actor-for-user') as any).content).toContain('SKIPPED');
		expect(done).toBeTruthy();
	});

	it('aborts pipeline when Director-for-Character refuses', async () => {
		let callCount = 0;
		mockedCallModel.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) return '{"world":null,"scene":"d","checks":[],"strategy":"e"}'; // Dir-for-user
			if (callCount === 2) return 'user msg'; // Actor
			if (callCount === 3) return 'I cannot assist with that'; // Dir-for-char refuses
			return '{}';
		});

		const events = await collectEvents(fixtureConfig);
		const stages = events.filter(e => e.type === 'stage').map(e => (e as any).stage);

		expect(stages).toContain('director-for-character');
		expect(stages).toContain('actress-for-character');
		expect((events.find(e => e.type === 'stage' && (e as any).stage === 'actress-for-character') as any).content).toContain('SKIPPED');
	});
});

describe('Reviewer retry loop', () => {
	it('handles Reviewer pass on first attempt', async () => {
		let callCount = 0;
		mockedCallModel.mockImplementation(async () => {
			callCount++;
			if (callCount <= 3) return '{"world":null,"scene":"d","checks":[],"strategy":"e"}';
			if (callCount === 4) return '{"verdict":"pass"}'; // Reviewer passes
			if (callCount === 5) return '{"operations":[]}'; // Cutter
			return '{}';
		});

		const events = await collectEvents(fixtureConfig);
		const retryEvents = events.filter(e => e.type === 'retry');
		expect(retryEvents).toHaveLength(0);
	});

	it('handles performance fault retry', async () => {
		let callCount = 0;
		mockedCallModel.mockImplementation(async () => {
			callCount++;
			if (callCount <= 3) return '{"world":null,"scene":"d","checks":[],"strategy":"e"}';
			if (callCount === 4) return '{"verdict":"reject","fault":"performance","reason":"too flat"}'; // Reviewer rejects
			if (callCount === 5) return '{"verdict":"pass"}'; // Reviewer passes on retry
			if (callCount === 6) return '{"operations":[]}'; // Cutter
			return '{}';
		});

		const events = await collectEvents(fixtureConfig);
		const retryEvents = events.filter(e => e.type === 'retry');
		expect(retryEvents).toHaveLength(1);
		expect((retryEvents[0] as any).fault).toBe('performance');
	});

	it('serves fallback on double rejection', async () => {
		let callCount = 0;
		mockedCallModel.mockImplementation(async () => {
			callCount++;
			if (callCount <= 3) return '{"world":null,"scene":"d","checks":[],"strategy":"e"}';
			if (callCount === 4) return '{"verdict":"reject","fault":"performance","reason":"bad"}'; // 1st reject
			if (callCount === 5) return '{"verdict":"reject","fault":"performance","reason":"still bad"}'; // 2nd reject
			if (callCount === 6) return '{"operations":[]}'; // Cutter
			return '{}';
		});

		const events = await collectEvents(fixtureConfig);
		const fallbackEvents = events.filter(e => e.type === 'fallback');
		expect(fallbackEvents).toHaveLength(1);
	});
});

describe('Reviewer infrastructure failure (Decision 2B)', () => {
	it('delivers Actress response with quality-flag when Reviewer fails', async () => {
		let callCount = 0;
		mockedCallModel.mockImplementation(async () => {
			callCount++;
			if (callCount <= 3) return '{"world":null,"scene":"d","checks":[],"strategy":"e"}';
			if (callCount === 4) throw new Error('OpenRouter 500'); // Reviewer infra failure
			if (callCount === 5) return '{"operations":[]}'; // Cutter
			return '{}';
		});

		const events = await collectEvents(fixtureConfig);
		const warnings = events.filter(e => e.type === 'warning');
		expect(warnings).toHaveLength(1);
		expect((warnings[0] as any).stage).toBe('reviewer');
		expect((warnings[0] as any).reviewed).toBe(false);

		// Actress response still delivered
		const actressStage = events.find(e => e.type === 'stage' && (e as any).stage === 'actress-for-character');
		expect(actressStage).toBeTruthy();
	});

	it('delivers with quality-flag when Reviewer returns unparseable output', async () => {
		let callCount = 0;
		mockedCallModel.mockImplementation(async () => {
			callCount++;
			if (callCount <= 3) return '{"world":null,"scene":"d","checks":[],"strategy":"e"}';
			if (callCount === 4) return 'not json at all!!!'; // Unparseable
			if (callCount === 5) return '{"operations":[]}'; // Cutter
			return '{}';
		});

		const events = await collectEvents(fixtureConfig);
		const warnings = events.filter(e => e.type === 'warning');
		expect(warnings).toHaveLength(1);
		expect((warnings[0] as any).reviewed).toBe(false);
	});
});

describe('Cutter failure - degrade gracefully', () => {
	it('continues when Cutter fails', async () => {
		let callCount = 0;
		mockedCallModel.mockImplementation(async () => {
			callCount++;
			if (callCount <= 3) return '{"world":null,"scene":"d","checks":[],"strategy":"e"}';
			if (callCount === 4) return '{"verdict":"pass"}'; // Reviewer
			if (callCount === 5) throw new Error('Cutter timeout'); // Cutter fails
			return '{}';
		});

		const events = await collectEvents(fixtureConfig);
		const warnings = events.filter(e => e.type === 'warning');
		expect(warnings.some(w => (w as any).stage === 'cutter')).toBe(true);

		const done = events.find(e => e.type === 'done');
		expect(done).toBeTruthy();
	});
});

describe('Archivist trigger', () => {
	it('emits archivist-queued when episode boundary detected', async () => {
		let callCount = 0;
		mockedCallModel.mockImplementation(async () => {
			callCount++;
			if (callCount <= 3) return '{"world":null,"scene":"d","checks":[],"strategy":"e"}';
			if (callCount === 4) return '{"verdict":"pass"}';
			if (callCount === 5) return '{"operations":[],"emotion_echo":"sad","rolling_arc_update":"","rolling_arc_summary":"arc","episode_boundary":{"detected":true}}';
			return '{}';
		});

		const events = await collectEvents(fixtureConfig);
		const archivistEvents = events.filter(e => e.type === 'archivist-queued');
		expect(archivistEvents).toHaveLength(1);
		expect((archivistEvents[0] as any).trigger).toBe('episode_boundary');
	});
});

describe('Token instrumentation', () => {
	it('emits summary with meta per stage', async () => {
		let callCount = 0;
		mockedCallModel.mockImplementation(async () => {
			callCount++;
			if (callCount <= 3) return '{"world":null,"scene":"d","checks":[],"strategy":"e"}';
			if (callCount === 4) return '{"verdict":"pass"}';
			if (callCount === 5) return '{"operations":[]}';
			return '{}';
		});

		const events = await collectEvents(fixtureConfig);
		const summary = events.find(e => e.type === 'summary') as any;
		expect(summary).toBeTruthy();
		expect(summary.turnNumber).toBe(1);
		expect(typeof summary.meta).toBe('object');
	});
});
