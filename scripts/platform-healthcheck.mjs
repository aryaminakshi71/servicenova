#!/usr/bin/env node
const startedAt = new Date().toISOString();
console.log(
	JSON.stringify(
		{ ok: true, check: 'platform-healthcheck', startedAt },
		null,
		2,
	),
);
