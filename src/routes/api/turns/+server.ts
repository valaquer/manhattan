import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOrCreateSession, getTurns } from '$lib/server/db';

export const GET: RequestHandler = async () => {
	const sessionId = getOrCreateSession();
	const turns = getTurns(sessionId);
	return json({ sessionId, turns });
};
