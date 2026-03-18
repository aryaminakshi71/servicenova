import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'jsdom',
		globals: true,
		include: ['src/**/*.{test,spec}.{ts,tsx}'],
		exclude: ['**/e2e/**', '**/node_modules/**', '**/dist/**', '**/build/**'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary', 'lcov'],
			include: ['src/server/routes/**/*.ts', 'src/features/field-ops/**/*.ts'],
			exclude: [
				'**/*.test.ts',
				'**/*.integration.test.ts',
				'**/*.spec.ts',
				'**/*.d.ts',
				'**/index.ts',
			],
			thresholds: {
				lines: 75,
				functions: 80,
				branches: 60,
				statements: 75,
			},
		},
	},
});
