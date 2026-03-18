import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(scriptDir, '../..');
const packageJsonPath = resolve(rootDir, 'package.json');
const policyPath = resolve(rootDir, '.github/ci/dependency-policy.json');

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));

const blockedPackages = new Set(
	Array.isArray(policy.blockedPackages) ? policy.blockedPackages : [],
);
const blockedVersionPatterns = Array.isArray(policy.blockedVersionPatterns)
	? policy.blockedVersionPatterns.map((value) => String(value).toLowerCase())
	: [];

const groups = [
	['dependencies', packageJson.dependencies ?? {}],
	['devDependencies', packageJson.devDependencies ?? {}],
];

const violations = [];

for (const [groupName, group] of groups) {
	for (const [name, rawVersion] of Object.entries(group)) {
		const version = String(rawVersion).trim();
		const normalizedVersion = version.toLowerCase();

		if (blockedPackages.has(name)) {
			violations.push(
				`${groupName}.${name}: package is blocked by dependency policy`,
			);
		}

		for (const pattern of blockedVersionPatterns) {
			if (pattern === '*' && normalizedVersion === '*') {
				violations.push(
					`${groupName}.${name}: version "${version}" is not allowed`,
				);
				continue;
			}

			if (pattern !== '*' && normalizedVersion.includes(pattern)) {
				violations.push(
					`${groupName}.${name}: version "${version}" matches blocked pattern "${pattern}"`,
				);
			}
		}
	}
}

if (violations.length > 0) {
	console.error('[dependency-policy] Violations detected:');
	for (const violation of violations) {
		console.error(`- ${violation}`);
	}
	process.exit(1);
}

console.log(
	`[dependency-policy] Passed (${groups.reduce((count, [, group]) => count + Object.keys(group).length, 0)} dependencies checked)`,
);
