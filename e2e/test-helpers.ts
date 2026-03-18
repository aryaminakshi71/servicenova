import { expect, type Page, type TestInfo } from '@playwright/test';

export const socialAuthAvailability = {
	google: Boolean(
		process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
	),
	github: Boolean(
		process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET,
	),
};

const e2eTenantStorageKey = 'servicenova:e2e:tenantId';
const e2eUserStorageKey = 'servicenova:e2e:userId';

function stableSuffix(input: string) {
	let hash = 0;

	for (const character of input) {
		hash = (hash * 31 + character.charCodeAt(0)) % 1_000_000;
	}

	return hash.toString(36);
}

export function buildE2EIdentity(testInfo: TestInfo) {
	const suffix = stableSuffix(
		`${testInfo.project.name}-${testInfo.file}-${testInfo.title}`,
	);
	const runScope = `w${testInfo.workerIndex}-p${testInfo.parallelIndex}-r${testInfo.retry}-e${testInfo.repeatEachIndex}`;
	return {
		tenantId: `e2e-tenant-${runScope}-${suffix}`,
		userId: `e2e-user-${runScope}-${suffix}`,
	};
}

export async function clearBrowserSession(page: Page) {
	await page.context().clearCookies();
	await page.goto('/');
	await page.evaluate(() => {
		window.localStorage.clear();
		window.sessionStorage.clear();
	});
}

export async function goToLoggedOutHomepage(
	page: Page,
	identity: { tenantId: string; userId: string },
) {
	await clearBrowserSession(page);
	await page.evaluate(
		(input) => {
			window.localStorage.setItem(input.tenantStorageKey, input.tenantId);
			window.localStorage.setItem(input.userStorageKey, input.userId);
		},
		{
			tenantId: identity.tenantId,
			userId: identity.userId,
			tenantStorageKey: e2eTenantStorageKey,
			userStorageKey: e2eUserStorageKey,
		},
	);
	await page.goto('/');
}

export async function expectDashboard(page: Page) {
	await expect(page).toHaveURL(/\/app/);
	await expect(page.getByText('ServiceNova AI Workspace')).toBeVisible();
	await expect(
		page.getByText('AI dispatch and field execution platform.'),
	).toBeVisible();
}
