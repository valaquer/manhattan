import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOrCreateSession, deleteSession } from '$lib/server/db';

export const POST: RequestHandler = async () => {
	const sessionId = getOrCreateSession();
	deleteSession(sessionId);
	return json({ ok: true });
};
