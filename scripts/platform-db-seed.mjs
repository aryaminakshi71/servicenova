#!/usr/bin/env node
console.log(
	JSON.stringify(
		{
			ok: true,
			seed: 'noop',
			message:
				'Replace scripts/platform-db-seed.mjs with project-specific seed logic.',
		},
		null,
		2,
	),
);
