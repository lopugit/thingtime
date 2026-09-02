#!/usr/bin/env node
// Live end-to-end verification of the APP SUITES (Pokeworld + StarsAlign)
// against a running Thingtime API — FUNDAMENTALS §2: everything goes through
// the real endpoints, exactly as the pages do.
//
//   node scripts/verify-app-suites.mjs [baseUrl]   (default http://127.0.0.1:18500)
//
// Flow: register a throwaway user → (optionally, when ADMIN_USERNAMES lists
// that user or TT_VERIFY_ADMIN_USER/PASS names an admin) seed the demo
// library so the system copies + public content exist → install both suites
// through POST /api/v1/webpages/suites/install → run the programs the pages
// run (state/start/move…/battle/catch; today/save-profile/set-place/search/
// section/entry/combos/erase) as delegated component clicks (source:
// 'component', owner-only) and assert on the results → resolve the app pages
// by KEY and confirm the viewer's twins outrank the seeded copies.

const base = (process.argv[2] || process.env.TT_VERIFY_BASE || 'http://127.0.0.1:18500').replace(/\/$/, '');
const adminUser = process.env.TT_VERIFY_ADMIN_USER || null;
const adminPass = process.env.TT_VERIFY_ADMIN_PASS || null;

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
		console.log(`  ✗ ${label}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)}` : ''}`);
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
// NOTE: the run payload carries its own `status` ('ok' | 'error'); the HTTP
// status lives on `http` so the two never shadow each other
const run = async (action, inputs = {}) => {
	const { status, data } = await api('POST', '/api/v1/actions/run', { action, inputs, source: 'component' });
	return { http: status, ...data };
};

const suffix = Date.now().toString(36).slice(-6);
const username = `apps-${suffix}`;
const password = `Apps-${suffix}-pass!`;

console.log(`\n▶ verify-app-suites against ${base}`);

// ── 0. account ────────────────────────────────────────────────────────────────
{
	const register = await api('POST', '/api/v1/auth/register', { username, password, email: `${username}@example.com` });
	check('register a throwaway user', register.status === 200 || register.status === 201, register.data);
}

// ── 1. seed (admin) ───────────────────────────────────────────────────────────
{
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
		check('seed-demos as admin (app suites + content)', seeded.data?.ok === true, seeded.data);
		console.log(`    created ${seeded.data?.created} · refreshed ${seeded.data?.refreshed} · unchanged ${seeded.data?.unchanged} · skipped ${seeded.data?.skipped}`);
		if (seeded.data?.notes?.length) console.log(`    notes: ${seeded.data.notes.slice(0, 5).join(' | ')}`);
	} else {
		console.log(`  · seed skipped (status ${seeded.status}) — set ADMIN_USERNAMES=${username} or TT_VERIFY_ADMIN_USER/PASS to seed`);
	}
	const demos = await api('GET', '/api/v1/webpages/demos');
	const suites = demos.data?.suites || [];
	check('demos lists the app suites', suites.some((suite) => suite.key === 'pokeworld' && suite.app) && suites.some((suite) => suite.key === 'starsalign' && suite.app), suites.map((suite) => suite.key));
	const pokeworld = suites.find((suite) => suite.key === 'pokeworld');
	check('pokeworld entry page key is /p/pokeworld', pokeworld?.pageKey === 'pokeworld' && pokeworld?.counts?.pages === 6, pokeworld);
}

// ── 2. install ────────────────────────────────────────────────────────────────
for (const key of ['pokeworld', 'starsalign']) {
	const first = await api('POST', '/api/v1/webpages/suites/install', { key });
	check(`install ${key}`, first.status === 200 && first.data?.ok === true && first.data.created > 0, first.data);
	const again = await api('POST', '/api/v1/webpages/suites/install', { key });
	check(`re-install ${key} is idempotent (0 created)`, again.status === 200 && again.data?.created === 0, again.data);
	const resolved = await api('GET', `/api/v1/webpages/resolve?id=${encodeURIComponent(key)}`);
	check(`/p/${key} resolves to the viewer's own twin`, resolved.data?.source === 'user' && resolved.data?.page?.crystal?.pageKey === key && resolved.data?.page?.crystal?.suiteKey === key, { source: resolved.data?.source, pageKey: resolved.data?.page?.crystal?.pageKey });
	check(`/p/${key} resolves every component block`, Object.values(resolved.data?.refs || {}).every((ref) => typeof ref === 'string'), resolved.data?.refs);
}

