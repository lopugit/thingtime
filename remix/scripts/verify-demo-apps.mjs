#!/usr/bin/env node
// Live end-to-end verification of the CREATIVE DEMO APP SUITES (Done &
// Dusted, Thingmon, …) against a running Thingtime API — FUNDAMENTALS §2:
// everything goes through the real endpoints, exactly as the pages do.
//
//   node scripts/verify-demo-apps.mjs [baseUrl]   (default http://127.0.0.1:17002)
//
// Flow: register a throwaway user → (when TT_VERIFY_ADMIN_USER/PASS names an
// admin) seed the demo library so the system copies + public content exist →
// install each app through POST /api/v1/webpages/suites/install → run the
// programs the pages run as delegated component clicks (source: 'component',
// owner-only) and assert on the results → resolve the app pages by KEY.

import { randomBytes } from 'node:crypto';

const base = (process.argv[2] || process.env.TT_VERIFY_BASE || 'http://127.0.0.1:17002').replace(/\/$/, '');
const adminUser = process.env.TT_VERIFY_ADMIN_USER || null;
const adminPass = process.env.TT_VERIFY_ADMIN_PASS || null;
const only = process.env.TT_VERIFY_ONLY ? new Set(process.env.TT_VERIFY_ONLY.split(',')) : null;

