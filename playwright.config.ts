import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PORT ?? 3008);
const baseURL = `http://localhost:${port}`;
const e2eResetToken =
	process.env.E2E_TEST_RESET_TOKEN ?? 'servicenova-e2e-reset-token';

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 3 : undefined,
	reporter: 'html',
	use: {
		baseURL,
		trace: 'on-first-retry',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
	webServer: {
		command: `E2E_TEST=true E2E_TEST_RESET_TOKEN=${e2eResetToken} bun run dev -- --port ${port}`,
		url: baseURL,
		reuseExistingServer: !process.env.CI,
		timeout: 120000,
	},
});
