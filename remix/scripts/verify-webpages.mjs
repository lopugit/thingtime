#!/usr/bin/env node
// Live verification of the Webpages family — real API only (FUNDAMENTALS §2).
//   node scripts/verify-webpages.mjs [baseUrl]
// Admin credentials ride TT_SEED_ADMIN_USER / TT_SEED_ADMIN_PASS (login first,
// register with the same credentials as a fallback so a fresh stack
// bootstraps itself — ADMIN_USERNAMES is what actually makes them an admin).
// Covers: the admin seed gate (401 anon / 403 non-admin), seeding + census
// (totalSeeded >= 26), site-route + global resolution (system docs, native
// blocks) both authed and anonymous, a user page's create → resolve →
// update → publicise → delete lifecycle with component-ref resolution, and
// the sanitizer refusals (reserved webpage- shareId, duplicate block ids).
import { randomBytes } from 'node:crypto';

const BASE = process.argv[2] || process.env.TT_VERIFY_BASE || 'http://127.0.0.1:9999';
let passed = 0;
const failures = [];
const check = (name, condition, detail = '') => {
	if (condition) {
		passed += 1;
		console.log(`  ✓ ${name}`);
	} else {
		failures.push(name);
		console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
	}
};

const api = async (path, { cookie, method = 'GET', body, headers = {} } = {}) => {
	const response = await fetch(`${BASE}${path}`, {
		method,
		headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
		...(body !== undefined ? { body: JSON.stringify(body) } : {})
	});
	let json = null;
	try {
		json = await response.json();
	} catch {}
	return { status: response.status, body: json };
};

const suffix = `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
const register = async (name) => {
	const username = `${name}${suffix}`;
	const response = await fetch(`${BASE}/api/v1/auth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password: 'Verify1234!pass', email: `${username}@example.com` })
	});
	const match = /tt_auth=[^;]+/.exec(response.headers.get('set-cookie') || '');
	const body = await response.json();
	if (!response.ok || !match) throw new Error(`registration failed for ${username}: ${JSON.stringify(body)}`);
	return { username, id: body.user.id, cookie: match[0] };
};

