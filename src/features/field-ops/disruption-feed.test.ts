import { describe, expect, it } from 'vitest';
import {
	getDisruptionFeedProvider,
	resetDisruptionFeedProviderForTests,
} from './disruption-feed';
import {
	listJobs,
	listTechnicians,
	resetFieldOpsStateForTests,
} from './service';

describe('disruption feed provider runtime', () => {
	it('returns no signals by default in mock mode', async () => {
		const previous = process.env.MOCK_DISRUPTION_ENABLED;
		delete process.env.MOCK_DISRUPTION_ENABLED;
		resetFieldOpsStateForTests();
		resetDisruptionFeedProviderForTests();

		try {
			const provider = getDisruptionFeedProvider();
			const signals = await provider.pollSignals({
				jobs: listJobs(),
				technicians: listTechnicians(),
			});

			expect(signals.length).toBe(0);
		} finally {
			if (previous === undefined) {
				delete process.env.MOCK_DISRUPTION_ENABLED;
			} else {
				process.env.MOCK_DISRUPTION_ENABLED = previous;
			}
			resetDisruptionFeedProviderForTests();
		}
	});

	it('returns signals when mock disruption feed is enabled', async () => {
		const previous = process.env.MOCK_DISRUPTION_ENABLED;
		process.env.MOCK_DISRUPTION_ENABLED = 'true';
		resetFieldOpsStateForTests();
		resetDisruptionFeedProviderForTests();

		try {
			const provider = getDisruptionFeedProvider();
			const signals = await provider.pollSignals({
				jobs: listJobs(),
				technicians: listTechnicians(),
			});

			expect(signals.length).toBeGreaterThan(0);
			expect(signals[0]?.type).toBe('technician_unavailable');
		} finally {
			if (previous === undefined) {
				delete process.env.MOCK_DISRUPTION_ENABLED;
			} else {
				process.env.MOCK_DISRUPTION_ENABLED = previous;
			}
			resetDisruptionFeedProviderForTests();
		}
	});
});
