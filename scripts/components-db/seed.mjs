#!/usr/bin/env node
// Seed the components-db folder database into the Thingtime dev DB as system
// things — through the real API only (FUNDAMENTALS §2): admin login →
// POST /api/v1/admin/components/seed in batches → census check.
//
//   node scripts/components-db/seed.mjs [baseUrl]
//
// Env (or untracked scripts/components-db/.seed-env, KEY=value lines):
//   TT_SEED_BASE        nitro base url (default http://127.0.0.1:16802)
//   TT_SEED_ADMIN_USER  admin username (must be on ADMIN_USERNAMES)
//   TT_SEED_ADMIN_PASS  admin password
//
// Idempotent: the endpoint upserts by shareId and self-heals drift, so
// re-runs converge (created → unchanged) and never duplicate.

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const dbRoot = path.join(repoRoot, 'components-db');

const loadSeedEnv = async () => {
	try {
		const raw = await readFile(path.join(repoRoot, 'scripts/components-db/.seed-env'), 'utf8');
		for (const line of raw.split('\n')) {
			const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
			if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
		}
	} catch {
		// no env file — rely on process env
	}
};

const BATCH_SIZE = 100;
// components.seed allows 30 calls/min fail-closed — pace well inside it
const BATCH_PAUSE_MS = 2500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = async () => {
	await loadSeedEnv();
	const BASE = process.argv[2] || process.env.TT_SEED_BASE || 'http://127.0.0.1:16802';
	const username = process.env.TT_SEED_ADMIN_USER;
	const password = process.env.TT_SEED_ADMIN_PASS;
	if (!username || !password) {
		console.error('Set TT_SEED_ADMIN_USER / TT_SEED_ADMIN_PASS (env or scripts/components-db/.seed-env).');
		process.exit(1);
	}

	const login = await fetch(`${BASE}/api/v1/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password })
	});
	const cookie = /tt_auth=[^;]+/.exec(login.headers.get('set-cookie') || '')?.[0];
	if (!login.ok || !cookie) {
		console.error(`admin login failed (${login.status}) — is the dev stack up at ${BASE} with ADMIN_USERNAMES=${username}?`);
		process.exit(1);
	}

	const api = async (pathname, init = {}) => {
		const response = await fetch(`${BASE}${pathname}`, {
			...init,
			headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(init.headers || {}) }
		});
		let body = null;
		try {
			body = await response.json();
		} catch {}
		return { status: response.status, body };
	};

	// verify admin standing before mutating anything
	const census = await api('/api/v1/admin/components/seed');
	if (census.status !== 200 || census.body?.ok !== true) {
		console.error(`seed census refused (${census.status}: ${census.body?.error || 'unknown'}) — user must be an admin (ADMIN_USERNAMES).`);
		process.exit(1);
	}
	console.log(`census before: ${census.body.totalSeeded} seeded components at ${BASE}`);

	const definitions = [];
	for (const library of (await readdir(path.join(dbRoot, 'components'))).sort()) {
		const dir = path.join(dbRoot, 'components', library);
		for (const file of (await readdir(dir)).sort()) {
			if (!file.endsWith('.json')) continue;
			definitions.push(JSON.parse(await readFile(path.join(dir, file), 'utf8')));
		}
	}
	console.log(`components-db: ${definitions.length} definitions to seed`);

	let created = 0;
	let refreshed = 0;
	let unchanged = 0;
	let skipped = 0;
	const notes = [];

	for (let offset = 0; offset < definitions.length; offset += BATCH_SIZE) {
		const batch = definitions.slice(offset, offset + BATCH_SIZE);
		let attempt = await api('/api/v1/admin/components/seed', { method: 'POST', body: JSON.stringify({ components: batch }) });
		if (attempt.status === 429) {
			await sleep(20_000);
			attempt = await api('/api/v1/admin/components/seed', { method: 'POST', body: JSON.stringify({ components: batch }) });
		}
		if (attempt.status !== 200 || attempt.body?.ok !== true) {
			console.error(`batch @${offset} failed (${attempt.status}): ${attempt.body?.error || 'unknown'}`);
			process.exit(1);
		}
		created += attempt.body.created;
		refreshed += attempt.body.refreshed;
		unchanged += attempt.body.unchanged;
		skipped += attempt.body.skipped;
		notes.push(...(attempt.body.notes || []));
		console.log(
			`batch @${offset}: +${attempt.body.created} created, ${attempt.body.refreshed} refreshed, ` +
				`${attempt.body.unchanged} unchanged, ${attempt.body.skipped} skipped (total seeded ${attempt.body.totalSeeded})`
		);
		if (offset + BATCH_SIZE < definitions.length) await sleep(BATCH_PAUSE_MS);
	}

	const after = await api('/api/v1/admin/components/seed');
	console.log(
		`\nseed complete: ${created} created, ${refreshed} refreshed, ${unchanged} unchanged, ${skipped} skipped` +
			`\ncensus after: ${after.body?.totalSeeded} seeded components`
	);
	if (notes.length) {
		console.log(`notes (${notes.length}):`);
		for (const note of notes.slice(0, 20)) console.log(`  - ${note}`);
	}
	process.exit(skipped > 0 ? 2 : 0);
};

run().catch((err) => {
	console.error('seed crashed:', err);
	process.exit(1);
});
