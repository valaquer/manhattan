import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSession } from '$lib/server/db';

export const POST: RequestHandler = async () => {
	const sessionId = createSession();
	return json({ ok: true, sessionId });
};
