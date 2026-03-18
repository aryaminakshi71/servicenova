import type { MiddlewareHandler } from 'hono';
import { nowIso, nowMs, randomUuid } from './test-controls';
import {
	currentTraceId,
	currentTraceparent,
	withExtractedTraceContext,
	withSpan,
} from './tracing';

function requestId() {
	return `req-${randomUuid()}`;
}

function safeJson(value: unknown) {
	try {
		return JSON.stringify(value);
	} catch {
		return '"[unserializable]"';
	}
}

type RequestSample = {
	timestamp: number;
	durationMs: number;
	status: number;
	routeKey: string;
	tenantId: string;
};

export type ResilienceEventType =
	| 'integration_retry'
	| 'integration_circuit_open'
	| 'integration_circuit_short_circuit'
	| 'intelligence_provider_fallback';

type ResilienceEvent = {
	timestamp: number;
	tenantId: string;
	type: ResilienceEventType;
	service?: string;
	operation?: string;
};

type RouteAggregate = {
	route: string;
	requestCount: number;
	errorCount: number;
	p50Ms: number;
	p95Ms: number;
	p99Ms: number;
};

type ObservabilitySnapshot = {
	generatedAt: string;
	windowMinutes: number;
	totalRequests: number;
	errorRate: number;
	p95Ms: number;
	availabilityTarget: number;
	latencyTargetMs: number;
	sloBreached: boolean;
	routes: RouteAggregate[];
	resilience: {
		totalEvents: number;
		retryCount: number;
		circuitOpenCount: number;
		circuitShortCircuitCount: number;
		fallbackCount: number;
		byType: Array<{ type: ResilienceEventType; count: number }>;
	};
};

const SAMPLE_RETENTION_MS = 1000 * 60 * 60;
const MAX_SAMPLES = 10_000;
const samples: RequestSample[] = [];
const resilienceEvents: ResilienceEvent[] = [];

function percentile(sorted: number[], p: number) {
	if (sorted.length === 0) {
		return 0;
	}

	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
	);
	return sorted[index] ?? 0;
}

function trimSamples(nowMs: number) {
	const threshold = nowMs - SAMPLE_RETENTION_MS;
	let index = 0;

	while (index < samples.length && samples[index].timestamp < threshold) {
		index += 1;
	}

	if (index > 0) {
		samples.splice(0, index);
	}

	if (samples.length > MAX_SAMPLES) {
		samples.splice(0, samples.length - MAX_SAMPLES);
	}
}

function recordRequest(sample: RequestSample) {
	samples.push(sample);
	trimSamples(sample.timestamp);
}

function trimResilienceEvents(currentMs: number) {
	const threshold = currentMs - SAMPLE_RETENTION_MS;
	let index = 0;

	while (
		index < resilienceEvents.length &&
		resilienceEvents[index].timestamp < threshold
	) {
		index += 1;
	}

	if (index > 0) {
		resilienceEvents.splice(0, index);
	}

	if (resilienceEvents.length > MAX_SAMPLES) {
		resilienceEvents.splice(0, resilienceEvents.length - MAX_SAMPLES);
	}
}

export function recordResilienceEvent(input: {
	tenantId?: string;
	type: ResilienceEventType;
	service?: string;
	operation?: string;
}) {
	const event: ResilienceEvent = {
		timestamp: nowMs(),
		tenantId: input.tenantId?.trim() || 'default',
		type: input.type,
		service: input.service,
		operation: input.operation,
	};
	resilienceEvents.push(event);
	trimResilienceEvents(event.timestamp);
}

function parseNumberEnv(
	name: string,
	fallback: number,
	min: number,
	max: number,
) {
	const raw = process.env[name];

	if (raw === undefined) {
		return fallback;
	}

	const parsed = Number.parseFloat(raw);

	if (Number.isNaN(parsed)) {
		return fallback;
	}

	return Math.min(max, Math.max(min, parsed));
}

