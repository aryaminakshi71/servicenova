import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type CanaryStep = {
	name: string;
	method: 'GET' | 'POST';
	path: string;
	body?: unknown;
	expectStatus?: number;
};

type ObservabilityMetricsPayload = {
	metrics?: {
		totalRequests?: number;
		errorRate?: number;
		p95Ms?: number;
		sloBreached?: boolean;
	};
};

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

const baseUrl = (process.env.CANARY_BASE_URL ?? '').trim();
const authToken = (
	process.env.CANARY_AUTH_TOKEN ?? 'Bearer manager:canary'
).trim();
const canaryPhase = (process.env.CANARY_PHASE ?? '100').trim();
const metricsWindowMinutes = parseNumberEnv(
	'CANARY_METRICS_WINDOW_MINUTES',
	30,
	1,
	1_440,
);
const maxErrorRate = parseNumberEnv('CANARY_MAX_ERROR_RATE', 0.01, 0, 1);
const maxP95Ms = parseNumberEnv('CANARY_MAX_P95_MS', 1200, 50, 30_000);
const minAvailability = parseNumberEnv(
	'CANARY_MIN_AVAILABILITY',
	0.995,
	0.9,
	1,
);
const maxErrorBudgetBurnRate = parseNumberEnv(
	'CANARY_MAX_ERROR_BUDGET_BURN_RATE',
	2,
	0.01,
	100,
);
const outputPath = resolve(
	process.env.CANARY_OUTPUT_PATH ?? 'test-results/canary-report.json',
);

if (!baseUrl) {
	console.error('[canary] Missing CANARY_BASE_URL.');
	process.exit(1);
}

const normalizedBaseUrl = baseUrl.endsWith('/')
	? baseUrl.slice(0, -1)
	: baseUrl;
const steps: CanaryStep[] = [
	{
		name: 'health',
		method: 'GET',
		path: '/api/health',
		expectStatus: 200,
	},
	{
		name: 'dispatch-optimize',
		method: 'POST',
		path: '/api/field/dispatch/optimize',
		body: {
			includeAssigned: true,
			reason: 'canary-synthetic',
		},
		expectStatus: 200,
	},
	{
		name: 'outbox-flush',
		method: 'POST',
		path: '/api/field/integrations/outbox/flush',
		body: {
			maxBatch: 5,
		},
		expectStatus: 200,
	},
	{
		name: 'observability-metrics',
		method: 'GET',
		path: `/api/field/observability/metrics?windowMinutes=${metricsWindowMinutes}`,
		expectStatus: 200,
	},
];

const startedAt = Date.now();
const results: Array<{
	name: string;
	status: number;
	ok: boolean;
	durationMs: number;
	url: string;
}> = [];
let metricsPayload: ObservabilityMetricsPayload['metrics'] | null = null;

for (const step of steps) {
	const url = `${normalizedBaseUrl}${step.path}`;
	const requestStarted = Date.now();
	const response = await fetch(url, {
		method: step.method,
		headers: {
			authorization: authToken,
			'content-type': 'application/json',
		},
		body: step.body ? JSON.stringify(step.body) : undefined,
	});
	const durationMs = Date.now() - requestStarted;
	const expected = step.expectStatus ?? 200;
	const ok = response.status === expected;

	results.push({
		name: step.name,
		status: response.status,
		ok,
		durationMs,
		url,
	});

	if (step.name === 'observability-metrics' && ok) {
		const body = (await response
			.json()
			.catch(() => null)) as ObservabilityMetricsPayload | null;
		metricsPayload = body?.metrics ?? null;
	}

	if (!ok) {
		console.error(
			`[canary] Step '${step.name}' failed: expected ${expected}, got ${response.status}`,
		);
	}
}

const metricsErrorRate = Number(metricsPayload?.errorRate ?? NaN);
const metricsP95Ms = Number(metricsPayload?.p95Ms ?? NaN);
const computedAvailability = Number.isNaN(metricsErrorRate)
	? NaN
	: 1 - metricsErrorRate;
const allowedErrorBudget = 1 - minAvailability;
const errorBudgetBurnRate =
	Number.isNaN(metricsErrorRate) || allowedErrorBudget <= 0
		? NaN
		: metricsErrorRate / allowedErrorBudget;

