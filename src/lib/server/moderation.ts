import { env } from '$env/dynamic/private';

const MODERATION_URL = 'https://api.openai.com/v1/moderations';

const RELEVANT_CATEGORIES = [
	'sexual/minors',
	'violence',
	'violence/graphic',
	'hate',
	'hate/threatening',
	'self-harm',
	'self-harm/intent',
	'self-harm/instructions',
] as const;

export interface ModerationResult {
	flagged: boolean;
	categories: string[];
}

export async function classifyMessage(text: string): Promise<ModerationResult | null> {
	if (!env.OPENAI_API_KEY) return null;

	try {
		const res = await fetch(MODERATION_URL, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ input: text }),
		});

		if (!res.ok) return null;

		const data = await res.json();
		const result = data.results?.[0];
		if (!result) return null;

		const flaggedCategories = RELEVANT_CATEGORIES.filter(
			cat => result.categories[cat] === true
		);

		return {
			flagged: flaggedCategories.length > 0,
			categories: flaggedCategories,
		};
	} catch {
		return null;
	}
}

export function renderModerationFlags(result: ModerationResult | null): string {
	if (!result || !result.flagged) return '';
	return `CONTENT CLASSIFIER FLAGS: ${result.categories.join(', ')}`;
}
