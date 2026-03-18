import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { apiKey, openAPI, organization } from 'better-auth/plugins';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';

export interface AuthConfig {
	db: PostgresJsDatabase<typeof schema>;
	secret: string;
	baseURL: string;
	oauth?: {
		google?: {
			clientId: string;
			clientSecret: string;
		};
		github?: {
			clientId: string;
			clientSecret: string;
		};
	};
	trustedOrigins?: string[];
}

export function createAuth(config: AuthConfig) {
	const { db, secret, baseURL, oauth, trustedOrigins = [] } = config;

	const plugins = [
		organization({
			allowUserToCreateOrganization: true,
			organizationLimit: 3,
		}),
		apiKey({
			enableMetadata: true,
			apiKeyHeaders: 'x-api-key',
		}),
		openAPI(),
	];

	return betterAuth({
		database: drizzleAdapter(db, {
			provider: 'pg',
			schema: schema,
			usePlural: true,
		}),
		secret,
		baseURL,
		basePath: '/api/auth',
		session: {
			expiresIn: 60 * 60 * 24 * 30,
			updateAge: 60 * 60 * 24 * 7,
		},
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: false,
		},
		socialProviders: {
			...(oauth?.google && {
				google: {
					clientId: oauth.google.clientId,
					clientSecret: oauth.google.clientSecret,
				},
			}),
			...(oauth?.github && {
				github: {
					clientId: oauth.github.clientId,
					clientSecret: oauth.github.clientSecret,
				},
			}),
		},
		plugins,
		advanced: {
			useSecureCookies: true,
			cookiePrefix: 'servicenova',
			database: {
				generateId: () => crypto.randomUUID(),
			},
		},
		trustedOrigins: [baseURL, ...trustedOrigins],
	});
}

export type Auth = ReturnType<typeof createAuth>;
