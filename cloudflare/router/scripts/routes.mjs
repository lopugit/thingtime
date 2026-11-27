#!/usr/bin/env node
// One-click route switching for the thingtime.com router Worker.
//
//   node scripts/routes.mjs show
//   node scripts/routes.mjs set <group|default|*> <vercel|worker>
//   node scripts/routes.mjs reset
//
// Needs CLOUDFLARE_API_TOKEN in the environment (never pass it as an
// argument). The account and KV namespace ids come from wrangler.toml. The
// router caches the table for 30 s and KV can take up to 60 s to propagate, so
// a switch is live everywhere within about 90 s. Rollback is the same command
// with the previous target.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROUTE_TABLE_KEY } from '../src/index.js';
import { DEFAULT_ROUTE_TABLE, validateRouteTable, withTarget } from '../src/routeTable.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = readFileSync(join(root, 'wrangler.toml'), 'utf8');
const accountId = config.match(/^account_id\s*=\s*"([0-9a-f]{32})"/m)?.[1];
const namespaceId = config.match(/binding\s*=\s*"ROUTES"[\s\S]*?\bid\s*=\s*"([0-9a-f]{32})"/)?.[1];
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !namespaceId) throw new Error('wrangler.toml needs account_id and the ROUTES KV namespace id');
if (!token) throw new Error('Set CLOUDFLARE_API_TOKEN in the environment');

const valueUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${ROUTE_TABLE_KEY}`;
const headers = { Authorization: `Bearer ${token}` };

async function readTable() {
	const response = await fetch(valueUrl, { headers });
	if (response.status === 404) return { table: DEFAULT_ROUTE_TABLE, stored: false };
	if (!response.ok) throw new Error(`Reading the route table failed: HTTP ${response.status}`);
	const checked = validateRouteTable(await response.json());
	if (!checked.ok) throw new Error(`Stored route table is invalid: ${checked.error}`);
	return { table: checked.table, stored: true };
}

async function writeTable(table) {
	const checked = validateRouteTable(table);
	if (!checked.ok) throw new Error(checked.error);
	const response = await fetch(valueUrl, { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(checked.table) });
	const body = await response.json().catch(() => ({}));
	if (!response.ok || body.success === false) throw new Error(`Writing the route table failed: HTTP ${response.status}`);
	return checked.table;
}

const summary = (table) =>
	[`default: ${table.default}`, ...Object.entries(table.groups).map(([name, entry]) => `${name.padEnd(14)} ${entry.target.padEnd(7)} ${entry.prefixes.join(' ')}`)].join('\n');

const [command, group, target] = process.argv.slice(2);
if (command === 'show') {
	const { table, stored } = await readTable();
	console.log(`${stored ? 'stored' : 'not stored yet; router uses the built-in default'}\n${summary(table)}`);
} else if (command === 'set' && group && target) {
	const { table } = await readTable();
	const next = await writeTable(withTarget(table, group, target));
	if (target === 'worker') console.log('Note: until an API Worker is bound, the router sends "worker" routes to Vercel.');
	console.log(`saved (live within ~90 s)\n${summary(next)}`);
} else if (command === 'reset') {
	console.log(`saved (live within ~90 s)\n${summary(await writeTable(DEFAULT_ROUTE_TABLE))}`);
} else {
	console.log('Usage: routes.mjs show | set <group|default|*> <vercel|worker> | reset');
	process.exitCode = 2;
}
