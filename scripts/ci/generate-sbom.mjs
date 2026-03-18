import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '../..');
const packageJsonPath = resolve(rootDir, 'package.json');
const bunLockPath = resolve(rootDir, 'bun.lock');
const outputPath = resolve(
	rootDir,
	process.env.SBOM_OUTPUT_PATH ?? 'test-results/sbom.cdx.json',
);

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const packageName = String(packageJson.name ?? 'servicenova-ai');
const packageVersion = String(packageJson.version ?? '0.0.0');
const dependencies = packageJson.dependencies ?? {};
const devDependencies = packageJson.devDependencies ?? {};

function hashFile(path) {
	const content = readFileSync(path);
	return createHash('sha256').update(content).digest('hex');
}

const components = [
	...Object.entries(dependencies).map(([name, version]) => ({
		type: 'library',
		name,
		version: String(version),
		scope: 'required',
	})),
	...Object.entries(devDependencies).map(([name, version]) => ({
		type: 'library',
		name,
		version: String(version),
		scope: 'optional',
	})),
].sort((left, right) => left.name.localeCompare(right.name));

const sbom = {
	bomFormat: 'CycloneDX',
	specVersion: '1.5',
	serialNumber: `urn:uuid:${crypto.randomUUID()}`,
	version: 1,
	metadata: {
		timestamp: new Date().toISOString(),
		component: {
			type: 'application',
			name: packageName,
			version: packageVersion,
		},
		tools: [
			{
				vendor: 'ServiceNova',
				name: 'scripts/ci/generate-sbom.mjs',
				version: '1.0.0',
			},
		],
		properties: [
			{
				name: 'servicenova:bunLockSha256',
				value: hashFile(bunLockPath),
			},
		],
	},
	components,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(sbom, null, 2)}\n`, 'utf8');
console.log(`[sbom] Wrote CycloneDX SBOM to ${outputPath}`);