const sloViolations: string[] = [];
if (!metricsPayload) {
	sloViolations.push('missing observability metrics payload');
} else {
	if (Number.isNaN(metricsErrorRate) || metricsErrorRate > maxErrorRate) {
		sloViolations.push(
			`errorRate ${Number.isNaN(metricsErrorRate) ? 'n/a' : metricsErrorRate} exceeds ${maxErrorRate}`,
		);
	}
	if (Number.isNaN(metricsP95Ms) || metricsP95Ms > maxP95Ms) {
		sloViolations.push(
			`p95 ${Number.isNaN(metricsP95Ms) ? 'n/a' : metricsP95Ms}ms exceeds ${maxP95Ms}ms`,
		);
	}
	if (
		Number.isNaN(computedAvailability) ||
		computedAvailability < minAvailability
	) {
		sloViolations.push(
			`availability ${Number.isNaN(computedAvailability) ? 'n/a' : computedAvailability} below ${minAvailability}`,
		);
	}
	if (
		Number.isNaN(errorBudgetBurnRate) ||
		errorBudgetBurnRate > maxErrorBudgetBurnRate
	) {
		sloViolations.push(
			`error budget burn rate ${Number.isNaN(errorBudgetBurnRate) ? 'n/a' : errorBudgetBurnRate} exceeds ${maxErrorBudgetBurnRate}`,
		);
	}
	if (metricsPayload.sloBreached) {
		sloViolations.push('observability metrics reported sloBreached=true');
	}
}

const syntheticStepPass = results.every((result) => result.ok);
const sloPass = sloViolations.length === 0;
const pass = syntheticStepPass && sloPass;

const report = {
	generatedAt: new Date().toISOString(),
	baseUrl: normalizedBaseUrl,
	phase: canaryPhase,
	durationMs: Date.now() - startedAt,
	pass,
	results,
	slo: {
		pass: sloPass,
		violations: sloViolations,
		thresholds: {
			maxErrorRate,
			maxP95Ms,
			minAvailability,
			maxErrorBudgetBurnRate,
		},
		metrics: {
			totalRequests: metricsPayload?.totalRequests ?? null,
			errorRate: Number.isNaN(metricsErrorRate) ? null : metricsErrorRate,
			p95Ms: Number.isNaN(metricsP95Ms) ? null : metricsP95Ms,
			availability: Number.isNaN(computedAvailability)
				? null
				: computedAvailability,
			errorBudgetBurnRate: Number.isNaN(errorBudgetBurnRate)
				? null
				: errorBudgetBurnRate,
			sloBreached: Boolean(metricsPayload?.sloBreached),
		},
	},
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
	writeFileSync(summaryPath, `\nCanary report (phase ${canaryPhase}%)\n`, {
		flag: 'a',
	});
	for (const result of results) {
		writeFileSync(
			summaryPath,
			`- ${result.name}: status=${result.status} duration=${result.durationMs}ms ok=${result.ok}\n`,
			{ flag: 'a' },
		);
	}
	writeFileSync(
		summaryPath,
		`- SLO: errorRate=${report.slo.metrics.errorRate ?? 'n/a'} p95Ms=${report.slo.metrics.p95Ms ?? 'n/a'} availability=${report.slo.metrics.availability ?? 'n/a'} burnRate=${report.slo.metrics.errorBudgetBurnRate ?? 'n/a'} pass=${report.slo.pass}\n`,
		{ flag: 'a' },
	);
	if (sloViolations.length > 0) {
		for (const violation of sloViolations) {
			writeFileSync(summaryPath, `- SLO violation: ${violation}\n`, {
				flag: 'a',
			});
		}
	}
	writeFileSync(summaryPath, `- pass: ${report.pass}\n`, {
		flag: 'a',
	});
}

if (!report.pass) {
	if (!syntheticStepPass) {
		console.error('[canary] Synthetic checks failed.');
	}
	if (!sloPass) {
		console.error('[canary] SLO gate failed.');
		for (const violation of sloViolations) {
			console.error(`- ${violation}`);
		}
	}
	process.exit(1);
}

console.log(
	`[canary] Passed ${results.length} steps and SLO gate at phase ${canaryPhase}% against ${normalizedBaseUrl}`,
);
