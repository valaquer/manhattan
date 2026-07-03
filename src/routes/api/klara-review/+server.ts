import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveBlock } from '$lib/server/db';
import db from '$lib/server/db';

// SSE connections for Klara reviews
const clients: Set<ReadableStreamDefaultController> = new Set();

export const POST: RequestHandler = async ({ request }) => {
	const { turnNumber, stage, feedback } = await request.json();

	if (!feedback || !stage || !turnNumber) {
		return json({ error: 'turnNumber, stage, and feedback are required' }, { status: 400 });
	}

	// Find the turn by number
	const turn = db.prepare('SELECT id FROM turns WHERE number = ? ORDER BY id DESC LIMIT 1').get(turnNumber) as { id: number } | undefined;
	if (!turn) {
		return json({ error: `Turn ${turnNumber} not found` }, { status: 404 });
	}

	// Save Klara block to DB
	saveBlock(turn.id, 'klara', 'Klara', feedback);

	// Notify SSE clients
	const event = JSON.stringify({ type: 'klara', sender: 'Klara', content: feedback, turnNumber, stage });
	const encoder = new TextEncoder();
	for (const controller of clients) {
		try {
			controller.enqueue(encoder.encode(`data: ${event}\n\n`));
		} catch {
			clients.delete(controller);
		}
	}

	return json({ ok: true });
};

export const GET: RequestHandler = async () => {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			clients.add(controller);
			controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));
		},
		cancel() {
			// cleanup handled by try/catch in POST
		},
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
		},
	});
};
