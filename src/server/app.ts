import { Hono } from 'hono';
import { resetDisruptionFeedProviderForTests } from '../features/field-ops/disruption-feed';
import { resetFieldIntelligenceProviderForTests } from '../features/field-ops/intelligence-provider';
import { resetFieldOpsStateForTests } from '../features/field-ops/service';
import { resetIntegrationStateForTests } from '../features/integrations';
import { requireAuth } from './auth';
import {
	resetBackgroundJobsForTests,
	startBackgroundJobsRuntime,
} from './background-jobs';
import { configureFieldOpsPersistenceFromEnv } from './db/persistence';
import { resetFieldDashboardStateForTests } from './field-dashboard-state';
import { requestTracing, resetObservabilityForTests } from './observability';
import { resetRateLimiterForTests } from './rate-limit';
import { authRoutes } from './routes/auth';
import { fieldRoutes } from './routes/field';

export function createApp() {
	const app = new Hono();

	void configureFieldOpsPersistenceFromEnv().finally(() => {
		startBackgroundJobsRuntime();
	});
	app.use('*', requestTracing());
	app.use('/api/field/*', requireAuth());

	app.onError((error, c) => {
		const requestId =
			c.req.header('x-request-id') ?? `req-${crypto.randomUUID()}`;
		const contextVariables = (c as unknown as { var?: Record<string, unknown> })
			.var;
		const traceId =
			(typeof contextVariables?.traceId === 'string'
				? contextVariables.traceId
				: undefined) ??
			c.req.header('x-trace-id') ??
			null;
		c.header('x-request-id', requestId);
		if (traceId) {
			c.header('x-trace-id', traceId);
		}

		if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
			console.error(
				`[error] ${JSON.stringify({
					requestId,
					traceId,
					method: c.req.method,
					path: c.req.path,
					message: error.message,
				})}`,
			);
		}

		return c.json(
			{
				error: 'Internal server error',
				requestId,
				traceId,
			},
			500,
		);
	});

	app.get('/api/health', (c) => c.json({ ok: true, app: 'servicenova-ai' }));
	if (process.env.NODE_ENV !== 'production') {
		app.post('/api/test/reset', async (c) => {
			const expectedResetToken = process.env.E2E_TEST_RESET_TOKEN?.trim();
			const providedResetToken = c.req.header('x-e2e-test-token') ?? '';

			if (!expectedResetToken || providedResetToken !== expectedResetToken) {
				return c.json({ error: 'Not found' }, 404);
			}

			resetFieldOpsStateForTests();
			resetFieldDashboardStateForTests();
			resetDisruptionFeedProviderForTests();
			resetFieldIntelligenceProviderForTests();
			await resetIntegrationStateForTests();
			await resetBackgroundJobsForTests();
			resetObservabilityForTests();
			resetRateLimiterForTests();

			return c.json({ ok: true });
		});
	}
	app.get('/api/ai/field/intelligence', (c) =>
		c.json({
			ok: true,
			entrypoint: '/api/field/jobs/:jobId/intelligence',
			message: 'Use field intelligence endpoints for work-order AI analysis.',
		}),
	);
	app.route('/api/auth', authRoutes);
	app.route('/api/field', fieldRoutes);
	app.notFound((c) => {
		if (c.req.method === 'GET' && !c.req.path.startsWith('/api/')) {
			return c.redirect('/', 302);
		}

		return c.json({ error: 'Not found' }, 404);
	});

	return app;
}
