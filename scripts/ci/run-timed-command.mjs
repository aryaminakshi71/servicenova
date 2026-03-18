import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function parseArgs(argv) {
	const separatorIndex = argv.indexOf('--');
	if (separatorIndex === -1) {
		throw new Error(
			'Missing command separator `--`. Example: --label unit -- bun run test:unit',
		);
	}

	const optionArgs = argv.slice(0, separatorIndex);
	const commandArgs = argv.slice(separatorIndex + 1);
	let label = '';
	let outputPath = '';

	for (let index = 0; index < optionArgs.length; index += 1) {
		const arg = optionArgs[index];
		if (arg === '--label') {
			label = optionArgs[index + 1] ?? '';
			index += 1;
			continue;
		}

		if (arg === '--output') {
			outputPath = optionArgs[index + 1] ?? '';
			index += 1;
		}
	}

	if (!label.trim()) {
		throw new Error('Missing required option `--label`.');
	}

	if (commandArgs.length === 0) {
		throw new Error('No command provided after `--`.');
	}

	return {
		label: label.trim(),
		outputPath: outputPath.trim(),
		commandArgs,
	};
}

const startedAt = new Date();
let parsed;

try {
	parsed = parseArgs(process.argv.slice(2));
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[ci-timing] ${message}`);
	process.exit(1);
}

const [command, ...commandArgs] = parsed.commandArgs;
const child = spawn(command, commandArgs, {
	stdio: 'inherit',
	shell: false,
	env: process.env,
});

child.on('close', (code, signal) => {
	const finishedAt = new Date();
	const durationMs = finishedAt.getTime() - startedAt.getTime();
	const durationSeconds = Number((durationMs / 1000).toFixed(2));
	const normalizedCode = typeof code === 'number' ? code : 1;

	const output = {
		label: parsed.label,
		command: parsed.commandArgs.join(' '),
		exitCode: normalizedCode,
		signal: signal ?? null,
		startedAt: startedAt.toISOString(),
		finishedAt: finishedAt.toISOString(),
		durationMs,
		durationSeconds,
	};

	if (parsed.outputPath) {
		const absoluteOutputPath = resolve(parsed.outputPath);
		mkdirSync(dirname(absoluteOutputPath), { recursive: true });
		writeFileSync(
			absoluteOutputPath,
			`${JSON.stringify(output, null, 2)}\n`,
			'utf8',
		);
	}

	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	if (summaryPath) {
		appendFileSync(
			summaryPath,
			`- ${parsed.label}: ${durationSeconds}s (exit ${normalizedCode})\n`,
			'utf8',
		);
	}

	console.log(
		`[ci-timing] ${parsed.label} completed in ${durationSeconds}s (exit ${normalizedCode}).`,
	);

	process.exit(normalizedCode);
});

child.on('error', (error) => {
	console.error(`[ci-timing] Failed to start command: ${error.message}`);
	process.exit(1);
});
