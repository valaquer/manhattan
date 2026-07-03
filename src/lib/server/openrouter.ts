import { OPENROUTER_API_KEY } from '$env/static/private';

const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface Message {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

interface ModelParams {
	temperature?: number;
	top_p?: number;
	top_k?: number;
	min_p?: number;
	repetition_penalty?: number;
	max_tokens?: number;
}

export async function callModel(
	model: string,
	systemPrompt: string,
	messages: Message[],
	params: ModelParams = {}
): Promise<string> {
	const res = await fetch(API_URL, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model,
			messages: [{ role: 'system', content: systemPrompt }, ...messages],
			...params,
			stream: false,
		}),
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`OpenRouter ${res.status}: ${err}`);
	}

	const data = await res.json();
	return data.choices[0].message.content;
}

export async function* streamModel(
	model: string,
	systemPrompt: string,
	messages: Message[],
	params: ModelParams = {}
): AsyncGenerator<string> {
	const res = await fetch(API_URL, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model,
			messages: [{ role: 'system', content: systemPrompt }, ...messages],
			...params,
			stream: true,
		}),
	});

	if (!res.ok) {
		const err = await res.text();
		throw new Error(`OpenRouter ${res.status}: ${err}`);
	}

	const reader = res.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() || '';

		for (const line of lines) {
			if (!line.startsWith('data: ')) continue;
			const payload = line.slice(6).trim();
			if (payload === '[DONE]') return;

			try {
				const chunk = JSON.parse(payload);
				const delta = chunk.choices?.[0]?.delta?.content;
				if (delta) yield delta;
			} catch {
				// skip malformed chunks
			}
		}
	}
}

export function parseJsonFromText(text: string): unknown {
	// Strip markdown code fences if present
	let cleaned = text.trim();
	if (cleaned.startsWith('```')) {
		cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
	}
	return JSON.parse(cleaned);
}
