import type { RequestHandler } from './$types';
import { onReview } from '$lib/server/events';

export const GET: RequestHandler = async () => {
	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			let closed = false;

			const cleanup = onReview((e: CustomEvent) => {
				if (closed) return;
				try {
					const data = JSON.stringify(e.detail);
					controller.enqueue(encoder.encode(`data: ${data}\n\n`));
				} catch {
					closed = true;
					clearInterval(keepalive);
					cleanup();
				}
			});

			const keepalive = setInterval(() => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(': keepalive\n\n'));
				} catch {
					closed = true;
					clearInterval(keepalive);
					cleanup();
				}
			}, 15000);
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
