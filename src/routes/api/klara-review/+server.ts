import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOrCreateSession, saveKlaraReview } from '$lib/server/db';
import { emitReview } from '$lib/server/events';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const sessionId = body.sessionId ?? getOrCreateSession();
	const { turnNumber, stage, review } = body;

	if (!turnNumber || !stage || !review) {
		return json({ error: 'turnNumber, stage, and review are required' }, { status: 400 });
	}

	const id = saveKlaraReview(sessionId, turnNumber, stage, review);
	emitReview(sessionId, turnNumber, stage);
	return json({ ok: true, id });
};
