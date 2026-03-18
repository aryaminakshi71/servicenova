import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(scriptDir, '../..');
const policyPath = resolve(rootDir, '.github/ci/branch-protection-policy.json');
const workflowPath = resolve(rootDir, '.github/workflows/ci.yml');

function parseWorkflowChecksFromCi(workflowText) {
	const lines = workflowText.split(/\r?\n/);
	const workflowNameLine = lines.find((line) => line.startsWith('name:'));
	const workflowName = workflowNameLine
		? workflowNameLine.replace('name:', '').trim()
		: 'CI';

	const checks = new Set();
	let inJobs = false;

	for (const rawLine of lines) {
		const line = rawLine.replace(/\t/g, '  ');

		if (!inJobs && line.trim() === 'jobs:') {
			inJobs = true;
			continue;
		}

		if (!inJobs) {
			continue;
		}

		const match = line.match(/^ {2}([a-zA-Z0-9_-]+):\s*$/);
		if (!match) {
			continue;
		}

		const jobId = match[1];
		checks.add(`${workflowName} / ${jobId}`);
	}

	return checks;
}

function validatePolicy(policy, availableChecks) {
	const violations = [];

	if (!Array.isArray(policy.branches) || policy.branches.length === 0) {
		violations.push('policy must include at least one branch');
		return violations;
	}

	for (const branch of policy.branches) {
		if (!branch || typeof branch !== 'object') {
			violations.push('branch entry must be an object');
			continue;
		}

		if (typeof branch.name !== 'string' || branch.name.trim().length === 0) {
			violations.push('branch name is required');
		}

		if (
			!Array.isArray(branch.requiredChecks) ||
			branch.requiredChecks.length === 0
		) {
			violations.push(
				`branch '${branch.name ?? 'unknown'}' missing requiredChecks`,
			);
			continue;
		}

		const duplicates = new Set();
		for (const check of branch.requiredChecks) {
			if (duplicates.has(check)) {
				violations.push(
					`branch '${branch.name}': duplicate required check '${check}'`,
				);
			}
			duplicates.add(check);

			if (!availableChecks.has(check)) {
				violations.push(
					`branch '${branch.name}': required check '${check}' not found in ${workflowPath}`,
				);
			}
		}
	}

	return violations;
}

const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
const workflow = readFileSync(workflowPath, 'utf8');
const availableChecks = parseWorkflowChecksFromCi(workflow);
const violations = validatePolicy(policy, availableChecks);

if (violations.length > 0) {
	console.error('[branch-protection] Policy violations detected:');
	for (const violation of violations) {
		console.error(`- ${violation}`);
	}
	process.exit(1);
}

console.log(
	`[branch-protection] Policy is valid. ${availableChecks.size} CI checks available.`,
);

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
	const lines = [
		'',
		'Branch protection policy checks',
		`- policy file: ${policyPath}`,
		`- CI checks discovered: ${availableChecks.size}`,
	];
	for (const check of Array.from(availableChecks).sort()) {
		lines.push(`- check: ${check}`);
	}
	lines.push('');
	writeFileSync(summaryPath, `${lines.join('\n')}\n`, { flag: 'a' });
}