export function getObservabilitySnapshot(input?: {
	windowMinutes?: number;
	tenantId?: string;
}): ObservabilitySnapshot {
	const windowMinutes = Math.min(1440, Math.max(1, input?.windowMinutes ?? 60));
	const threshold = nowMs() - windowMinutes * 60 * 1000;
	const tenantIdFilter = input?.tenantId?.trim();
	const scopedSamples = samples.filter((sample) => {
		if (sample.timestamp < threshold) {
			return false;
		}

		if (tenantIdFilter && sample.tenantId !== tenantIdFilter) {
			return false;
		}

		return true;
	});
	const scopedResilienceEvents = resilienceEvents.filter((event) => {
		if (event.timestamp < threshold) {
			return false;
		}

		if (tenantIdFilter && event.tenantId !== tenantIdFilter) {
			return false;
		}

		return true;
	});

	const durations = scopedSamples
		.map((sample) => sample.durationMs)
		.sort((a, b) => a - b);
	const errorCount = scopedSamples.filter(
		(sample) => sample.status >= 500,
	).length;
	const grouped = new Map<string, RequestSample[]>();

	for (const sample of scopedSamples) {
		const bucket = grouped.get(sample.routeKey) ?? [];
		bucket.push(sample);
		grouped.set(sample.routeKey, bucket);
	}

	const routes: RouteAggregate[] = Array.from(grouped.entries())
		.map(([route, routeSamples]) => {
			const routeDurations = routeSamples
				.map((item) => item.durationMs)
				.sort((a, b) => a - b);
			const routeErrorCount = routeSamples.filter(
				(item) => item.status >= 500,
			).length;

			return {
				route,
				requestCount: routeSamples.length,
				errorCount: routeErrorCount,
				p50Ms: percentile(routeDurations, 50),
				p95Ms: percentile(routeDurations, 95),
				p99Ms: percentile(routeDurations, 99),
			};
		})
		.sort((a, b) => b.requestCount - a.requestCount)
		.slice(0, 50);

	const availabilityTarget = parseNumberEnv(
		'SLO_AVAILABILITY_TARGET',
		0.99,
		0.9,
		1,
	);
	const latencyTargetMs = parseNumberEnv('SLO_P95_MS_TARGET', 500, 50, 30_000);
	const errorRate =
		scopedSamples.length === 0 ? 0 : errorCount / scopedSamples.length;
	const p95Ms = percentile(durations, 95);
	const resilienceCountByType = new Map<ResilienceEventType, number>();

	for (const event of scopedResilienceEvents) {
		resilienceCountByType.set(
			event.type,
			(resilienceCountByType.get(event.type) ?? 0) + 1,
		);
	}

	return {
		generatedAt: nowIso(),
		windowMinutes,
		totalRequests: scopedSamples.length,
		errorRate: Number(errorRate.toFixed(4)),
		p95Ms: Number(p95Ms.toFixed(2)),
		availabilityTarget,
		latencyTargetMs,
		sloBreached: errorRate > 1 - availabilityTarget || p95Ms > latencyTargetMs,
		routes,
		resilience: {
			totalEvents: scopedResilienceEvents.length,
			retryCount: resilienceCountByType.get('integration_retry') ?? 0,
			circuitOpenCount:
				resilienceCountByType.get('integration_circuit_open') ?? 0,
			circuitShortCircuitCount:
				resilienceCountByType.get('integration_circuit_short_circuit') ?? 0,
			fallbackCount:
				resilienceCountByType.get('intelligence_provider_fallback') ?? 0,
			byType: Array.from(resilienceCountByType.entries())
				.map(([type, count]) => ({ type, count }))
				.sort((left, right) => right.count - left.count),
		},
	};
}

export function resetObservabilityForTests() {
	samples.splice(0, samples.length);
	resilienceEvents.splice(0, resilienceEvents.length);
}

export function requestTracing(): MiddlewareHandler {
	const isTestRuntime =
		process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

	return async (c, next) => {
		const startedAt = nowMs();
		const id = c.req.header('x-request-id') ?? requestId();
		const inboundTraceparent = c.req.header('traceparent');
		const inboundTracestate = c.req.header('tracestate');
		let traceId: string | null = null;
		let traceparent: string | null = null;

		c.set('requestId', id);
		await withExtractedTraceContext(
			{
				traceparent: inboundTraceparent,
				tracestate: inboundTracestate,
			},
			async () => {
				await withSpan(
					`${c.req.method} ${c.req.path}`,
					{
						'http.method': c.req.method,
						'http.route': c.req.path,
						'http.target': c.req.url,
						'servicenova.request_id': id,
					},
					async (span) => {
						traceId = currentTraceId();
						traceparent = currentTraceparent();
						c.set('traceId', traceId);
						await next();
						span.setAttribute('http.status_code', c.res.status);
					},
				);
			},
		);

		const durationMs = nowMs() - startedAt;
		const payload = {
			requestId: id,
			traceId,
			method: c.req.method,
			path: c.req.path,
			status: c.res.status,
			durationMs,
		};
		const auth = c.get('auth') as { tenantId?: string } | undefined;

		recordRequest({
			timestamp: nowMs(),
			durationMs,
			status: c.res.status,
			routeKey: `${c.req.method} ${c.req.path}`,
			tenantId: auth?.tenantId ?? c.req.header('x-tenant-id') ?? 'default',
		});

		c.header('x-request-id', id);
		if (traceId) {
			c.header('x-trace-id', traceId);
		}
		if (traceparent) {
			c.header('traceparent', traceparent);
		}
		if (!isTestRuntime) {
			console.info(`[request] ${safeJson(payload)}`);
		}
	};
}
