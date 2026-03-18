import { expect, test } from '@playwright/test';
import {
	buildE2EIdentity,
	clearBrowserSession,
	expectDashboard,
	goToLoggedOutHomepage,
} from './test-helpers';

test.afterEach(async ({ page }) => {
	await clearBrowserSession(page);
});

test('dashboard action endpoints show success messages', async ({
	page,
}, testInfo) => {
	await goToLoggedOutHomepage(page, buildE2EIdentity(testInfo));
	await page.getByRole('button', { name: 'Sign In' }).click();
	await expectDashboard(page);
	await expect(
		page.getByText('Dispatch API unavailable. Showing strategy modules only.'),
	).toHaveCount(0);

	await page.getByRole('button', { name: 'Optimize Dispatch' }).click();
	await expect(page.getByText(/Optimization complete\./)).toBeVisible();

	await page.getByRole('button', { name: 'Run Automation Cycle' }).click();
	await expect(
		page.getByText(/Automation cycle completed\. Signals:/),
	).toBeVisible();
});

test('checklist toggles and incident timeline update in realtime', async ({
	page,
}, testInfo) => {
	await goToLoggedOutHomepage(page, buildE2EIdentity(testInfo));
	await page.getByRole('button', { name: 'Sign In' }).click();
	await expectDashboard(page);

	await expect(
		page.getByRole('heading', { name: 'Quick Start' }),
	).toBeVisible();
	await page.getByRole('button', { name: 'Hide checklist' }).click();
	await expect(
		page.getByRole('button', { name: 'Show checklist' }),
	).toBeVisible();
	await page.getByRole('button', { name: 'Show checklist' }).click();
	await expect(
		page.getByRole('heading', { name: 'Quick Start' }),
	).toBeVisible();

	await expect(
		page.getByRole('heading', { name: 'Realtime Incident Timeline' }),
	).toBeVisible();
	await page.getByRole('button', { name: 'Optimize Dispatch' }).click();
	await expect(page.getByText(/Optimization complete\./)).toBeVisible();
	await expect(
		page.getByText(/Dispatch optimization completed with/i),
	).toBeVisible();
});
