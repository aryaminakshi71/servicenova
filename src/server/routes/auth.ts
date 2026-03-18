import { drizzle } from 'drizzle-orm/postgres-js';
import { Hono } from 'hono';
import postgres from 'postgres';
import * as schema from '../../../drizzle/schema';
import { createAuth } from '../../../packages/auth/src/index';

const connectionString =
	process.env.DATABASE_URL ||
	'postgresql://postgres:postgres@localhost:5432/servicenova-ai';
const client = postgres(connectionString);
const db = drizzle(client, { schema });
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || '';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || '';
const githubClientId = process.env.GITHUB_CLIENT_ID?.trim() || '';
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET?.trim() || '';

const oauthProviders: {
	google?: { clientId: string; clientSecret: string };
	github?: { clientId: string; clientSecret: string };
} = {};

if (googleClientId && googleClientSecret) {
	oauthProviders.google = {
		clientId: googleClientId,
		clientSecret: googleClientSecret,
	};
}

if (githubClientId && githubClientSecret) {
	oauthProviders.github = {
		clientId: githubClientId,
		clientSecret: githubClientSecret,
	};
}

const auth = createAuth({
	db,
	secret: process.env.BETTER_AUTH_SECRET || 'change-me-please-32-chars-minimum',
	baseURL: process.env.VITE_PUBLIC_SITE_URL || 'http://localhost:3403',
	oauth: Object.keys(oauthProviders).length > 0 ? oauthProviders : undefined,
});

export const authRoutes = new Hono();

authRoutes.all('/api/auth/*', async (c) => {
	return auth.handler(c.req.raw);
});
