#!/usr/bin/env node
const names = [
	'DATABASE_URL',
	'DB_URL',
	'POSTGRES_URL',
	'MYSQL_URL',
	'MONGO_URL',
];
const present = names.find(
	(name) => process.env[name] && String(process.env[name]).trim().length > 0,
);

if (!present) {
	console.warn(
		JSON.stringify(
			{
				ok: true,
				check: 'platform-db-check',
				warning: 'No DB URL env var found (non-blocking baseline check).',
			},
			null,
			2,
		),
	);
	process.exit(0);
}

console.log(
	JSON.stringify(
		{ ok: true, check: 'platform-db-check', env: present },
		null,
		2,
	),
);
