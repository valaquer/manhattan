import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOrCreateSession, getAllMessages, getMemory, getKlaraReviews } from '$lib/server/db';
import db from '$lib/server/db';

export const GET: RequestHandler = async ({ url }) => {
	const requestedSession = url.searchParams.get('sessionId');
	const sessionId = requestedSession ? parseInt(requestedSession, 10) : getOrCreateSession();

	// Get all pipeline outputs grouped by turn
	const outputs = db.prepare(
		'SELECT turn_number, stage, content, prompt_tokens, completion_tokens, model_params FROM pipeline_outputs WHERE session_id = ? ORDER BY id'
	).all(sessionId) as Array<{ turn_number: number; stage: string; content: string; prompt_tokens: number | null; completion_tokens: number | null; model_params: string | null }>;

	// Get all messages
	const messages = getAllMessages(sessionId);

	// Build turns from combined data
	const turnMap = new Map<number, Array<{ type: string; sender: string; content: string }>>();

	// Add pipeline outputs as blocks
	for (const o of outputs) {
		if (!turnMap.has(o.turn_number)) turnMap.set(o.turn_number, []);
		const senderMap: Record<string, string> = {
			'director-for-user': 'Director for User',
			'actor-for-user': 'Actor for User',
			'director-for-character': 'Director for Character',
			'actress-for-character': 'Actress for Character',
			'artisan-cutter': 'Artisan Cutter',
		};
		turnMap.get(o.turn_number)!.push({
			type: o.stage,
			sender: senderMap[o.stage] || o.stage,
			content: o.content,
			promptTokens: o.prompt_tokens,
			completionTokens: o.completion_tokens,
		});
	}

	// If no pipeline outputs exist, build from messages only
	if (outputs.length === 0) {
		for (const m of messages) {
			if (!turnMap.has(m.turn_number)) turnMap.set(m.turn_number, []);
			turnMap.get(m.turn_number)!.push({
				type: m.sender === 'Marcus' ? 'actor-for-user' : 'actress-for-character',
				sender: m.sender === 'Marcus' ? 'Actor for User' : 'Actress for Character',
				content: m.content,
			});
		}
	}

	// Add Klara reviews after each agent block
	for (const [turnNum, blocks] of turnMap) {
		const reviews = getKlaraReviews(sessionId, turnNum);
		for (const r of reviews) {
			blocks.push({
				type: 'klara',
				sender: `Klara on ${r.stage}`,
				content: r.review,
			});
		}
	}

	const turns = Array.from(turnMap.entries())
		.sort(([a], [b]) => a - b)
		.map(([number, blocks]) => ({ number, blocks }));

	return json({ sessionId, turns });
};
