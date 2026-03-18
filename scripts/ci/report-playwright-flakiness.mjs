import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

function parseArgs(argv) {
	let inputPath = 'test-results/playwright-report.json';
	let outputPath = 'test-results/playwright-flaky-summary.json';

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--input') {
			inputPath = argv[index + 1] ?? inputPath;
			index += 1;
			continue;
		}
		if (arg === '--output') {
			outputPath = argv[index + 1] ?? outputPath;
			index += 1;
		}
	}

	return {
		inputPath: resolve(inputPath),
		outputPath: resolve(outputPath),
	};
}

const failOnFlaky = process.env.FAIL_ON_FLAKY === 'true';
const { inputPath, outputPath } = parseArgs(process.argv.slice(2));

if (!existsSync(inputPath)) {
	console.error(`[flake-report] Missing Playwright JSON report: ${inputPath}`);
	process.exit(1);
}

const payload = JSON.parse(readFileSync(inputPath, 'utf8'));
const stats = payload?.stats ?? {};
const summary = {
	reportPath: inputPath,
	expected: Number(stats.expected ?? 0),
	flaky: Number(stats.flaky ?? 0),
	unexpected: Number(stats.unexpected ?? 0),
	skipped: Number(stats.skipped ?? 0),
	durationMs: Number(stats.duration ?? 0),
	durationSeconds: Number((Number(stats.duration ?? 0) / 1000).toFixed(2)),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
	appendFileSync(summaryPath, '\nPlaywright reliability\n', 'utf8');
	appendFileSync(summaryPath, `- expected: ${summary.expected}\n`, 'utf8');
	appendFileSync(summaryPath, `- flaky: ${summary.flaky}\n`, 'utf8');
	appendFileSync(summaryPath, `- unexpected: ${summary.unexpected}\n`, 'utf8');
	appendFileSync(summaryPath, `- skipped: ${summary.skipped}\n`, 'utf8');
	appendFileSync(
		summaryPath,
		`- duration: ${summary.durationSeconds}s\n`,
		'utf8',
	);
}

console.log(
	`[flake-report] expected=${summary.expected} flaky=${summary.flaky} unexpected=${summary.unexpected} skipped=${summary.skipped} duration=${summary.durationSeconds}s`,
);

if (summary.flaky > 0 && failOnFlaky) {
	console.error(
		`[flake-report] Flaky tests detected (${summary.flaky}) and FAIL_ON_FLAKY=true.`,
	);
	process.exit(1);
}