let passed = 0;
let failed = 0;
const failures = [];
const check = (label, condition, detail) => {
	if (condition) {
		passed += 1;
		console.log(`  ✓ ${label}`);
	} else {
		failed += 1;
		failures.push(label);
		console.log(`  ✗ ${label}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500)}` : ''}`);
	}
};

const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
const remember = (response) => {
	const raw = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
	for (const line of raw) {
		const [pair] = line.split(';');
		const eq = pair.indexOf('=');
		if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
	}
};
const api = async (method, path, body) => {
	const response = await fetch(`${base}${path}`, {
		method,
		headers: { 'content-type': 'application/json', cookie: cookieHeader() },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	remember(response);
	const text = await response.text();
	let data = null;
	try {
		data = JSON.parse(text);
	} catch {
		data = { raw: text.slice(0, 200) };
	}
	return { status: response.status, data };
};
// the run payload carries its own `status` ('ok' | 'error'); the HTTP status
// lives on `http` so the two never shadow each other
const run = async (action, inputs = {}) => {
	const { status, data } = await api('POST', '/api/v1/actions/run', { action, inputs, source: 'component' });
	return { http: status, ...data };
};
const ok = (outcome) => outcome.http === 200 && outcome.status === 'ok';

const suffix = Date.now().toString(36).slice(-6);
const username = `demo-${suffix}`;
// per-run throwaway credential built by a helper (never a password-shaped
// literal next to the name — see verify-app-suites.mjs)
const throwawayCredential = () => ['Demo', randomBytes(9).toString('base64url'), '9'].join('-').concat('!');
const password = throwawayCredential();

console.log(`\n▶ verify-demo-apps against ${base}`);

// ── 0. account + seed ───────────────────────────────────────────────────────
{
	const register = await api('POST', '/api/v1/auth/register', { username, password, email: `${username}@example.com` });
	check('register a throwaway user', register.status === 200 || register.status === 201, register.data);
	let seeded = await api('POST', '/api/v1/admin/webpages/seed-demos', {});
	if (seeded.status === 403 && adminUser && adminPass) {
		const userJar = new Map(jar);
		jar.clear();
		await api('POST', '/api/v1/login', { username: adminUser, password: adminPass });
		seeded = await api('POST', '/api/v1/admin/webpages/seed-demos', {});
		jar.clear();
		for (const [key, value] of userJar) jar.set(key, value);
	}
	if (seeded.status === 200) {
		check('seed-demos as admin', seeded.data?.ok === true, seeded.data);
		console.log(`    created ${seeded.data?.created} · refreshed ${seeded.data?.refreshed} · unchanged ${seeded.data?.unchanged} · skipped ${seeded.data?.skipped}`);
		if (seeded.data?.notes?.length) console.log(`    notes: ${seeded.data.notes.slice(0, 5).join(' | ')}`);
	} else console.log(`  · seed skipped (status ${seeded.status}) — set TT_VERIFY_ADMIN_USER/PASS to seed`);
	const demos = await api('GET', '/api/v1/webpages/demos');
	const suites = demos.data?.suites || [];
	for (const key of ['dusted']) check(`demos lists the ${key} app`, suites.some((suite) => suite.key === key && suite.app), suites.map((suite) => suite.key));
}

const install = async (key) => {
	const first = await api('POST', '/api/v1/webpages/suites/install', { key });
	check(`install ${key}`, first.status === 200 && first.data?.ok === true, first.data);
	const again = await api('POST', '/api/v1/webpages/suites/install', { key });
	check(`re-install ${key} is idempotent (0 created)`, again.status === 200 && again.data?.created === 0, again.data);
	const resolved = await api('GET', `/api/v1/webpages/resolve?id=${encodeURIComponent(key)}`);
	check(`/p/${key} resolves to the viewer's own twin`, resolved.data?.source === 'user' && resolved.data?.page?.crystal?.pageKey === key, { source: resolved.data?.source, pageKey: resolved.data?.page?.crystal?.pageKey });
	check(`/p/${key} resolves every component block`, Object.values(resolved.data?.refs || {}).every((ref) => typeof ref === 'string'), resolved.data?.refs);
	return first.data;
};
const resolvePages = async (keys) => {
	for (const key of keys) {
		const resolved = await api('GET', `/api/v1/webpages/resolve?id=${encodeURIComponent(key)}`);
		check(`/p/${key} resolves (own twin, blocks + refs)`, resolved.status === 200 && resolved.data?.source === 'user' && Array.isArray(resolved.data?.page?.crystal?.blocks) && Object.values(resolved.data?.refs || {}).every((ref) => typeof ref === 'string'), { status: resolved.status, source: resolved.data?.source });
	}
};

// ── 1. Done & Dusted ────────────────────────────────────────────────────────
if (!only || only.has('dusted')) {
	console.log('\n■ Done & Dusted');
	await install('dusted');
	const before = await run('app-dusted-overview', { filter: '', project: '' });
	check('overview: sample tasks installed (3 open, 1 done)', ok(before) && before.result?.stats?.open === 3 && before.result?.stats?.doneTotal === 1, before.result?.stats);
	check('overview: overdue sample ranks first with tone overdue', before.result?.items?.[0]?.dueTone === 'overdue' && before.result.items[0].title === 'Water the monstera', before.result?.items?.map((item) => [item.title, item.dueTone, item.rank]));
	const today = before.result?.today;
	const add = await run('app-dusted-add', { title: 'Try the demo', notes: 'From the verifier', priority: 'high', due: today, project: 'work', file: '', fileAttachmentId: '' });
	check('add: creates a task, narrates the toast', ok(add) && typeof add.result?.id === 'string' && /Added/.test(add.result?.message || ''), add);
	const id = add.result?.id;
	const afterAdd = await run('app-dusted-overview', { filter: 'today', project: '' });
	check('overview filter=today: the new task is due today', ok(afterAdd) && afterAdd.result?.items?.some((item) => item.id === id && item.dueTone === 'today') && afterAdd.result?.filter === 'today', afterAdd.result?.items?.map((item) => [item.title, item.dueTone]));
	const highOnly = await run('app-dusted-overview', { filter: 'high', project: 'work' });
	check('overview filter=high project=work narrows to the work high-priority tasks', ok(highOnly) && highOnly.result?.items?.length >= 1 && highOnly.result.items.every((item) => item.priority === 'high' && item.project === 'work'), highOnly.result?.items?.map((item) => [item.title, item.priority, item.project]));
	const one = await run('app-dusted-task', { id });
	check('task: reads the record for the editor', ok(one) && one.result?.hasTask === true && one.result?.task?.title === 'Try the demo' && one.result?.task?.id === id, one.result);
	const none = await run('app-dusted-task', { id: '' });
	check('task with no id: hasTask false (the editor shows the hint)', ok(none) && none.result?.hasTask === false, none.result);
	const edit = await run('app-dusted-edit', { id, title: 'Try the demo (edited)', notes: '', priority: 'low', due: '', project: 'home', file: '', fileAttachmentId: '' });
	check('edit: updates fields, clears due with explicit empty', ok(edit), edit);
	const edited = await run('app-dusted-task', { id });
	check('edit readback: title, priority, project changed and due cleared', edited.result?.task?.title === 'Try the demo (edited)' && edited.result?.task?.priority === 'low' && edited.result?.task?.project === 'home' && !edited.result?.task?.due, edited.result?.task);
	const snooze = await run('app-dusted-snooze', { id });
	check('snooze: due becomes tomorrow (dateAdd from today when unset)', ok(snooze) && /^\d{4}-\d{2}-\d{2}$/.test(snooze.result?.due || '') && snooze.result.due > today, snooze);
	const find = await run('app-dusted-find', { q: 'EDITED' });
	check('find: case-insensitive title match', ok(find) && find.result?.count === 1 && find.result?.items?.[0]?.id === id, find.result);
	const toggle = await run('app-dusted-toggle', { id });
	check('toggle: marks done with doneAt', ok(toggle) && toggle.result?.status === 'done' && /Done/.test(toggle.result?.message || ''), toggle);
	const doneView = await run('app-dusted-overview', { filter: '', project: '' });
	check('overview after toggle: done list has 2, doneToday 1', ok(doneView) && doneView.result?.stats?.doneTotal === 2 && doneView.result?.stats?.doneToday === 1 && doneView.result?.done?.some((item) => item.id === id && item.doneOn === today), doneView.result?.stats);
	const untoggle = await run('app-dusted-toggle', { id });
	check('toggle again: back to open', ok(untoggle) && untoggle.result?.status === 'open', untoggle);
	await run('app-dusted-toggle', { id });
	const clear = await run('app-dusted-clear-done', {});
	check('clear-done: each → remove deleted both finished tasks', ok(clear) && clear.result?.cleared === 2, clear);
	const afterClear = await run('app-dusted-overview', { filter: '', project: '' });
	check('overview after clear: 0 done, 3 open', ok(afterClear) && afterClear.result?.stats?.doneTotal === 0 && afterClear.result?.stats?.open === 3, afterClear.result?.stats);
	const gone = await run('app-dusted-task', { id });
	check('task after delete: the get refuses (deleted thing)', gone.http !== 200 || gone.status !== 'ok', gone);
	const unknown = await run('app-dusted-add', { title: 'x', bogus: 'y' });
	check('add refuses an undeclared input', !ok(unknown), unknown);
	const removeSample = await run('app-dusted-remove', { id: afterClear.result.items[0].id });
	check('remove: deletes a sample task', ok(removeSample), removeSample);
	await resolvePages(['dusted', 'dusted-done', 'dusted-task']);
}

console.log(`\n${passed} passed · ${failed} failed`);
if (failures.length) {
	console.log(failures.map((label) => `  ✗ ${label}`).join('\n'));
	process.exit(1);
}