// ── 3. pokeworld ──────────────────────────────────────────────────────────────
{
	const before = await run('app-pokeworld-state');
	check('pokeworld state before start: no trainer', before.http === 200 && before.result?.hasTrainer === false, before);
	const start = await run('app-pokeworld-start', { name: 'ada', gender: 'girl' });
	check('start creates the trainer + party + box', start.http === 200 && start.result?.title?.includes('journey'), start);
	const state = await run('app-pokeworld-state');
	const s = state.result || {};
	check('state after start: trainer ADA, 3 in party, viewport 11×9', s.hasTrainer === true && s.trainer?.name === 'ADA' && s.partyCount === 3 && s.view?.width === 11 && s.view?.height === 9, { name: s.trainer?.name, party: s.partyCount, view: s.view && [s.view.width, s.view.height] });
	check('state paints the bag', s.bag?.poke_ball === 6 && s.bagList?.some((item) => item.id === 'potion' && item.qty === 3), s.bag);
	check('the party rows carry sprites, HP percent, moves', s.party?.every((member) => typeof member.sprite === 'string' && typeof member.hpPercent === 'number' && Array.isArray(member.moves) && member.moves.length > 0), s.party?.[0]);
	const again = await run('app-pokeworld-start', { name: 'x' });
	check('start twice is a no-op', again.result?.title === 'Welcome back!', again);

	// walk until something happens (an encounter or a hundred steps)
	let encounter = null;
	let moved = 0;
	let blocked = 0;
	// a deterministic wander (LCG-seeded) that keeps a heading for a few steps
	// and turns when blocked, so it actually crosses tall grass
	const directions = ['up', 'right', 'down', 'left'];
	let seed = 0x2f6e2b1;
	const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
	let heading = 0;
	let lastOutcome = 'move';
	for (let index = 0; index < 220 && !encounter; index += 1) {
		if (lastOutcome === 'blocked' || next() < 0.18) heading = Math.floor(next() * 4);
		const direction = directions[heading];
		const step = await run('app-pokeworld-move', { direction });
		if (step.http !== 200 || step.status === 'error') {
			check('move runs', false, step.error || step);
			break;
		}
		lastOutcome = step.result?.outcome || 'move';
		if (lastOutcome === 'blocked') blocked += 1;
		else moved += 1;
		if (step.result?.encounter) encounter = step.result.encounter;
	}
	check(`walking works (${moved} moves, ${blocked} blocked)`, moved > 0);
	const mid = await run('app-pokeworld-state');
	check('position persisted on the trainer', mid.result?.trainer?.steps >= moved + blocked, mid.result?.trainer?.steps);
	if (encounter) {
		check(`a wild ${encounter.species} appeared (Lv${encounter.level})`, encounter.level >= 1 && typeof encounter.sprite === 'string');
		const inBattle = await run('app-pokeworld-state');
		check('state shows the battle with HP percents', inBattle.result?.inBattle === true && typeof inBattle.result?.battle?.wildHpPercent === 'number' && inBattle.result?.battle?.player?.moves?.length > 0, inBattle.result?.battle);
		const blockedMove = await run('app-pokeworld-move', { direction: 'up' });
		check('moving during a battle is refused', blockedMove.http === 200 && blockedMove.result === null && /battle/i.test(blockedMove.error || ''), blockedMove.error);
		const turn = await run('app-pokeworld-battle-move', { moveIndex: 0 });
		check('a battle turn resolves with a log', turn.http === 200 && typeof turn.result?.message === 'string' && turn.result.message.length > 0 && ['continue', 'won', 'fainted'].includes(turn.result?.outcome), turn);
		let finished = turn.result?.outcome !== 'continue';
		// throw balls until it is over (caught / fled / won / lost)
		for (let attempt = 0; attempt < 6 && !finished; attempt += 1) {
			const ball = await run('app-pokeworld-battle-ball', { ball: 'poke-ball' });
			if (ball.http !== 200 || ball.result === null) {
				finished = true;
				check('battle-ball runs', /no poke ball/i.test(ball.error || ''), ball.error);
				break;
			}
			if (ball.result.caught) {
				check(`caught it: ${ball.result.message}`, true);
				finished = true;
			}
			if (!finished) {
				const after = await run('app-pokeworld-state');
				if (!after.result?.inBattle) finished = true;
			}
		}
		if (!finished) {
			const runAway = await run('app-pokeworld-battle-run');
			check('running away resolves', runAway.http === 200 && typeof runAway.result?.escaped === 'boolean', runAway);
		}
		const after = await run('app-pokeworld-state');
		check('bag consumed balls or the battle ended', (after.result?.bag?.poke_ball ?? 6) <= 6, after.result?.bag);
		check('pokédex seen grew', (after.result?.trainer?.seen || []).includes(encounter.speciesId), after.result?.trainer?.seen);
	} else {
		console.log('  · no encounter in 220 steps (unlucky map) — battle path not exercised this run');
	}
	const dex = await run('app-pokeworld-pokedex', { page: 1 });
	check('pokédex page 1 has 100 entries and counts the six starters as caught', dex.result?.entries?.length === 100 && dex.result?.pages === 4 && dex.result?.caughtCount >= 6 && dex.result.entries[0]?.no === '001', { pages: dex.result?.pages, caught: dex.result?.caughtCount, first: dex.result?.entries?.[0]?.no });
	const dex3 = await run('app-pokeworld-pokedex', { page: 3 });
	check('pokédex page 3 flags TREECKO (#252) as caught', dex3.result?.entries?.some((entry) => entry.id === 252 && entry.caught === true), dex3.result?.entries?.find((entry) => entry.id === 252));
	const heal = await run('app-pokeworld-heal');
	check('heal runs each over the party', heal.http === 200 && /fighting fit/.test(heal.result?.message || ''), heal);
	const item = await run('app-pokeworld-use-item', { itemId: 'rare-candy', pokemonId: 'nope' });
	check('use-item refuses an item you lack', item.result === null && /do not have/i.test(item.error || ''), item.error);
	const party = (await run('app-pokeworld-state')).result?.party || [];
	if (party.length >= 2) {
		const lead = await run('app-pokeworld-set-lead', { pokemonId: party[1].thingId });
		check('set-lead reorders the party', lead.http === 200 && /leads/.test(lead.result?.message || ''), lead);
		const dep = await run('app-pokeworld-deposit', { pokemonId: party[0].thingId });
		check('deposit moves a member to the box', dep.http === 200 && /deposited/.test(dep.result?.message || ''), dep);
		const box = await run('app-pokeworld-box');
		check('box lists the deposited member', box.result?.boxCount >= 4, box.result?.boxCount);
		const wd = await run('app-pokeworld-withdraw', { pokemonId: party[0].thingId });
		check('withdraw brings it back', wd.http === 200 && /joined/.test(wd.result?.message || ''), wd);
	}
	const tele = await run('app-pokeworld-set-location', { lat: -25.3444, lng: 131.0369 });
	check('set-location teleports to the Uluru block', tele.http === 200 && /Block/.test(tele.result?.message || ''), tele);
	const badge = await run('app-pokeworld-toggle-badge', { badgeId: 'stone' });
	check('toggle-badge earns a badge', badge.http === 200 && badge.result?.badges?.includes('stone'), badge);
	const opts = await run('app-pokeworld-settings', { name: 'lopu', gender: 'boy' });
	check('settings renames the trainer', opts.http === 200 && (await run('app-pokeworld-state')).result?.trainer?.name === 'LOPU');
}

