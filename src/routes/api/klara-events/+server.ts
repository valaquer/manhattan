import type { RequestHandler } from './$types';
import { onReview } from '$lib/server/events';

export const GET: RequestHandler = async () => {
	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			const cleanup = onReview((e: CustomEvent) => {
				const data = JSON.stringify(e.detail);
				controller.enqueue(encoder.encode(`data: ${data}\n\n`));
			});

			const keepalive = setInterval(() => {
				controller.enqueue(encoder.encode(': keepalive\n\n'));
			}, 15000);

			const checkClosed = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(''));
				} catch {
					clearInterval(keepalive);
					clearInterval(checkClosed);
					cleanup();
				}
			}, 30000);
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
