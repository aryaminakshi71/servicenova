import { describe, expect, it } from 'vitest';
import {
	advanceNowForTests,
	freezeNowForTests,
	nowIso,
	nowMs,
	randomUuid,
	resetTestControlsForTests,
	setDeterministicSeedForTests,
} from './test-controls';

describe('test controls', () => {
	it('freezes and advances clock for deterministic tests', () => {
		resetTestControlsForTests();
		freezeNowForTests(Date.parse('2026-03-01T00:00:00.000Z'));

		expect(nowIso()).toBe('2026-03-01T00:00:00.000Z');
		advanceNowForTests(2_500);
		expect(nowMs()).toBe(Date.parse('2026-03-01T00:00:02.500Z'));

		resetTestControlsForTests();
	});

	it('generates repeatable UUIDs when seeded', () => {
		resetTestControlsForTests();
		setDeterministicSeedForTests(42);
		const first = randomUuid();
		const second = randomUuid();

		resetTestControlsForTests();
		setDeterministicSeedForTests(42);
		const replayedFirst = randomUuid();
		const replayedSecond = randomUuid();

		expect(first).toBe(replayedFirst);
		expect(second).toBe(replayedSecond);
		expect(first).not.toBe(second);

		resetTestControlsForTests();
	});
});
