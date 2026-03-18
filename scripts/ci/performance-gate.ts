import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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

function appendSummary(line: string) {
	const path = process.env.GITHUB_STEP_SUMMARY;
	if (!path) {
		return;
	}

	writeFileSync(path, `${line}\n`, { flag: 'a' });
}

const totalRequests = parseNumberEnv('PERF_GATE_REQUESTS', 180, 20, 2000);
const concurrency = parseNumberEnv('PERF_GATE_CONCURRENCY', 12, 1, 200);
const maxP95Ms = parseNumberEnv('PERF_GATE_MAX_P95_MS', 1200, 50, 30000);
const maxErrorRate = parseNumberEnv('PERF_GATE_MAX_ERROR_RATE', 0.02, 0, 1);
const minThroughputRps = parseNumberEnv(
	'PERF_GATE_MIN_THROUGHPUT_RPS',
	30,
	1,
	10000,
);
const outputPath = resolve(
	process.env.PERF_GATE_OUTPUT_PATH ?? 'test-results/performance-gate.json',
);

process.env.FEATURE_BACKGROUND_WORKERS = 'false';
process.env.VITEST = 'true';

const [
	{ createApp },
	{ resetFieldOpsStateForTests, updateTechnicianShift },
	{ resetDisruptionFeedProviderForTests },
	{ resetFieldIntelligenceProviderForTests },
	{ resetIntegrationStateForTests },
	{ resetBackgroundJobsForTests },
	{ resetObservabilityForTests },
	{ resetRateLimiterForTests },
] = await Promise.all([
	import('../../src/server/app'),
	import('../../src/features/field-ops'),
	import('../../src/features/field-ops/disruption-feed'),
	import('../../src/features/field-ops/intelligence-provider'),
	import('../../src/features/integrations'),
	import('../../src/server/background-jobs'),
	import('../../src/server/observability'),
	import('../../src/server/rate-limit'),
]);

resetFieldOpsStateForTests();
resetDisruptionFeedProviderForTests();
resetFieldIntelligenceProviderForTests();
await resetIntegrationStateForTests();
await resetBackgroundJobsForTests();
resetObservabilityForTests();
resetRateLimiterForTests();

updateTechnicianShift({
	technicianId: 'tech-a1',
	start: '00:00',
	end: '23:59',
});
updateTechnicianShift({
	technicianId: 'tech-b2',
	start: '00:00',
	end: '23:59',
});
updateTechnicianShift({
	technicianId: 'tech-c3',
	start: '00:00',
	end: '23:59',
});

const app = createApp();
const headers = {
	authorization: 'Bearer manager:perf-gate',
};

const failures: Array<{ request: number; status: number }> = [];
let nextRequest = 0;

async function worker() {
	while (true) {
		const requestNumber = nextRequest;
		nextRequest += 1;
		if (requestNumber >= totalRequests) {
			return;
		}

		const response = await app.request('/api/field/dispatch-board', {
			headers,
		});

		if (!response.ok) {
			failures.push({
				request: requestNumber,
				status: response.status,
			});
		}
	}
}

const startedAt = Date.now();
await Promise.all(Array.from({ length: concurrency }, () => worker()));
const elapsedMs = Date.now() - startedAt;
const throughputRps = Number(
	(totalRequests / Math.max(1, elapsedMs / 1000)).toFixed(2),
);

const metricsResponse = await app.request(
	'/api/field/observability/metrics?windowMinutes=60',
	{
		headers,
	},
);

if (!metricsResponse.ok) {
	console.error(
		`[perf-gate] Failed to fetch observability metrics (HTTP ${metricsResponse.status}).`,
	);
	process.exit(1);
}

const metricsPayload = (await metricsResponse.json()) as {
	metrics: {
		totalRequests: number;
		errorRate: number;
		p95Ms: number;
		sloBreached: boolean;
	};
};

const result = {
	generatedAt: new Date().toISOString(),
	load: {
		totalRequests,
		concurrency,
		elapsedMs,
		throughputRps,
		failures,
	},
	metrics: metricsPayload.metrics,
	thresholds: {
		maxP95Ms,
		maxErrorRate,
		minThroughputRps,
	},
	pass: true,
};

const violations: string[] = [];
if (failures.length > 0) {
	violations.push(`non-2xx responses during load: ${failures.length}`);
}
if (metricsPayload.metrics.p95Ms > maxP95Ms) {
	violations.push(`p95 ${metricsPayload.metrics.p95Ms}ms > ${maxP95Ms}ms`);
}
if (metricsPayload.metrics.errorRate > maxErrorRate) {
	violations.push(
		`errorRate ${metricsPayload.metrics.errorRate} > ${maxErrorRate}`,
	);
}
if (throughputRps < minThroughputRps) {
	violations.push(`throughput ${throughputRps}rps < ${minThroughputRps}rps`);
}

result.pass = violations.length === 0;
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

appendSummary('\nPerformance gate');
appendSummary(`- requests: ${totalRequests}`);
appendSummary(`- concurrency: ${concurrency}`);
appendSummary(`- throughput: ${throughputRps} rps`);
appendSummary(`- p95: ${metricsPayload.metrics.p95Ms} ms`);
appendSummary(`- errorRate: ${metricsPayload.metrics.errorRate}`);
appendSummary(`- pass: ${result.pass}`);

if (violations.length > 0) {
	console.error('[perf-gate] Performance gate failed.');
	for (const violation of violations) {
		console.error(`- ${violation}`);
	}
	process.exit(1);
}

console.log(
	`[perf-gate] Passed: throughput=${throughputRps}rps, p95=${metricsPayload.metrics.p95Ms}ms, errorRate=${metricsPayload.metrics.errorRate}`,
);
