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
	reasoning_effort?: string;
}

export interface Usage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

export interface ModelResult {
	content: string;
	usage: Usage | null;
}

export async function callModel(
	model: string,
	systemPrompt: string,
	messages: Message[],
	params: ModelParams = {}
): Promise<ModelResult> {
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
	const usage: Usage | null = data.usage ? {
		prompt_tokens: data.usage.prompt_tokens ?? 0,
		completion_tokens: data.usage.completion_tokens ?? 0,
		total_tokens: data.usage.total_tokens ?? 0,
	} : null;
	return { content: data.choices[0].message.content, usage };
}

export interface StreamResult {
	content: string;
	usage: Usage | null;
}

export async function streamModelBuffered(
	model: string,
	systemPrompt: string,
	messages: Message[],
	params: ModelParams = {}
): Promise<StreamResult> {
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
	let content = '';
	let usage: Usage | null = null;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split('\n');
		buffer = lines.pop() || '';

		for (const line of lines) {
			if (!line.startsWith('data: ')) continue;
			const payload = line.slice(6).trim();
			if (payload === '[DONE]') continue;

			try {
				const chunk = JSON.parse(payload);
				const delta = chunk.choices?.[0]?.delta?.content;
				if (delta) content += delta;
				if (chunk.usage) {
					usage = {
						prompt_tokens: chunk.usage.prompt_tokens ?? 0,
						completion_tokens: chunk.usage.completion_tokens ?? 0,
						total_tokens: chunk.usage.total_tokens ?? 0,
					};
				}
			} catch {
				// skip malformed chunks
			}
		}
	}

	return { content: content.trim(), usage };
}

export function parseJsonFromText(text: string): unknown {
	// Strip markdown code fences if present
	let cleaned = text.trim();
	if (cleaned.startsWith('```')) {
		cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
	}
	return JSON.parse(cleaned);
}
