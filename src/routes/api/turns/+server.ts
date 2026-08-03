import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOrCreateSession, getAllMessages, getMemory, getKlaraReviews } from '$lib/server/db';
import db from '$lib/server/db';

export const GET: RequestHandler = async ({ url }) => {
	const requestedSession = url.searchParams.get('sessionId');
	const sessionId = requestedSession ? parseInt(requestedSession, 10) : getOrCreateSession();

	const MODEL_PRICING: Record<string, { input: number; output: number }> = {
		'deepseek/deepseek-v4-flash-0731': { input: 0.09, output: 0.18 },
		'deepseek/deepseek-v4-flash': { input: 0.09, output: 0.18 },
		'nousresearch/hermes-4-70b': { input: 0.13, output: 0.40 },
	};

	// Get all pipeline outputs grouped by turn
	const outputs = db.prepare(
		'SELECT turn_number, stage, model, content, prompt_tokens, completion_tokens, model_params FROM pipeline_outputs WHERE session_id = ? ORDER BY id'
	).all(sessionId) as Array<{ turn_number: number; stage: string; model: string; content: string; prompt_tokens: number | null; completion_tokens: number | null; model_params: string | null }>;

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
		const pricing = MODEL_PRICING[o.model];
		const costUsd = pricing && o.prompt_tokens && o.completion_tokens
			? (o.prompt_tokens * pricing.input + o.completion_tokens * pricing.output) / 1_000_000
			: null;
		turnMap.get(o.turn_number)!.push({
			type: o.stage,
			sender: senderMap[o.stage] || o.stage,
			content: o.content,
			promptTokens: o.prompt_tokens,
			completionTokens: o.completion_tokens,
			costUsd,
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

	// Interleave Klara reviews after each agent block
	for (const [turnNum, blocks] of turnMap) {
		const reviews = getKlaraReviews(sessionId, turnNum);
		const reviewMap = new Map<string, string>();
		for (const r of reviews) reviewMap.set(r.stage, r.review);

		const interleaved: typeof blocks = [];
		for (const block of blocks) {
			interleaved.push(block);
			const review = reviewMap.get(block.type);
			if (review) {
				interleaved.push({ type: 'klara', sender: `Klara on ${block.type}`, content: review });
				reviewMap.delete(block.type);
			}
		}
		for (const [stage, review] of reviewMap) {
			interleaved.push({ type: 'klara', sender: `Klara on ${stage}`, content: review });
		}
		turnMap.set(turnNum, interleaved);
	}

	const turns = Array.from(turnMap.entries())
		.sort(([a], [b]) => a - b)
		.map(([number, blocks]) => ({ number, blocks }));

	return json({ sessionId, turns });
};
