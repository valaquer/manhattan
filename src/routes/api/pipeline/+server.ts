import type { RequestHandler } from './$types';
import { runPipeline } from '$lib/server/engine';
import type { PipelineConfig } from '$lib/server/engine';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({})) as Partial<PipelineConfig>;

	const config: PipelineConfig = {
		characterName: body.characterName ?? 'Sophie',
		userInfo: body.userInfo ?? { hasName: false, hasAlias: false },
		mode: body.mode ?? 'fixture',
		sessionId: body.sessionId,
		windows: body.windows,
		models: body.models,
		retry: body.retry,
		reasoningEffort: body.reasoningEffort,
	};

	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			try {
				for await (const event of runPipeline(config)) {
					const data = JSON.stringify(event);
					controller.enqueue(encoder.encode(`data: ${data}\n\n`));
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				const errorEvent = JSON.stringify({ type: 'error', content: msg });
				controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`));
			} finally {
				controller.enqueue(encoder.encode('data: [DONE]\n\n'));
				controller.close();
			}
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
