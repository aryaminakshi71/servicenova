import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseArgs(argv) {
	let baselinePath = '.github/ci/timing-baselines.json';
	let timingsDir = 'test-results/ci-timing';
	let labels = '';

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--baseline') {
			baselinePath = argv[index + 1] ?? baselinePath;
			index += 1;
			continue;
		}

		if (arg === '--timings-dir') {
			timingsDir = argv[index + 1] ?? timingsDir;
			index += 1;
			continue;
		}

		if (arg === '--labels') {
			labels = argv[index + 1] ?? labels;
			index += 1;
		}
	}

	return {
		baselinePath: resolve(baselinePath),
		timingsDir: resolve(timingsDir),
		labels,
	};
}

const { baselinePath, timingsDir, labels } = parseArgs(process.argv.slice(2));

if (!existsSync(baselinePath)) {
	console.error(`[timing-budget] Missing baseline file: ${baselinePath}`);
	process.exit(1);
}

if (!existsSync(timingsDir)) {
	console.error(`[timing-budget] Missing timing directory: ${timingsDir}`);
	process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const allowedRegressionPercent = Number(
	baseline.allowedRegressionPercent ?? 20,
);
const baselineLabels = baseline.labels ?? {};

const measuredByLabel = new Map();
for (const fileName of readdirSync(timingsDir)) {
	if (!fileName.endsWith('.json')) {
		continue;
	}

	const parsed = JSON.parse(
		readFileSync(resolve(timingsDir, fileName), 'utf8'),
	);
	if (!parsed?.label || typeof parsed?.durationSeconds !== 'number') {
		continue;
	}

	measuredByLabel.set(String(parsed.label), Number(parsed.durationSeconds));
}

const selectedLabels = labels
	? labels
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean)
	: Object.keys(baselineLabels);

const violations = [];

for (const label of selectedLabels) {
	const baselineSeconds = Number(baselineLabels[label]);
	if (!Number.isFinite(baselineSeconds) || baselineSeconds <= 0) {
		violations.push(`missing baseline threshold for label '${label}'`);
		continue;
	}

	const measured = measuredByLabel.get(label);
	if (typeof measured !== 'number') {
		violations.push(`missing timing output for label '${label}'`);
		continue;
	}

	const maxAllowed = baselineSeconds * (1 + allowedRegressionPercent / 100);
	if (measured > maxAllowed) {
		violations.push(
			`${label} exceeded budget: ${measured}s > ${maxAllowed.toFixed(2)}s (baseline ${baselineSeconds}s, +${allowedRegressionPercent}%)`,
		);
	}
}

if (violations.length > 0) {
	console.error('[timing-budget] CI timing budget regressions detected.');
	for (const violation of violations) {
		console.error(`- ${violation}`);
	}
	process.exit(1);
}

console.log(
	`[timing-budget] Timing budgets satisfied for ${selectedLabels.length} label(s) with +${allowedRegressionPercent}% allowance.`,
);
