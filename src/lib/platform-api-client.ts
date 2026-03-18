const viteEnv =
	(import.meta as ImportMeta & { env?: Record<string, string | undefined> })
		.env || {};
const DEFAULT_TIMEOUT_MS = Number(
	viteEnv.VITE_API_TIMEOUT_MS ||
		(typeof process !== 'undefined'
			? process.env.VITE_API_TIMEOUT_MS
			: undefined) ||
		15000,
);
const DEFAULT_RETRIES = Number(
	viteEnv.VITE_API_RETRIES ||
		(typeof process !== 'undefined'
			? process.env.VITE_API_RETRIES
			: undefined) ||
		1,
);

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function platformFetch(
	input: RequestInfo,
	init?: RequestInit,
): Promise<Response> {
	const retries = Math.max(0, DEFAULT_RETRIES);

	for (let attempt = 0; attempt <= retries; attempt += 1) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

		try {
			const response = await fetch(input, {
				credentials: 'include',
				...init,
				signal: controller.signal,
			});

			if (
				(response.status >= 500 || response.status === 429) &&
				attempt < retries
			) {
				await sleep(200 * (attempt + 1));
				continue;
			}

			return response;
		} catch (error) {
			if (attempt >= retries) {
				throw error;
			}
			await sleep(200 * (attempt + 1));
		} finally {
			clearTimeout(timer);
		}
	}

	throw new Error('platformFetch exhausted retries');
}