const login = async (username, password) => {
	const response = await fetch(`${BASE}/api/v1/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password })
	});
	const match = /tt_auth=[^;]+/.exec(response.headers.get('set-cookie') || '');
	if (!response.ok || !match) return null;
	return match[0];
};

const adminSession = async () => {
	const username = process.env.TT_SEED_ADMIN_USER || '';
	const password = process.env.TT_SEED_ADMIN_PASS || '';
	if (!username || !password) {
		console.log('  ! TT_SEED_ADMIN_USER/TT_SEED_ADMIN_PASS unset — registering a throwaway (admin checks need that name in ADMIN_USERNAMES)');
		return (await register('wpseed')).cookie;
	}
	const cookie = await login(username, password);
	if (cookie) return cookie;
	// fresh stack: the admin user may not exist yet — register it with the
	// provided credentials so the run is self-bootstrapping
	const response = await fetch(`${BASE}/api/v1/auth/register`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, password, email: `${username}@example.com` })
	});
	const match = /tt_auth=[^;]+/.exec(response.headers.get('set-cookie') || '');
	const body = await response.json().catch(() => null);
	if (!response.ok || !match) throw new Error(`admin login and register both failed for ${username}: ${JSON.stringify(body)}`);
	return match[0];
};

const run = async () => {
	console.log(`Webpages verification against ${BASE}\n`);

	// ---- admin seed gate ----------------------------------------------------
	check('anonymous seed POST is 401', (await api('/api/v1/admin/webpages/seed', { method: 'POST', body: {} })).status === 401);

	const user = await register('wpverify');
	check(
		'non-admin seed POST is 403',
		(await api('/api/v1/admin/webpages/seed', { cookie: user.cookie, method: 'POST', body: {} })).status === 403
	);
	check('non-admin seed census GET is 403', (await api('/api/v1/admin/webpages/seed', { cookie: user.cookie })).status === 403);

	// ---- admin seed + census ------------------------------------------------
	const adminCookie = await adminSession();
	const seeded = await api('/api/v1/admin/webpages/seed', { cookie: adminCookie, method: 'POST' });
	check('admin seed POST succeeds', seeded.status === 200 && seeded.body?.ok === true, JSON.stringify(seeded.body).slice(0, 160));
	check(
		'seed covers every site page (totalSeeded >= 26)',
		(seeded.body?.totalSeeded || 0) >= 26,
		`totalSeeded=${seeded.body?.totalSeeded}`
	);
	const census = await api('/api/v1/admin/webpages/seed', { cookie: adminCookie });
	check(
		'census GET reports the seeded corpus',
		census.status === 200 && census.body?.ok === true && (census.body?.totalSeeded || 0) >= 26,
		`totalSeeded=${census.body?.totalSeeded}`
	);

	// ---- site-route + global resolution -------------------------------------
	const status = await api('/api/v1/webpages/resolve?path=/status', { cookie: adminCookie });
	check(
		'path=/status resolves for a session',
		status.status === 200 && status.body?.ok === true && status.body?.page?.crystal?.siteRoute === '/status'
	);

	const globalDoc = await api('/api/v1/webpages/resolve?global=1', { cookie: adminCookie });
	check(
		'global=1 resolves the site-global doc',
		globalDoc.status === 200 && globalDoc.body?.ok === true && globalDoc.body?.page?.crystal?.pageKey === 'site-global'
	);

	// anonymous viewers only ever see the system docs — the deterministic arm
	const anonStatus = await api('/api/v1/webpages/resolve?path=/status');
	check(
		'anonymous /status resolve returns the system doc',
		anonStatus.status === 200 &&
			anonStatus.body?.ok === true &&
			anonStatus.body?.source === 'system' &&
			anonStatus.body?.page?.id === 'webpage-route-status'
	);
	const statusBlocks = anonStatus.body?.page?.crystal?.blocks || [];
	check(
		'system /status body is native section blocks (status-* keys)',
		statusBlocks.length >= 1 && statusBlocks.every((block) => block?.type === 'native' && String(block?.native || '').startsWith('status')),
		JSON.stringify(statusBlocks).slice(0, 160)
	);
	const anonGlobal = await api('/api/v1/webpages/resolve?global=1');
	check(
		'anonymous global resolve returns the system doc',
		anonGlobal.status === 200 &&
			anonGlobal.body?.ok === true &&
			anonGlobal.body?.source === 'system' &&
			anonGlobal.body?.page?.crystal?.pageKey === 'site-global'
	);

	// ---- user page lifecycle (unified things path) ---------------------------
	const created = await api('/api/v1/things', {
		cookie: user.cookie,
		method: 'POST',
		body: {
			thingtime: ['webpage'],
			acl: ['tt:user'],
			crystal: {
				name: 'Verify page',
				blocks: [
					{ id: 'intro', type: 'text', text: 'Hello from verify-webpages' },
					{ id: 'cta', type: 'component', component: 'thingtime-button-solid' }
				]
			}
		}
	});
	const createdId = created.body?.thing?.id;
	check('user creates a webpage thing', created.status === 200 && created.body?.ok === true && !!createdId, JSON.stringify(created.body).slice(0, 160));

	const mine = await api(`/api/v1/webpages/resolve?id=${createdId}`, { cookie: user.cookie });
	check(
		'owner resolves the page by id',
		mine.status === 200 && mine.body?.ok === true && mine.body?.source === 'user' && mine.body?.page?.crystal?.blocks?.length === 2
	);
	check(
		'refs map lists the component reference',
		mine.status === 200 && Object.prototype.hasOwnProperty.call(mine.body?.refs || {}, 'thingtime-button-solid')
	);
	const resolvedRef = (mine.body?.refs || {})['thingtime-button-solid'];
	if (resolvedRef) {
		check('component ref resolves to the seeded catalog doc', resolvedRef === 'component-thingtime-button-solid', `resolved=${resolvedRef}`);
		check(
			'resolved component doc rides along in components[]',
			(mine.body?.components || []).some((entry) => entry.id === resolvedRef)
		);
	} else {
		console.log('  ! component catalog unseeded — thingtime-button-solid resolved to null (seed via /api/v1/admin/components/seed for full ref coverage)');
	}

	const updated = await api('/api/v1/things', {
		cookie: user.cookie,
		method: 'PATCH',
		body: {
			id: createdId,
			crystal: {
				name: 'Verify page v2',
				blocks: [
					{ id: 'intro', type: 'text', text: 'Hello again' },
					{ id: 'cta', type: 'component', component: 'thingtime-button-solid' },
					{ id: 'outro', type: 'text', text: 'Updated by verify-webpages' }
				]
			}
		}
	});
	check('owner updates the page', updated.status === 200 && updated.body?.ok === true, JSON.stringify(updated.body).slice(0, 160));
	const afterUpdate = await api(`/api/v1/webpages/resolve?id=${createdId}`, { cookie: user.cookie });
	check(
		'resolve reflects the update',
		afterUpdate.body?.page?.crystal?.name === 'Verify page v2' && afterUpdate.body?.page?.crystal?.blocks?.length === 3
	);

	const anonBefore = await api(`/api/v1/webpages/resolve?id=${createdId}`);
	check('private page is hidden from anonymous viewers', anonBefore.status === 404);
	const publicised = await api('/api/v1/things', { cookie: user.cookie, method: 'PATCH', body: { id: createdId, acl: ['tt:all'] } });
	check('owner publicises the page', publicised.status === 200 && publicised.body?.ok === true, JSON.stringify(publicised.body).slice(0, 120));
	const anonAfter = await api(`/api/v1/webpages/resolve?id=${createdId}`);
	check(
		'anonymous viewers resolve the public page',
		anonAfter.status === 200 && anonAfter.body?.ok === true && anonAfter.body?.page?.crystal?.blocks?.length === 3
	);

	// ---- sanitizer refusals --------------------------------------------------
	const reserved = await api('/api/v1/things', {
		cookie: user.cookie,
		method: 'POST',
		body: { thingtime: ['webpage'], shareId: 'webpage-squat-attempt', crystal: { name: 'Squat', blocks: [{ id: 'a', type: 'text', text: 'hi' }] } }
	});
	check('reserved webpage- shareId is refused', reserved.status === 400, JSON.stringify(reserved.body).slice(0, 120));

	const duplicate = await api('/api/v1/things', {
		cookie: user.cookie,
		method: 'POST',
		body: {
			thingtime: ['webpage'],
			crystal: {
				name: 'Dup ids',
				blocks: [
					{ id: 'a', type: 'text', text: 'one' },
					{ id: 'a', type: 'text', text: 'two' }
				]
			}
		}
	});
	check('duplicate block ids are refused', duplicate.status === 400, JSON.stringify(duplicate.body).slice(0, 120));

	// ---- cleanup -------------------------------------------------------------
	const removed = await api(`/api/v1/things?id=${createdId}`, { cookie: user.cookie, method: 'DELETE' });
	check('owner deletes the verify page', removed.status === 200 && removed.body?.ok === true, JSON.stringify(removed.body).slice(0, 120));
	const afterDelete = await api(`/api/v1/webpages/resolve?id=${createdId}`);
	check('deleted page no longer resolves', afterDelete.status === 404);

	console.log(`\n${passed} passed, ${failures.length} failed`);
	if (failures.length) {
		console.log('Failed:');
		for (const name of failures) console.log(`  - ${name}`);
	}
	process.exit(failures.length ? 1 : 0);
};

run().catch((err) => {
	console.error('verification crashed:', err);
	process.exit(1);
});
