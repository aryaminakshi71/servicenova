import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(scriptDir, '../..');
const policyPath = resolve(rootDir, '.github/ci/branch-protection-policy.json');
const dryRun = process.argv.includes('--dry-run');

function runGh(args, input) {
	const result = spawnSync('gh', args, {
		encoding: 'utf8',
		input,
	});

	if (result.status !== 0) {
		const error =
			result.stderr?.trim() || result.stdout?.trim() || 'gh command failed';
		throw new Error(error);
	}

	return result.stdout;
}

function resolveRepo() {
	if (process.env.GITHUB_REPOSITORY?.trim()) {
		return process.env.GITHUB_REPOSITORY.trim();
	}

	const repo = runGh([
		'repo',
		'view',
		'--json',
		'nameWithOwner',
		'-q',
		'.nameWithOwner',
	]).trim();
	if (!repo) {
		throw new Error('Unable to resolve repository nameWithOwner');
	}
	return repo;
}

function getBranchMetadata(repo, branch) {
	try {
		const payload = JSON.parse(
			runGh(['api', `repos/${repo}/branches/${branch}`]),
		);
		const canonicalName =
			typeof payload?.name === 'string' ? payload.name.trim() : '';
		if (!canonicalName) {
			return {
				exists: false,
				reason: 'missing canonical branch name',
			};
		}

		if (canonicalName !== branch) {
			return {
				exists: false,
				reason: `resolves to '${canonicalName}'`,
			};
		}

		return {
			exists: true,
			reason: null,
		};
	} catch {
		return {
			exists: false,
			reason: 'branch not found',
		};
	}
}

function buildPayload(entry) {
	return {
		required_status_checks: {
			strict: Boolean(entry.strictStatusChecks),
			contexts: Array.isArray(entry.requiredChecks) ? entry.requiredChecks : [],
		},
		enforce_admins: Boolean(entry.enforceAdmins),
		required_pull_request_reviews: {
			dismiss_stale_reviews: Boolean(entry.dismissStaleReviews),
			require_code_owner_reviews: Boolean(entry.requireCodeOwnerReviews),
			required_approving_review_count: Number(entry.requiredApprovals ?? 1),
		},
		restrictions: null,
		required_conversation_resolution: true,
		allow_force_pushes: false,
		allow_deletions: false,
		block_creations: false,
		lock_branch: false,
		allow_fork_syncing: true,
	};
}

const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
if (!Array.isArray(policy.branches) || policy.branches.length === 0) {
	throw new Error(`No branches defined in ${policyPath}`);
}

const repo = resolveRepo();
const applied = [];
const skipped = [];

for (const branch of policy.branches) {
	const name = branch?.name?.trim();
	if (!name) {
		continue;
	}

	const branchMeta = getBranchMetadata(repo, name);
	if (!branchMeta.exists) {
		skipped.push({ name, reason: branchMeta.reason ?? 'branch not found' });
		continue;
	}

	const payload = buildPayload(branch);

	if (dryRun) {
		applied.push({ name, dryRun: true, payload });
		continue;
	}

	runGh(
		[
			'api',
			'--method',
			'PUT',
			`repos/${repo}/branches/${name}/protection`,
			'--input',
			'-',
		],
		`${JSON.stringify(payload)}\n`,
	);
	applied.push({ name, dryRun: false });
}

for (const item of applied) {
	console.log(
		`[branch-protection] ${item.dryRun ? 'validated' : 'applied'}: ${repo}@${item.name}`,
	);
}
for (const item of skipped) {
	console.warn(
		`[branch-protection] skipped: ${repo}@${item.name} (${item.reason})`,
	);
}

console.log(
	`[branch-protection] completed: applied=${applied.length} skipped=${skipped.length}${dryRun ? ' (dry-run)' : ''}`,
);
