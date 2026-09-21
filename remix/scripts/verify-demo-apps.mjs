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
	for (const key of ['dusted', 'thingmon']) check(`demos lists the ${key} app`, suites.some((suite) => suite.key === key && suite.app), suites.map((suite) => suite.key));
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

// ── 2. Thingmon ─────────────────────────────────────────────────────────────
if (!only || only.has('thingmon')) {
	console.log('\n■ Thingmon');
	await install('thingmon');
	const empty = await run('app-thingmon-state');
	check('state before start: no keeper, six zones, meadow unlocked', ok(empty) && empty.result?.hasKeeper === false && empty.result?.zones?.length === 6 && empty.result.zones[0].unlocked === true && empty.result.zones[5].unlocked === false, empty.result?.zones);
	const badStarter = await run('app-thingmon-start', { name: 'Ada', starterId: 2 });
	check('start refuses a non-starter species', !ok(badStarter) && /Cindrel/.test(badStarter.error || ''), badStarter);
	const start = await run('app-thingmon-start', { name: '  Ada  ', starterId: 4 });
	check('start creates the keeper and Puddlin', ok(start) && /Puddlin/.test(start.result?.message || ''), start);
	const again = await run('app-thingmon-start', { name: 'x', starterId: 1 });
	check('start twice is a no-op', ok(again) && again.result?.title === 'Welcome back', again);
	const state = await run('app-thingmon-state');
	const s = state.result || {};
	check('state after start: keeper Ada, 20 shards, one in party, lead Puddlin Lv5', s.hasKeeper === true && s.keeper?.name === 'Ada' && s.keeper?.shards === 20 && s.partyCount === 1 && s.lead?.species === 'Puddlin' && s.lead?.level === 5 && s.lead?.hpPercent === 100, { name: s.keeper?.name, shards: s.keeper?.shards, lead: s.lead && [s.lead.species, s.lead.level] });
	check('state paints the bag and dex counts', s.bag?.shard_crystal === 5 && s.bag?.tonic === 2 && s.dexCaughtCount === 1 && s.dexSeenCount === 1 && s.bagList?.length === 5, { bag: s.bag, dex: [s.dexCaughtCount, s.dexSeenCount] });
	const locked = await run('app-thingmon-explore', { zone: 'skybluff' });
	check('explore refuses a locked zone', !ok(locked) && /unlock/.test(locked.error || ''), locked);
	const explore = await run('app-thingmon-explore', { zone: 'meadow' });
	check('explore meadow opens a battle', ok(explore) && typeof explore.result?.encounter?.species === 'string' && explore.result.encounter.level >= 2 && explore.result.encounter.level <= 7, explore);
	const twice = await run('app-thingmon-explore', { zone: 'meadow' });
	check('explore during a battle is refused', !ok(twice) && /finish the battle/.test(twice.error || ''), twice);
	const inBattle = await run('app-thingmon-state');
	const b = inBattle.result?.battle;
	check('state in battle: wild + player views, log, zone colour', inBattle.result?.inBattle === true && typeof b?.wild?.sprite === 'string' && b?.player?.species === 'Puddlin' && Array.isArray(b?.recentLog) && b.recentLog.length === 1 && typeof b?.zoneColor === 'string', b && { wild: b.wild?.species, player: b.player?.species, log: b.recentLog });
	// fight it out (a Lv5 starter vs a Lv2–7 wild — the pack ends it within a few turns either way)
	let outcome = 'continue';
	let turns = 0;
	let last = null;
	while (outcome === 'continue' && turns < 30) {
		last = await run('app-thingmon-battle-move', { moveIndex: 1 });
		if (!ok(last)) break;
		outcome = last.result?.outcome;
		turns += 1;
	}
	check(`battle-move resolves turns until a verdict (${turns} turns → ${outcome})`, !!last && ok(last) && (outcome === 'won' || outcome === 'fainted'), last);
	const after = await run('app-thingmon-state');
	check('after the battle: no active battle, ledger moved', after.result?.inBattle === false && ((outcome === 'won' && after.result?.keeper?.wins === 1 && after.result?.keeper?.shards > 20) || (outcome === 'fainted' && after.result?.keeper?.losses === 1 && after.result?.lead?.hpPercent === 100)), { wins: after.result?.keeper?.wins, losses: after.result?.keeper?.losses, shards: after.result?.keeper?.shards, leadHp: after.result?.lead?.hpPercent });
	if (outcome === 'fainted') await run('app-thingmon-heal');
	// a catch attempt: explore, throw shard crystals until it is caught or the crystals run out
	let caught = false;
	let crystals = 5;
	let catchResult = null;
	for (let attempt = 0; attempt < 6 && !caught; attempt++) {
		const st = await run('app-thingmon-state');
		if (!st.result?.inBattle) {
			if ((st.result?.lead?.hpPercent ?? 0) < 40) await run('app-thingmon-heal');
			const ex = await run('app-thingmon-explore', { zone: 'meadow' });
			if (!ok(ex)) break;
		}
		if (crystals <= 0) break;
		catchResult = await run('app-thingmon-battle-catch', { itemId: 'shard-crystal' });
		if (!ok(catchResult)) break;
		crystals -= 1;
		caught = catchResult.result?.caught === true;
		if (catchResult.result?.outcome === 'fainted') await run('app-thingmon-heal');
	}
	check(`battle-catch rolls the capture (caught=${caught}, crystals left ${crystals})`, !!catchResult && ok(catchResult) && typeof catchResult.result?.caught === 'boolean' && /threw|Gotcha|broke|wobbled/i.test(catchResult.result?.message || ''), catchResult);
	const bagAfter = await run('app-thingmon-state');
	check('crystals were consumed from the bag', bagAfter.result?.bag?.shard_crystal === crystals, bagAfter.result?.bag);
	if (bagAfter.result?.inBattle) {
		const flee = await run('app-thingmon-battle-flee');
		check('battle-flee answers with escaped/log', ok(flee) && typeof flee.result?.escaped === 'boolean', flee);
		if (!flee.result?.escaped) {
			let fled = false;
			for (let i = 0; i < 6 && !fled; i++) {
				const again = await run('app-thingmon-battle-flee');
				fled = again.result?.escaped === true || again.result?.outcome === 'fainted' || !ok(again);
			}
		}
	}
	const noCrystals = await run('app-thingmon-battle-catch', { itemId: 'prism-crystal' });
	check('battle-catch without a battle (or without that crystal) is refused', !ok(noCrystals), noCrystals);
	const team = await run('app-thingmon-team');
	check('team lists the party with move lines and evolve readiness', ok(team) && team.result?.hasKeeper === true && team.result?.party?.length >= 1 && typeof team.result.party[0].movesLine === 'string' && typeof team.result.party[0].canEvolve === 'boolean', team.result?.party?.[0]);
	const leadId = team.result?.party?.[0]?.id;
	const rename = await run('app-thingmon-rename', { id: leadId, nickname: ' Bubbles ' });
	check('rename trims and sets the nickname', ok(rename) && /Bubbles/.test(rename.result?.message || ''), rename);
	const renamed = await run('app-thingmon-team');
	check('rename readback: name is Bubbles', renamed.result?.party?.[0]?.name === 'Bubbles' && renamed.result.party[0].nickname === 'Bubbles', renamed.result?.party?.[0]);
	const clearNick = await run('app-thingmon-rename', { id: leadId, nickname: '' });
	check('explicit empty nickname clears it', ok(clearNick) && /cleared/.test(clearNick.result?.message || ''), clearNick);
	const daily = await run('app-thingmon-daily');
	check('daily bonus pays 30 shards on a streak of 1', ok(daily) && /\+30 shards/.test(daily.result?.message || ''), daily);
	const dailyAgain = await run('app-thingmon-daily');
	check('daily bonus refuses a second claim today', !ok(dailyAgain) && /Already claimed/.test(dailyAgain.error || ''), dailyAgain);
	const shardsBefore = (await run('app-thingmon-state')).result?.keeper?.shards;
	const buy = await run('app-thingmon-buy', { itemId: 'tonic', qty: 2 });
	check('buy 2 tonics costs 30 shards', ok(buy) && buy.result?.shards === shardsBefore - 30, { before: shardsBefore, after: buy.result?.shards, buy });
	const tooRich = await run('app-thingmon-buy', { itemId: 'prism-crystal', qty: 10 });
	check('buy refuses what you cannot afford', !ok(tooRich) && /costs/.test(tooRich.error || ''), tooRich);
	const tonic = await run('app-thingmon-use-item', { id: leadId, itemId: 'tonic' });
	check('use-item answers (consumed only when HP is missing)', ok(tonic) && typeof tonic.result?.consumed === 'boolean', tonic);
	const dex1 = await run('app-thingmon-dex', { page: 1 });
	check('dex page 1: 30 species, starter caught, pages=2', ok(dex1) && dex1.result?.items?.length === 30 && dex1.result?.pages === 2 && dex1.result.items[3]?.caught === true && dex1.result.items[3]?.seen === true && dex1.result?.caughtCount >= 1, { count: dex1.result?.items?.length, pages: dex1.result?.pages, puddlin: dex1.result?.items?.[3] });
	const dex2 = await run('app-thingmon-dex', { page: 2 });
	check('dex page 2: the last 30 with legendaries unseen', ok(dex2) && dex2.result?.items?.length === 30 && dex2.result.items[29]?.name === 'Terravine' && dex2.result.items[29]?.seen === false, dex2.result?.items?.[29]);
	const species = await run('app-thingmon-species', { id: 5 });
	check('species: pack record merged with the seeded system data thing', ok(species) && species.result?.species?.name === 'Rippleo' && species.result?.evolvesFrom?.name === 'Puddlin' && species.result?.evolvesTo?.name === 'Tidalisk' && typeof species.result?.species?.baseStats?.hpPct === 'number', { name: species.result?.species?.name, fromSystem: species.result?.fromSystemData, from: species.result?.evolvesFrom?.name, to: species.result?.evolvesTo?.name });
	check('species: the seeded public species data thing was found in system scope', species.result?.fromSystemData === true, 'seed-demos must have run (TT_VERIFY_ADMIN_USER/PASS)');
	const partyNow = (await run('app-thingmon-team')).result?.party || [];
	if (partyNow.length >= 2) {
		const boxed = await run('app-thingmon-deposit', { id: partyNow[1].id });
		check('deposit sends a second party member to the box', ok(boxed) && /box/.test(boxed.result?.message || ''), boxed);
		const back = await run('app-thingmon-withdraw', { id: partyNow[1].id });
		check('withdraw brings it back to the party', ok(back) && /Joined/.test(back.result?.message || ''), back);
		const lead = await run('app-thingmon-set-lead', { id: partyNow[1].id });
		check('set-lead swaps the party order', ok(lead) && (await run('app-thingmon-team')).result?.party?.[0]?.id === partyNow[1].id, lead);
	} else {
		const boxed = await run('app-thingmon-deposit', { id: leadId });
		check('deposit refuses to box the last party member', !ok(boxed) && /at least one/.test(boxed.error || ''), boxed);
	}
	const keeperName = await run('app-thingmon-keeper-name', { name: 'Keeper Ada' });
	check('keeper-name renames the keeper', ok(keeperName) && (await run('app-thingmon-state')).result?.keeper?.name === 'Keeper Ada', keeperName);
	await resolvePages(['thingmon', 'thingmon-team', 'thingmon-dex', 'thingmon-species', 'thingmon-shop', 'thingmon-keeper']);
	const reset = await run('app-thingmon-reset');
	check('reset deletes keeper, creatures and battles through each → discard', ok(reset) && reset.result?.removed >= 3, reset);
	const gone = await run('app-thingmon-state');
	check('state after reset: no keeper again', ok(gone) && gone.result?.hasKeeper === false, gone.result);
}

console.log(`\n${passed} passed · ${failed} failed`);
if (failures.length) {
	console.log(failures.map((label) => `  ✗ ${label}`).join('\n'));
	process.exit(1);
}
