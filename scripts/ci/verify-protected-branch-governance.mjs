import { readFileSync, writeFileSync } from 'node:fs';

const repository = process.env.GITHUB_REPOSITORY?.trim();
const eventPath = process.env.GITHUB_EVENT_PATH?.trim();
const ref = process.env.GITHUB_REF?.trim();
const token =
	process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || '';

const protectedRefs = new Set(['refs/heads/main', 'refs/heads/master']);
const allowDirectPushes =
	(process.env.ALLOW_DIRECT_PUSHES ?? 'false').toLowerCase() === 'true';

function appendSummary(lines) {
	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	if (!summaryPath) {
		return;
	}

	writeFileSync(summaryPath, `\n${lines.join('\n')}\n`, { flag: 'a' });
}

async function listAssociatedPulls(repo, sha, authToken) {
	const response = await fetch(
		`https://api.github.com/repos/${repo}/commits/${sha}/pulls`,
		{
			headers: {
				accept: 'application/vnd.github+json',
				authorization: authToken ? `Bearer ${authToken}` : '',
				'user-agent': 'servicenova-branch-governance-check',
			},
		},
	);

	if (!response.ok) {
		const payload = await response.text();
		throw new Error(
			`Unable to query associated PRs for commit ${sha}: HTTP ${response.status} ${payload}`,
		);
	}

	return (await response.json()).map((item) => ({
		number: item.number,
		state: item.state,
		mergedAt: item.merged_at,
		baseRef: item.base?.ref ?? '',
	}));
}

if (!repository || !eventPath || !ref) {
	console.error(
		'[branch-governance] Missing required GitHub context env (GITHUB_REPOSITORY, GITHUB_EVENT_PATH, GITHUB_REF).',
	);
	process.exit(1);
}

if (!protectedRefs.has(ref)) {
	console.log(
		`[branch-governance] Ref ${ref} is not protected by this policy.`,
	);
	process.exit(0);
}

const event = JSON.parse(readFileSync(eventPath, 'utf8'));
const commits = Array.isArray(event.commits) ? event.commits : [];
const commitShas = commits
	.map((item) => String(item.id ?? '').trim())
	.filter(Boolean);

if (allowDirectPushes) {
	console.warn(
		'[branch-governance] ALLOW_DIRECT_PUSHES=true, governance violations are ignored.',
	);
	appendSummary([
		'Protected branch governance',
		`- ref: ${ref}`,
		'- direct push policy: bypassed (ALLOW_DIRECT_PUSHES=true)',
	]);
	process.exit(0);
}

if (commitShas.length === 0) {
	console.log('[branch-governance] No commits in push event payload.');
	process.exit(0);
}

const violations = [];
for (const sha of commitShas) {
	const associatedPulls = await listAssociatedPulls(repository, sha, token);
	const matchesProtectedBranch = associatedPulls.some(
		(pull) =>
			pull.baseRef === 'main' ||
			pull.baseRef === 'master' ||
			pull.mergedAt !== null,
	);

	if (!matchesProtectedBranch) {
		violations.push({
			sha,
			associatedPulls,
		});
	}
}

if (violations.length > 0) {
	console.error(
		`[branch-governance] ${violations.length} protected-branch commit(s) were pushed without associated PR merges.`,
	);
	for (const violation of violations) {
		console.error(`- commit ${violation.sha}`);
	}

	appendSummary([
		'Protected branch governance',
		`- ref: ${ref}`,
		`- violations: ${violations.length}`,
		...violations.map((violation) => `- commit: ${violation.sha}`),
	]);
	process.exit(1);
}

console.log(
	`[branch-governance] Passed. ${commitShas.length} commit(s) on ${ref} are linked to PR history.`,
);
appendSummary([
	'Protected branch governance',
	`- ref: ${ref}`,
	`- checked commits: ${commitShas.length}`,
	'- result: pass',
]);
