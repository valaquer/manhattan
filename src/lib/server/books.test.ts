import { describe, it, expect } from 'vitest';
import {
	loadBook,
	loadModelProfile,
	loadCharacterSheet,
	extractFirstTurnInsert,
	buildIdentityHeader,
} from './books';
import type { AgentRole, CharacterName } from './books';

const ROLES: AgentRole[] = ['director', 'actress', 'reviewer', 'cutter', 'archivist', 'director-user', 'actor-user'];
const CHARACTERS: CharacterName[] = [
	'Sophie', 'Valentina', 'Priya', 'Sara', 'Jiwoo', 'Tsion',
	'Adaeze', 'Avery', 'Hina', 'Isabela', 'Lani', 'Nadia',
];

describe('loadBook', () => {
	it.each(ROLES)('returns non-empty string for %s', (role) => {
		const text = loadBook(role);
		expect(typeof text).toBe('string');
		expect(text.length).toBeGreaterThan(50);
	});
});

describe('loadModelProfile', () => {
	it('returns null when profile file does not exist', () => {
		const result = loadModelProfile('director', 'nonexistent-model');
		expect(result).toBeNull();
	});
});

describe('loadCharacterSheet', () => {
	it('returns all 9 sections for Sophie', () => {
		const sheet = loadCharacterSheet('Sophie');
		expect(sheet.voiceBlock).toBeTruthy();
		expect(sheet.canon.lifeFacts).toBeTruthy();
		expect(sheet.canon.backstory).toBeTruthy();
		expect(sheet.canon.sensitivities).toBeTruthy();
		expect(sheet.canon.wantsAndFears).toBeTruthy();
		expect(sheet.canon.eroticSelf).toBeTruthy();
		expect(sheet.casting).toBeTruthy();
		expect(sheet.disclosureLine).toBeTruthy();
		expect(sheet.fallbackPool.length).toBeGreaterThan(0);
	});

	it('produces consistent structure across all 12 characters', () => {
		const keys = CHARACTERS.map(name => {
			const sheet = loadCharacterSheet(name);
			return {
				hasVoiceBlock: !!sheet.voiceBlock,
				hasLifeFacts: !!sheet.canon.lifeFacts,
				hasBackstory: !!sheet.canon.backstory,
				hasSensitivities: !!sheet.canon.sensitivities,
				hasWantsAndFears: !!sheet.canon.wantsAndFears,
				hasEroticSelf: !!sheet.canon.eroticSelf,
				hasCasting: !!sheet.casting,
				hasDisclosureLine: !!sheet.disclosureLine,
				hasFallbackPool: sheet.fallbackPool.length > 0,
			};
		});
		for (const k of keys) {
			expect(k).toEqual(keys[0]);
		}
	});

	it('extracts fallback pool as array of strings', () => {
		const sheet = loadCharacterSheet('Sophie');
		expect(Array.isArray(sheet.fallbackPool)).toBe(true);
		expect(sheet.fallbackPool.length).toBe(3);
		for (const line of sheet.fallbackPool) {
			expect(typeof line).toBe('string');
			expect(line.length).toBeGreaterThan(10);
		}
	});

	it('disclosure line does not include surrounding quotes', () => {
		const sheet = loadCharacterSheet('Sophie');
		expect(sheet.disclosureLine).not.toMatch(/^["“]/);
		expect(sheet.disclosureLine).not.toMatch(/["”]$/);
	});
});

describe('extractFirstTurnInsert', () => {
	it('extracts content from Director book', () => {
		const bookText = loadBook('director');
		const insert = extractFirstTurnInsert(bookText);
		expect(insert.length).toBeGreaterThan(100);
		expect(insert).toContain('first turn');
	});

	it('returns empty string when marker is absent', () => {
		const insert = extractFirstTurnInsert('no marker here');
		expect(insert).toBe('');
	});

	it('does not include the marker line or documentation comments', () => {
		const bookText = loadBook('director');
		const insert = extractFirstTurnInsert(bookText);
		expect(insert).not.toContain('# SERVED INSERT');
		expect(insert).not.toContain('NOT book text');
	});
});

describe('buildIdentityHeader', () => {
	it('full: both name and alias known', () => {
		const header = buildIdentityHeader('Sophie', {
			hasName: true, hasAlias: true,
			userName: 'Marcus', userAlias: 'Marc',
		});
		expect(header).toContain('Sophie');
		expect(header).toContain('Marcus');
		expect(header).toContain('Marc');
	});

	it('name only: no alias', () => {
		const header = buildIdentityHeader('Sophie', {
			hasName: true, hasAlias: false,
			userName: 'Marcus',
		});
		expect(header).toContain('Marcus');
		expect(header).not.toContain('alias');
	});

	it('unknown: no name or alias', () => {
		const header = buildIdentityHeader('Sophie', {
			hasName: false, hasAlias: false,
		});
		expect(header).toContain("don't yet know");
	});

	it('alias only: no name', () => {
		const header = buildIdentityHeader('Sophie', {
			hasName: false, hasAlias: true,
			userAlias: 'Marc',
		});
		expect(header).toContain("don't yet know his name");
		expect(header).toContain('Marc');
	});
});

describe('no SvelteKit dependencies', () => {
	it('books.ts does not import $env', async () => {
		const { readFileSync } = await import('fs');
		const source = readFileSync(new URL('./books.ts', import.meta.url), 'utf-8');
		expect(source).not.toContain('$env');
		expect(source).not.toContain('@sveltejs');
	});
});
