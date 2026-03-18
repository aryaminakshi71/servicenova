import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function parseArgs(argv) {
	let baselinePath = '.github/ci/biome-ratchet-baseline.json';
	const writeBaseline = argv.includes('--write-baseline');

	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === '--baseline') {
			baselinePath = argv[index + 1] ?? baselinePath;
			index += 1;
		}
	}

	return {
		baselinePath: resolve(baselinePath),
		writeBaseline,
	};
}

function extractBiomeJson(stdout) {
	const line = stdout
		.split('\n')
		.find((entry) => entry.trimStart().startsWith('{"summary"'));

	if (!line) {
		throw new Error('Unable to locate Biome JSON payload in command output.');
	}

	return JSON.parse(line);
}

function buildCounts(payload) {
	const counts = {};
	for (const diagnostic of payload.diagnostics ?? []) {
		const severity = String(diagnostic.severity ?? 'unknown');
		if (severity !== 'error' && severity !== 'warning') {
			continue;
		}

		const category = String(diagnostic.category ?? 'unknown');
		const path = String(diagnostic.location?.path ?? 'unknown');
		const key = `${severity}|${category}|${path}`;
		counts[key] = Number(counts[key] ?? 0) + 1;
	}

	return counts;
}

function runBiomeJson() {
	const targets = [
		'.github',
		'apps',
		'contracts',
		'drizzle',
		'e2e',
		'packages',
		'scripts',
		'src',
		'playwright.config.ts',
		'vite.config.ts',
		'vitest.config.ts',
		'tsconfig.json',
		'package.json',
	];

	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(
			'bunx',
			['biome', 'check', '--reporter=json', ...targets],
			{
				shell: false,
				env: process.env,
			},
		);

		let stdout = '';
		let stderr = '';

		child.stdout.on('data', (chunk) => {
			stdout += String(chunk);
		});

		child.stderr.on('data', (chunk) => {
			stderr += String(chunk);
		});

		child.on('error', (error) => rejectPromise(error));
		child.on('close', () => resolvePromise({ stdout, stderr }));
	});
}

const { baselinePath, writeBaseline } = parseArgs(process.argv.slice(2));
const { stdout, stderr } = await runBiomeJson();

if (stderr.trim()) {
	console.error(stderr.trim());
}

let payload;
try {
	payload = extractBiomeJson(stdout);
} catch (error) {
	console.error(`[biome-ratchet] ${error.message}`);
	console.error(stdout);
	process.exit(1);
}

const counts = buildCounts(payload);

if (writeBaseline) {
	mkdirSync(dirname(baselinePath), { recursive: true });
	writeFileSync(
		baselinePath,
		`${JSON.stringify(
			{
				generatedAt: new Date().toISOString(),
				errorCount: Number(payload?.summary?.errors ?? 0),
				warningCount: Number(payload?.summary?.warnings ?? 0),
				counts,
			},
			null,
			2,
		)}\n`,
		'utf8',
	);
	console.log(
		`[biome-ratchet] Wrote baseline (${Object.keys(counts).length} fingerprints).`,
	);
	process.exit(0);
}

if (!existsSync(baselinePath)) {
	console.error(`[biome-ratchet] Baseline not found at ${baselinePath}`);
	console.error(
		'Run `bun run lint:ratchet:update` and commit the baseline file.',
	);
	process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const baselineCounts = baseline.counts ?? {};
const regressions = [];

for (const [fingerprint, currentCount] of Object.entries(counts)) {
	const previousCount = Number(baselineCounts[fingerprint] ?? 0);
	if (Number(currentCount) > previousCount) {
		regressions.push({
			fingerprint,
			previousCount,
			currentCount,
		});
	}
}

if (regressions.length > 0) {
	console.error(
		`[biome-ratchet] New Biome violations detected (${regressions.length} fingerprint regression(s)).`,
	);
	for (const regression of regressions.slice(0, 20)) {
		console.error(
			`- ${regression.fingerprint}: ${regression.previousCount} -> ${regression.currentCount}`,
		);
	}
	if (regressions.length > 20) {
		console.error(`- ...and ${regressions.length - 20} more`);
	}
	process.exit(1);
}

console.log(
	`[biome-ratchet] No new Biome violations (tracked fingerprints: ${Object.keys(counts).length}).`,
);
