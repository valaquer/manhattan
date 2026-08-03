import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAllSessions } from '$lib/server/db';
import db from '$lib/server/db';

export const GET: RequestHandler = async () => {
	const sessions = getAllSessions();
	const enriched = sessions.map(s => {
		const turnCount = db.prepare(
			'SELECT COUNT(DISTINCT turn_number) as count FROM pipeline_outputs WHERE session_id = ?'
		).get(s.id) as { count: number };
		return { ...s, turnCount: turnCount.count };
	});
	return json({ sessions: enriched });
};
