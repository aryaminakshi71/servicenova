import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { createApp } from './src/server/app';

const app = createApp();
const googleAuthEnabled = Boolean(
	process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);
const githubAuthEnabled = Boolean(
	process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET,
);

function apiMiddlewarePlugin() {
	return {
		name: 'servicenova-api-middleware',
		configureServer(server: {
			middlewares: {
				use: (
					handler: (
						req: import('node:http').IncomingMessage,
						res: import('node:http').ServerResponse,
						next: (error?: Error) => void,
					) => void | Promise<void>,
				) => void;
			};
		}) {
			server.middlewares.use(async (req, res, next) => {
				const requestUrl = req.url ?? '/';

				if (!requestUrl.startsWith('/api/')) {
					next();
					return;
				}

				try {
					const origin = `http://${req.headers.host ?? 'localhost'}`;
					const url = new URL(requestUrl, origin);
					const headers = new Headers();

					for (const [key, value] of Object.entries(req.headers)) {
						if (typeof value === 'undefined') {
							continue;
						}

						if (Array.isArray(value)) {
							for (const item of value) {
								headers.append(key, item);
							}
							continue;
						}

						headers.append(key, value);
					}

					const method = req.method ?? 'GET';
					const hasBody = method !== 'GET' && method !== 'HEAD';
					let body: ArrayBuffer | undefined;

					if (hasBody) {
						const chunks: Uint8Array[] = [];

						for await (const chunk of req) {
							if (typeof chunk === 'string') {
								chunks.push(Buffer.from(chunk));
							} else {
								chunks.push(chunk);
							}
						}

						if (chunks.length > 0) {
							const rawBody = Buffer.concat(chunks);
							body = rawBody.buffer.slice(
								rawBody.byteOffset,
								rawBody.byteOffset + rawBody.byteLength,
							);
						}
					}

					const response = await app.request(
						new Request(url, {
							method,
							headers,
							body,
						}),
					);

					res.statusCode = response.status;

					response.headers.forEach((value, key) => {
						res.setHeader(key, value);
					});

					if (response.body) {
						const responseBuffer = Buffer.from(await response.arrayBuffer());
						res.end(responseBuffer);
						return;
					}

					res.end();
				} catch (error) {
					next(error as Error);
				}
			});
		},
	};
}

export default defineConfig({
	define: {
		__SERVICENOVA_GOOGLE_AUTH_ENABLED__: JSON.stringify(googleAuthEnabled),
		__SERVICENOVA_GITHUB_AUTH_ENABLED__: JSON.stringify(githubAuthEnabled),
	},
	plugins: [
		react(),
		tailwindcss(),
		apiMiddlewarePlugin(),
		tsconfigPaths({ ignoreConfigErrors: true }),
	],
	resolve: {
		alias: {
			'~': path.resolve(__dirname, './src'),
		},
	},
	server: {
		port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3008,
	},
});
