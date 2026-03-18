import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '../..');
const outputPath = resolve(
	rootDir,
	process.env.PROVENANCE_OUTPUT_PATH ?? 'test-results/provenance.json',
);

function hashFile(path) {
	const content = readFileSync(path);
	return createHash('sha256').update(content).digest('hex');
}

function hashDirectory(dirPath) {
	if (!existsSync(dirPath)) {
		return null;
	}

	const files = [];
	const stack = [dirPath];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			continue;
		}

		for (const entry of readdirSync(current)) {
			const absolute = resolve(current, entry);
			const stats = statSync(absolute);
			if (stats.isDirectory()) {
				stack.push(absolute);
				continue;
			}
			files.push(absolute);
		}
	}

	files.sort();
	const digest = createHash('sha256');
	for (const file of files) {
		digest.update(file.replace(`${rootDir}/`, ''));
		digest.update(hashFile(file));
	}

	return {
		fileCount: files.length,
		digest: digest.digest('hex'),
	};
}

const packageJsonPath = resolve(rootDir, 'package.json');
const bunLockPath = resolve(rootDir, 'bun.lock');
const sbomPath = resolve(
	rootDir,
	process.env.SBOM_OUTPUT_PATH ?? 'test-results/sbom.cdx.json',
);
const distPath = resolve(rootDir, 'dist');

const provenance = {
	generatedAt: new Date().toISOString(),
	repository: {
		name: process.env.GITHUB_REPOSITORY ?? null,
		sha: process.env.GITHUB_SHA ?? null,
		ref: process.env.GITHUB_REF ?? null,
		runId: process.env.GITHUB_RUN_ID ?? null,
		workflow: process.env.GITHUB_WORKFLOW ?? null,
	},
	buildInputs: {
		packageJsonSha256: hashFile(packageJsonPath),
		bunLockSha256: hashFile(bunLockPath),
		sbomSha256: existsSync(sbomPath) ? hashFile(sbomPath) : null,
	},
	buildOutputs: {
		dist: hashDirectory(distPath),
	},
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
console.log(`[provenance] Wrote provenance to ${outputPath}`);
