import { json } from '@sveltejs/kit';
import {
	assembleDirectorBooks,
	assembleActressBooks,
	assembleCutterBooks,
} from '$lib/server/books';

export function GET() {
	try {
		const turnContext = {
			turnNumber: 1,
			timestamp: '10:47 PM',
			stage: 'Acquaintance',
			pacing: 'Decompression',
		};

		const director = assembleDirectorBooks('deepseek', 'cydonia', turnContext);
		const actress = assembleActressBooks();
		const cutter = assembleCutterBooks('deepseek');

		return json({
			director: {
				modules: director.modules,
				chars: director.prompt.length,
				preview: director.prompt.slice(0, 200),
			},
			actress: {
				modules: actress.modules,
				chars: actress.prompt.length,
				preview: actress.prompt.slice(0, 200),
			},
			cutter: {
				modules: cutter.modules,
				chars: cutter.prompt.length,
				preview: cutter.prompt.slice(0, 200),
			},
		});
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return json({ error: msg }, { status: 500 });
	}
}
