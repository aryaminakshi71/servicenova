import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { type ZodTypeAny, z } from 'zod';
import {
	automationCycleResponseSchema,
	optimizeResponseSchema,
} from '../../src/server/routes/dispatch.contract.schemas';
import {
	dashboardOnboardingResponseSchema,
	driftAlertAcknowledgeResponseSchema,
	driftAlertsResponseSchema,
	healthResponseSchema,
	incidentTimelineResponseSchema,
	integrationOutboxFlushResponseSchema,
	integrationOutboxListResponseSchema,
	observabilityMetricsResponseSchema,
} from '../../src/server/routes/platform.contract.schemas';

type SnapshotEntry = {
	name: string;
	schema: ZodTypeAny;
	relativePath: string;
};

type ContractVersionPolicy = {
	allowV1Breaking: boolean;
	reason?: string;
	expiresOn?: string;
};

const rootDir = resolve(import.meta.dir, '../..');
const shouldWrite = process.argv.includes('--write');
const shouldWriteV1 = process.argv.includes('--write-v1');
const policyPath = resolve(rootDir, '.github/ci/contract-version-policy.json');

const snapshots: SnapshotEntry[] = [
	{
		name: 'optimize-response',
		schema: optimizeResponseSchema,
		relativePath: 'dispatch/optimize-response.schema.json',
	},
	{
		name: 'automation-cycle-response',
		schema: automationCycleResponseSchema,
		relativePath: 'dispatch/automation-cycle-response.schema.json',
	},
	{
		name: 'health-response',
		schema: healthResponseSchema,
		relativePath: 'platform/health-response.schema.json',
	},
	{
		name: 'observability-metrics-response',
		schema: observabilityMetricsResponseSchema,
		relativePath: 'platform/observability-metrics-response.schema.json',
	},
	{
		name: 'dashboard-onboarding-response',
		schema: dashboardOnboardingResponseSchema,
		relativePath: 'platform/dashboard-onboarding-response.schema.json',
	},
	{
		name: 'drift-alerts-response',
		schema: driftAlertsResponseSchema,
		relativePath: 'platform/drift-alerts-response.schema.json',
	},
	{
		name: 'drift-alert-acknowledge-response',
		schema: driftAlertAcknowledgeResponseSchema,
		relativePath: 'platform/drift-alert-acknowledge-response.schema.json',
	},
	{
		name: 'ops-incidents-response',
		schema: incidentTimelineResponseSchema,
		relativePath: 'platform/ops-incidents-response.schema.json',
	},
	{
		name: 'integration-outbox-list-response',
		schema: integrationOutboxListResponseSchema,
		relativePath: 'platform/integration-outbox-list-response.schema.json',
	},
	{
		name: 'integration-outbox-flush-response',
		schema: integrationOutboxFlushResponseSchema,
		relativePath: 'platform/integration-outbox-flush-response.schema.json',
	},
];

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => sortJson(item));
	}

	if (value && typeof value === 'object') {
		return Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.reduce<Record<string, unknown>>((accumulator, [key, nestedValue]) => {
				accumulator[key] = sortJson(nestedValue);
				return accumulator;
			}, {});
	}

	return value;
}

function renderSchemaSnapshotObject(schema: ZodTypeAny) {
	const rendered = z.toJSONSchema(schema);
	return sortJson(rendered);
}

function renderSchemaSnapshot(schema: ZodTypeAny) {
	return `${JSON.stringify(renderSchemaSnapshotObject(schema), null, 2)}\n`;
}

function snapshotMatches(
	snapshotText: string,
	expectedSnapshotObject: unknown,
) {
	try {
		const parsed = sortJson(JSON.parse(snapshotText));
		return JSON.stringify(parsed) === JSON.stringify(expectedSnapshotObject);
	} catch {
		return false;
	}
}

function readPolicy(): ContractVersionPolicy {
	if (!existsSync(policyPath)) {
		return {
			allowV1Breaking: false,
		};
	}

	const payload = JSON.parse(readFileSync(policyPath, 'utf8'));
	return {
		allowV1Breaking: Boolean(payload?.allowV1Breaking),
		reason:
			typeof payload?.reason === 'string' ? payload.reason.trim() : undefined,
		expiresOn:
			typeof payload?.expiresOn === 'string'
				? payload.expiresOn.trim()
				: undefined,
	};
}

function versionPath(version: 'v1' | 'v2', relativePath: string) {
	return resolve(rootDir, `contracts/snapshots/${version}/${relativePath}`);
}

const policy = readPolicy();
if (policy.allowV1Breaking && policy.expiresOn) {
	const expirationMs = Date.parse(policy.expiresOn);
	if (!Number.isNaN(expirationMs) && Date.now() > expirationMs) {
		console.error(
			`[contract] v1 breaking allowance expired on ${policy.expiresOn}. Update or disable allowV1Breaking.`,
		);
		process.exit(1);
	}
}

if (shouldWrite) {
	const updated: string[] = [];

	for (const snapshot of snapshots) {
		const generated = renderSchemaSnapshot(snapshot.schema);
		const v2Path = versionPath('v2', snapshot.relativePath);
		mkdirSync(dirname(v2Path), { recursive: true });
		writeFileSync(v2Path, generated, 'utf8');
		updated.push(`v2:${snapshot.name}`);

		if (shouldWriteV1) {
			const v1Path = versionPath('v1', snapshot.relativePath);
			mkdirSync(dirname(v1Path), { recursive: true });
			writeFileSync(v1Path, generated, 'utf8');
			updated.push(`v1:${snapshot.name}`);
		}
	}

	console.log(
		`[contract] Updated API contract snapshots: ${updated.join(', ')}`,
	);
	process.exit(0);
}

const driftedSnapshots: string[] = [];

for (const snapshot of snapshots) {
	const generatedObject = renderSchemaSnapshotObject(snapshot.schema);
	const v2Path = versionPath('v2', snapshot.relativePath);

	if (!existsSync(v2Path)) {
		driftedSnapshots.push(`v2/${snapshot.relativePath}: missing snapshot file`);
	} else {
		const currentV2 = readFileSync(v2Path, 'utf8');
		if (!snapshotMatches(currentV2, generatedObject)) {
			driftedSnapshots.push(
				`v2/${snapshot.relativePath}: schema snapshot drift detected`,
			);
		}
	}

	const v1Path = versionPath('v1', snapshot.relativePath);
	if (!existsSync(v1Path)) {
		driftedSnapshots.push(`v1/${snapshot.relativePath}: missing snapshot file`);
		continue;
	}

	const currentV1 = readFileSync(v1Path, 'utf8');
	if (!snapshotMatches(currentV1, generatedObject) && !policy.allowV1Breaking) {
		driftedSnapshots.push(
			`v1/${snapshot.relativePath}: backward-compat break detected (set allowV1Breaking with reason in .github/ci/contract-version-policy.json to proceed intentionally)`,
		);
	}
}

if (driftedSnapshots.length > 0) {
	console.error('[contract] Versioned API contract snapshot drift detected.');
	for (const drift of driftedSnapshots) {
		console.error(`- ${drift}`);
	}
	console.error(
		'Run `bun run contract:snapshots:update` for v2 updates, or `bun run contract:snapshots:update:v1` for explicit v1 refresh.',
	);
	process.exit(1);
}

if (policy.allowV1Breaking) {
	const reason = policy.reason || 'not provided';
	console.log(`[contract] v1 breaking allowance active. reason=${reason}`);
}
console.log(
	`[contract] Versioned API contract snapshots are up to date (${snapshots.length} schemas).`,
);
