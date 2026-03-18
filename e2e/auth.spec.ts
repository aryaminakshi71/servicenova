import { expect, test } from '@playwright/test';
import {
	buildE2EIdentity,
	clearBrowserSession,
	expectDashboard,
	goToLoggedOutHomepage,
	socialAuthAvailability,
} from './test-helpers';

test.afterEach(async ({ page }) => {
	await clearBrowserSession(page);
});

test('homepage loads', async ({ page }, testInfo) => {
	await goToLoggedOutHomepage(page, buildE2EIdentity(testInfo));
	await expect(page).toHaveTitle(/ServiceNova AI/i);
	await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Start Free Trial' }),
	).toBeVisible();
});

test('email auth flows work', async ({ page }, testInfo) => {
	const identity = buildE2EIdentity(testInfo);
	const authEmail = `${identity.userId}@servicenova.local`;
	await goToLoggedOutHomepage(page, identity);

	await page.goto('/signup');
	await page.getByRole('textbox', { name: 'Full name' }).fill('QA Tester');
	await page.getByRole('textbox', { name: 'Email' }).fill(authEmail);
	await page.getByRole('button', { name: 'Sign up' }).click();
	await expectDashboard(page);

	await page.getByRole('button', { name: 'Logout' }).click();
	await expect(page).toHaveURL(/\/login/);
	await page.getByRole('textbox', { name: 'Email' }).fill(authEmail);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expectDashboard(page);
});

test('demo and social shortcuts reflect configured providers', async ({
	page,
}, testInfo) => {
	await goToLoggedOutHomepage(page, buildE2EIdentity(testInfo));
	await page.goto('/login');

	await page.getByRole('button', { name: 'Try demo' }).click();
	await expectDashboard(page);
	await page.getByRole('button', { name: 'Logout' }).click();
	await expect(page).toHaveURL(/\/login/);

	const googleButton = page.getByRole('button', {
		name: 'Continue with Google',
	});
	if (socialAuthAvailability.google) {
		await googleButton.click();
		await expectDashboard(page);
		await page.getByRole('button', { name: 'Logout' }).click();
		await expect(page).toHaveURL(/\/login/);
	} else {
		await expect(googleButton).toHaveCount(0);
	}

	const githubButton = page.getByRole('button', {
		name: 'Continue with GitHub',
	});
	if (socialAuthAvailability.github) {
		await githubButton.click();
		await expectDashboard(page);
	} else {
		await expect(githubButton).toHaveCount(0);
	}
});
