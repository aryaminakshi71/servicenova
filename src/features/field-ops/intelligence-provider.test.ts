import { describe, expect, it, vi } from 'vitest';
import {
	getFieldIntelligenceProvider,
	resetFieldIntelligenceProviderForTests,
} from './intelligence-provider';

describe('field intelligence provider runtime', () => {
	it('defaults to mock provider and returns null', async () => {
		const previousProvider = process.env.FIELD_INTELLIGENCE_PROVIDER;
		const previousBaseUrl = process.env.FIELD_INTELLIGENCE_BASE_URL;

		delete process.env.FIELD_INTELLIGENCE_PROVIDER;
		delete process.env.FIELD_INTELLIGENCE_BASE_URL;
		await resetFieldIntelligenceProviderForTests();

		try {
			const provider = await getFieldIntelligenceProvider();
			const result = await provider.generateWorkOrderIntelligence({
				jobId: 'job-1',
				title: 'Compressor fault',
				requiredSkills: ['hvac'],
				estimatedMinutes: 60,
				priority: 'high',
				symptoms: ['fault'],
			});

			expect(result).toBeNull();
		} finally {
			if (previousProvider === undefined) {
				delete process.env.FIELD_INTELLIGENCE_PROVIDER;
			} else {
				process.env.FIELD_INTELLIGENCE_PROVIDER = previousProvider;
			}

			if (previousBaseUrl === undefined) {
				delete process.env.FIELD_INTELLIGENCE_BASE_URL;
			} else {
				process.env.FIELD_INTELLIGENCE_BASE_URL = previousBaseUrl;
			}
			await resetFieldIntelligenceProviderForTests();
		}
	});

	it('uses http provider when configured', async () => {
		const previousProvider = process.env.FIELD_INTELLIGENCE_PROVIDER;
		const previousBaseUrl = process.env.FIELD_INTELLIGENCE_BASE_URL;
		const previousFetch = globalThis.fetch;

		process.env.FIELD_INTELLIGENCE_PROVIDER = 'http';
		process.env.FIELD_INTELLIGENCE_BASE_URL = 'https://provider.example.test';
		globalThis.fetch = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					result: {
						predictedDurationMinutes: 88,
						confidence: 0.81,
						probableDiagnoses: [
							{
								label: 'Compressor issue',
								confidence: 0.8,
								rationale: 'model output',
							},
						],
						recommendedParts: ['compressor relay'],
						recommendedActions: ['check static pressure'],
						generatedAt: new Date().toISOString(),
					},
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } },
			);
		}) as unknown as typeof fetch;
		await resetFieldIntelligenceProviderForTests();

		try {
			const provider = await getFieldIntelligenceProvider();
			const result = await provider.generateWorkOrderIntelligence({
				jobId: 'job-1',
				title: 'Compressor fault',
				requiredSkills: ['hvac'],
				estimatedMinutes: 60,
				priority: 'high',
				symptoms: ['fault'],
			});

			expect(result?.predictedDurationMinutes).toBe(88);
			expect(result?.recommendedParts[0]).toBe('compressor relay');
		} finally {
			if (previousProvider === undefined) {
				delete process.env.FIELD_INTELLIGENCE_PROVIDER;
			} else {
				process.env.FIELD_INTELLIGENCE_PROVIDER = previousProvider;
			}

			if (previousBaseUrl === undefined) {
				delete process.env.FIELD_INTELLIGENCE_BASE_URL;
			} else {
				process.env.FIELD_INTELLIGENCE_BASE_URL = previousBaseUrl;
			}

			globalThis.fetch = previousFetch;
			await resetFieldIntelligenceProviderForTests();
		}
	});
});
