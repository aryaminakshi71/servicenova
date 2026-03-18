const OPENROUTER_BASE_URL =
	process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const AI_MODEL =
	process.env.OPENROUTER_MODEL || process.env.OPENAI_MODEL || 'openai/gpt-5.2';
const AI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 30000);
const AI_RETRIES = Math.max(0, Number(process.env.OPENAI_RETRIES || 1));
const PLATFORM_PROMPT_VERSION = process.env.PLATFORM_PROMPT_VERSION || 'v1';
const AI_API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;

function buildHeaders(): Record<string, string> {
	if (!AI_API_KEY) return {};
	const headers: Record<string, string> = {
		Authorization: `Bearer ${AI_API_KEY}`,
		'Content-Type': 'application/json',
	};
	if (process.env.OPENROUTER_HTTP_REFERER) {
		headers['HTTP-Referer'] = process.env.OPENROUTER_HTTP_REFERER;
	}
	if (process.env.OPENROUTER_X_TITLE) {
		headers['X-Title'] = process.env.OPENROUTER_X_TITLE;
	}
	return headers;
}

export function isAIConfigured(): boolean {
	return !!AI_API_KEY;
}

export async function requestStructuredAi(
	systemPrompt: string,
	userContent: string,
	options?: { promptVersion?: string },
): Promise<Record<string, unknown> | null> {
	if (!AI_API_KEY) return null;

	const promptVersion = options?.promptVersion || PLATFORM_PROMPT_VERSION;

	for (let attempt = 0; attempt <= AI_RETRIES; attempt += 1) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

		try {
			const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
				method: 'POST',
				headers: buildHeaders(),
				body: JSON.stringify({
					model: AI_MODEL,
					messages: [
						{
							role: 'system',
							content: `[prompt-version:${promptVersion}] ${systemPrompt}`,
						},
						{ role: 'user', content: userContent },
					],
					response_format: { type: 'json_object' },
				}),
				signal: controller.signal,
			});
			if (!response.ok) {
				throw new Error(`AI request failed with status ${response.status}`);
			}
			const payload = (await response.json()) as {
				choices?: Array<{ message?: { content?: string } }>;
			};
			const content = payload.choices?.[0]?.message?.content;
			if (!content) return null;
			return JSON.parse(content);
		} catch (error) {
			if (attempt >= AI_RETRIES) {
				console.error('[platform-ai] structured request failed:', error);
				return null;
			}
		} finally {
			clearTimeout(timer);
		}
	}

	return null;
}
