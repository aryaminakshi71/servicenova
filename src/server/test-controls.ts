let fixedNowMs: number | null = null;
let seededState: number | null = null;

function nextSeededByte() {
	if (seededState === null) {
		throw new Error('Seeded random state is not initialized');
	}

	seededState = (seededState * 1_664_525 + 1_013_904_223) >>> 0;
	return seededState & 0xff;
}

export function nowMs() {
	return fixedNowMs ?? Date.now();
}

export function nowIso() {
	return new Date(nowMs()).toISOString();
}

export function randomUuid() {
	if (seededState === null) {
		return crypto.randomUUID();
	}

	const bytes = new Uint8Array(16);
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = nextSeededByte();
	}

	// Force UUID v4 shape while keeping deterministic byte stream.
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));

	return [
		hex.slice(0, 4).join(''),
		hex.slice(4, 6).join(''),
		hex.slice(6, 8).join(''),
		hex.slice(8, 10).join(''),
		hex.slice(10).join(''),
	].join('-');
}

export function freezeNowForTests(ms: number) {
	fixedNowMs = ms;
}

export function advanceNowForTests(ms: number) {
	if (fixedNowMs === null) {
		return;
	}

	fixedNowMs += ms;
}

export function setDeterministicSeedForTests(seed: number) {
	seededState = seed >>> 0;
}

export function resetTestControlsForTests() {
	fixedNowMs = null;
	seededState = null;
}