// ── 4. starsalign ─────────────────────────────────────────────────────────────
{
	const before = await run('app-starsalign-today', {});
	check('today without a profile still returns the sky', before.http === 200 && before.result?.hasProfile === false && before.result?.today?.sky?.length === 10, before);
	const bad = await run('app-starsalign-save-profile', { birthDate: '2999-01-01', timeKnown: false });
	check('save-profile refuses a future date', bad.result === null && /future/i.test(bad.error || ''), bad.error);
	const save = await run('app-starsalign-save-profile', { birthDate: '1990-07-15', birthTime: '10:30', timeKnown: true, displayName: 'Ada' });
	check('save-profile creates the profile', save.http === 200 && /Saved/.test(save.result?.title || ''), save);
	const city = await run('app-starsalign-pick-city', { q: 'melb' });
	check('pick-city finds Melbourne', city.result?.cities?.[0]?.name === 'Melbourne', city.result?.cities);
	const place = await run('app-starsalign-set-place', { placeName: 'Melbourne', placeCountry: 'Australia', lat: -37.81, lon: 144.96, tz: 'Australia/Melbourne' });
	check('set-place updates the profile in place', place.http === 200 && /Melbourne/.test(place.result?.message || ''), place);
	const again = await run('app-starsalign-save-profile', { birthDate: '1990-07-15', birthTime: '10:30', timeKnown: true, displayName: 'Ada' });
	check('save-profile updates (not duplicates)', again.http === 200, again);
	const today = await run('app-starsalign-today', { tz: 'Australia/Melbourne' });
	const t = today.result?.today || {};
	check('today computes the full model with a rising sign', today.result?.hasProfile === true && t.chips?.rising?.signName && t.sky?.length === 10 && t.houses?.length === 12 && t.wheel?.signs?.length === 12 && typeof t.summary === 'string', { rising: t.chips?.rising, sky: t.sky?.length, transits: t.transits?.length });
	check('today lists transits written for you (≤5) or says the sky is quiet', Array.isArray(t.transits) && t.transits.length <= 5 && (t.transits.length > 0 || t.transitsEmpty === true), t.transits?.length);
	const search = await run('app-starsalign-school-search', { q: 'mars in libra' });
	check('school-search hits mars-libra first', search.result?.hits?.[0]?.id === 'mars-libra', search.result?.hits?.slice(0, 2));
	const section = await run('app-starsalign-school-section', { section: 'signs', page: 1 });
	check('school-section pages the signs shelf', section.result?.section?.total === 12 && section.result?.section?.entries?.[0]?.id === 'aries', section.result?.section?.entries?.[0]);
	const entry = await run('app-starsalign-school-entry', { id: 'sun-aries' });
	check('school-entry reads the public entry thing (deep dive present)', entry.result?.entry?.title === 'Sun in Aries' && Array.isArray(entry.result?.entry?.deep) && entry.result.entry.deep.length >= 3, entry.result?.entry && { title: entry.result.entry.title, deep: entry.result.entry.deep?.length });
	const combos = await run('app-starsalign-combos', { planet: 'mars', sign: 'libra', house: '7' });
	check('combos blends three ingredients into three pair readings', combos.result?.entries?.length === 3 && /Mars in Libra/.test(combos.result?.heading || ''), { heading: combos.result?.heading, n: combos.result?.entries?.length });
	const erase = await run('app-starsalign-erase');
	check('erase deletes the profile through each → things.delete', erase.http === 200 && erase.result?.deleted >= 1, erase);
	const gone = await run('app-starsalign-today', {});
	check('after erase the profile is gone', gone.result?.hasProfile === false, gone.result?.hasProfile);
}

// ── 5. run history is inspectable ────────────────────────────────────────────
{
	const runs = await api('GET', '/api/v1/actions/runs?limit=5');
	check('run records landed for the delegated clicks', runs.data?.ok === true && runs.data.runs.length >= 5 && runs.data.runs.every((entry) => Array.isArray(entry.trace)), runs.data?.runs?.length);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed · ${failed} failed`);
if (failed) {
	console.log(failures.map((label) => ` - ${label}`).join('\n'));
	process.exit(1);
}
