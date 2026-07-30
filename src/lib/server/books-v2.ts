import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const WIKI_DIR = '/Users/deepak-macmini/honeybloom/library/wiki';
const BOOKS_DIR = join(WIKI_DIR, 'Relationship Engine', 'books');
const CHARACTERS_DIR = join(WIKI_DIR, 'Relationship Engine', 'characters');

export type AgentRole = 'director' | 'actress' | 'reviewer' | 'cutter' | 'archivist' | 'director-user' | 'actor-user';

export type CharacterName = 'Sophie' | 'Valentina' | 'Priya' | 'Sara' | 'Jiwoo' | 'Tsion' | 'Adaeze' | 'Avery' | 'Hina' | 'Isabela' | 'Lani' | 'Nadia';

export interface CharacterSheet {
	voiceBlock: string;
	canon: {
		lifeFacts: string;
		backstory: string;
		sensitivities: string;
		wantsAndFears: string;
		eroticSelf: string;
	};
	casting: string;
	disclosureLine: string;
	fallbackPool: string[];
}

const BOOK_FILES: Record<AgentRole, string> = {
	'director': 'Director Book V2.md',
	'actress': 'Actress Book V2.md',
	'reviewer': 'Reviewer Book V1.md',
	'cutter': 'Cutter Book V2.md',
	'archivist': 'Archivist Book V2.md',
	'director-user': 'Director for User v1.md',
	'actor-user': 'Actor for User v1.md',
};

export function loadBook(role: AgentRole): string {
	const filename = BOOK_FILES[role];
	const filepath = join(BOOKS_DIR, filename);
	return readFileSync(filepath, 'utf-8');
}

export function loadModelProfile(role: AgentRole, model: string): string | null {
	const roleName = role === 'director-user' ? 'Director for User'
		: role === 'actor-user' ? 'Actor for User'
		: role.charAt(0).toUpperCase() + role.slice(1);
	const filename = `Model Profile – ${roleName} – ${model}.md`;
	const filepath = join(BOOKS_DIR, filename);
	if (!existsSync(filepath)) return null;
	return readFileSync(filepath, 'utf-8');
}

export function loadCharacterSheet(name: CharacterName): CharacterSheet {
	const filepath = join(CHARACTERS_DIR, `Character_Sheet_${name}.md`);
	const text = readFileSync(filepath, 'utf-8');
	const sections = parseCharacterSections(text);

	return {
		voiceBlock: sections['VOICE BLOCK'] ?? '',
		canon: {
			lifeFacts: sections['CANON — life_facts'] ?? '',
			backstory: sections['CANON — backstory'] ?? '',
			sensitivities: sections['CANON — sensitivities'] ?? '',
			wantsAndFears: sections['CANON — wants_and_fears'] ?? '',
			eroticSelf: sections['CANON — erotic_self'] ?? '',
		},
		casting: sections['CASTING'] ?? '',
		disclosureLine: extractDisclosureLine(sections['DISCLOSURE LINE'] ?? ''),
		fallbackPool: extractFallbackLines(sections['FALLBACK POOL'] ?? ''),
	};
}

function parseCharacterSections(text: string): Record<string, string> {
	const sections: Record<string, string> = {};
	const lines = text.split('\n');
	let currentHeader: string | null = null;
	let currentContent: string[] = [];

	for (const line of lines) {
		const headerMatch = line.match(/^## (.+)/);
		if (headerMatch) {
			if (currentHeader) {
				sections[currentHeader] = currentContent.join('\n').trim();
			}
			currentHeader = headerMatch[1].trim();
			currentContent = [];
		} else if (currentHeader) {
			currentContent.push(line);
		}
	}

	if (currentHeader) {
		sections[currentHeader] = currentContent.join('\n').trim();
	}

	return sections;
}

function extractDisclosureLine(section: string): string {
	const lines = section.split('\n');
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
			return trimmed.slice(1, -1);
		}
		if (trimmed.startsWith('“') && trimmed.endsWith('”')) {
			return trimmed.slice(1, -1);
		}
	}
	return section.trim();
}

function extractFallbackLines(section: string): string[] {
	return section
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.startsWith('- '))
		.map(line => {
			let text = line.slice(2).trim();
			if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1);
			if (text.startsWith('“') && text.endsWith('”')) text = text.slice(1, -1);
			return text;
		});
}

export function extractFirstTurnInsert(directorBookText: string): string {
	const marker = '# SERVED INSERT: FIRST TURN';
	const idx = directorBookText.indexOf(marker);
	if (idx === -1) return '';

	const afterMarker = directorBookText.slice(idx + marker.length);
	const lines = afterMarker.split('\n');

	const contentLines: string[] = [];
	let started = false;

	for (const line of lines) {
		if (!started) {
			if (line.trim() === '' || line.startsWith('#')) continue;
			started = true;
		}
		if (started) {
			if (line.startsWith('# ') && !line.startsWith('# SERVED')) break;
			if (line === '---' && contentLines.length > 0) break;
			contentLines.push(line);
		}
	}

	return contentLines.join('\n').trim();
}

export type OnboardingState = {
	hasName: boolean;
	hasAlias: boolean;
	userName?: string;
	userAlias?: string;
};

export function buildIdentityHeader(characterName: string, onboarding: OnboardingState): string {
	if (onboarding.hasName && onboarding.hasAlias) {
		return `You are ${characterName}. You are talking to ${onboarding.userName}. He likes to be addressed as ${onboarding.userAlias}.`;
	}
	if (onboarding.hasName && !onboarding.hasAlias) {
		return `You are ${characterName}. You are talking to ${onboarding.userName}.`;
	}
	if (!onboarding.hasName && onboarding.hasAlias) {
		return `You are ${characterName}. You don't yet know his name, but he likes to be called ${onboarding.userAlias}.`;
	}
	return `You are ${characterName}. You don't yet know the name of the person you are talking to.`;
}
