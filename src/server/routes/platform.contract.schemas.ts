import { z } from 'zod';

export const healthResponseSchema = z.object({
	ok: z.boolean(),
	app: z.string().min(1),
});

export const observabilityMetricsResponseSchema = z.object({
	metrics: z.object({
		generatedAt: z.string().min(1),
		windowMinutes: z.number().int().positive(),
		totalRequests: z.number().int().nonnegative(),
		errorRate: z.number(),
		p95Ms: z.number(),
		availabilityTarget: z.number(),
		latencyTargetMs: z.number(),
		sloBreached: z.boolean(),
		routes: z.array(
			z.object({
				route: z.string().min(1),
				requestCount: z.number().int().nonnegative(),
				errorCount: z.number().int().nonnegative(),
				p50Ms: z.number(),
				p95Ms: z.number(),
				p99Ms: z.number(),
			}),
		),
		resilience: z.object({
			totalEvents: z.number().int().nonnegative(),
			retryCount: z.number().int().nonnegative(),
			circuitOpenCount: z.number().int().nonnegative(),
			circuitShortCircuitCount: z.number().int().nonnegative(),
			fallbackCount: z.number().int().nonnegative(),
			byType: z.array(
				z.object({
					type: z.enum([
						'integration_retry',
						'integration_circuit_open',
						'integration_circuit_short_circuit',
						'intelligence_provider_fallback',
					]),
					count: z.number().int().nonnegative(),
				}),
			),
		}),
	}),
});

export const integrationOutboxSummarySchema = z.object({
	total: z.number().int().nonnegative(),
	pending: z.number().int().nonnegative(),
	processing: z.number().int().nonnegative(),
	delivered: z.number().int().nonnegative(),
	deadLetter: z.number().int().nonnegative(),
});

export const integrationOutboxEntrySchema = z.object({
	id: z.string().min(1),
	tenantId: z.string().min(1),
	type: z.enum(['crm_work_order_event']),
	status: z.enum(['pending', 'processing', 'delivered', 'dead_letter']),
	payload: z.object({
		jobId: z.string().min(1),
		customerId: z.string().min(1),
		status: z.enum(['open', 'assigned', 'in_progress', 'closed']),
		timestamp: z.string().min(1),
	}),
	attempts: z.number().int().nonnegative(),
	nextAttemptAt: z.string().min(1),
	createdAt: z.string().min(1),
	updatedAt: z.string().min(1),
	deliveredAt: z.string().nullable(),
	lastError: z.string().nullable(),
});

export const integrationOutboxListResponseSchema = z.object({
	summary: integrationOutboxSummarySchema,
	entries: z.array(integrationOutboxEntrySchema),
});

export const integrationOutboxFlushResponseSchema = z.object({
	result: z.object({
		processed: z.number().int().nonnegative(),
		delivered: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		deadLettered: z.number().int().nonnegative(),
	}),
	summary: integrationOutboxSummarySchema,
});

export const dashboardOnboardingStateSchema = z.object({
	selectedJob: z.boolean(),
	intelligenceRun: z.boolean(),
	dispatchOptimized: z.boolean(),
	automationCycle: z.boolean(),
	dismissed: z.boolean(),
	updatedAt: z.string().min(1),
	updatedBy: z.string().min(1),
});

export const dashboardOnboardingResponseSchema = z.object({
	onboarding: dashboardOnboardingStateSchema,
});

export const driftAlertAcknowledgementSchema = z.object({
	alertId: z.string().min(1),
	owner: z.string().min(1),
	acknowledgedBy: z.string().min(1),
	acknowledgedAt: z.string().min(1),
	slaDueAt: z.string().min(1),
	note: z.string().nullable(),
});

export const driftAlertSchema = z.object({
	id: z.string().min(1),
	severity: z.enum(['low', 'medium', 'high']),
	scope: z.enum(['overall', 'priority', 'skill']),
	segment: z.string().min(1),
	sampleCount: z.number().int().nonnegative(),
	message: z.string().min(1),
	triggeredAt: z.string().min(1),
	metrics: z.object({
		meanAbsoluteErrorMinutes: z.number(),
		within15MinutesRate: z.number(),
	}),
	acknowledged: z.boolean(),
	acknowledgement: driftAlertAcknowledgementSchema.nullable(),
});

export const driftAlertsResponseSchema = z.object({
	alerts: z.array(driftAlertSchema),
});

export const driftAlertAcknowledgeResponseSchema = z.object({
	acknowledged: z.literal(true),
	acknowledgement: driftAlertAcknowledgementSchema,
});

export const incidentTimelineEventSchema = z.object({
	id: z.string().min(1),
	type: z.string().min(1),
	severity: z.enum(['info', 'warning', 'critical']),
	message: z.string().min(1),
	timestamp: z.string().min(1),
	actor: z.string().min(1),
	context: z.record(z.string(), z.unknown()),
});

export const incidentTimelineResponseSchema = z.object({
	incidents: z.array(incidentTimelineEventSchema),
});
