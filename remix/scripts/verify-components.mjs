#!/usr/bin/env node
// Live verification of the Components family — real API only (FUNDAMENTALS §2).
//   node scripts/verify-components.mjs [baseUrl]
// Covers: browse (+lib/category filters, q search, docs twin), the admin seed
// gate (401 anon / 403 non-admin), user component creation via the unified
// things path (render required, reserved shareId refused), save-version
// semantics (mine=1, componentKey usage counts), and react/save decoration.
import { randomBytes } from 'node:crypto';

const BASE = process.argv[2] || process.env.TT_VERIFY_BASE || 'http://127.0.0.1:16802';
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

const SAMPLE_RENDER = {
	tag: 'button',
	props: { type: 'button', style: { padding: '0 16px', height: '36px', borderRadius: '9px', background: '#16161a', color: '#ffffff' } },
	children: ['{label}']
};
const SAMPLE_ARGS = [{ name: 'label', type: 'string', label: 'Label', default: 'Click me', maxLength: 40 }];

const run = async () => {
	console.log(`Components verification against ${BASE}\n`);

	// ---- public browse ------------------------------------------------------
	const browse = await api('/api/v1/components/browse?limit=5');
	check('browse returns ok', browse.status === 200 && browse.body?.ok === true);
	check('browse entries carry a render template', (browse.body?.components || []).every((entry) => entry.crystal?.render));
	check('browse reports a total on the first page', typeof browse.body?.total === 'number');

	const libFiltered = await api('/api/v1/components/browse?lib=reactflow&limit=5');
	check(
		'lib filter returns only that library',
		libFiltered.status === 200 && (libFiltered.body?.components || []).length > 0 &&
			(libFiltered.body?.components || []).every((entry) => entry.crystal?.library === 'reactflow')
	);

	const categoryFiltered = await api('/api/v1/components/browse?category=buttons&limit=5');
	check(
		'category filter returns only that category',
		categoryFiltered.status === 200 &&
			(categoryFiltered.body?.components || []).every((entry) => entry.crystal?.category === 'buttons')
	);

	const searched = await api('/api/v1/components/browse?q=button&limit=5');
	check('q search returns ok', searched.status === 200 && searched.body?.ok === true);

	const docs = await api('/api/v1/components/browse-docs');
	check('browse docs twin serves', docs.status === 200 && docs.body?.docs?.endpoint === '/api/v1/components/browse');

	// ---- family grouping ----------------------------------------------------
	const grouped = await api('/api/v1/components/browse?group=family&limit=5');
	check('group=family returns ok', grouped.status === 200 && grouped.body?.ok === true);
	const groupedEntries = grouped.body?.components || [];
	check(
		'grouped entries carry a designs roster',
		groupedEntries.length > 0 && groupedEntries.every((entry) => !entry.designs || entry.designs.length > 1)
	);
	check(
		'grouped familyKeys are unique per page',
		new Set(groupedEntries.map((entry) => entry.crystal?.familyKey || entry.id)).size === groupedEntries.length
	);
	const familyKey = groupedEntries.find((entry) => entry.designs?.length)?.crystal?.familyKey;
	if (familyKey) {
		const familyResp = await api(`/api/v1/components/browse?family=${encodeURIComponent(familyKey)}`);
		const designs = familyResp.body?.components || [];
		check('family= fetch returns every design', familyResp.status === 200 && designs.length > 1);
		check(
			'family designs share the familyKey',
			designs.every((entry) => entry.crystal?.familyKey === familyKey)
		);
		check(
			'family designs lead with the house style',
			designs[0]?.crystal?.library === 'thingtime'
		);
		const byComponentKey = await api(`/api/v1/components/browse?family=${encodeURIComponent(designs[0].crystal.componentKey)}`);
		check(
			'family= also resolves a componentKey slug',
			byComponentKey.status === 200 && (byComponentKey.body?.components || []).length === designs.length
		);
	} else {
		check('a grouped family with designs exists', false, 'no multi-design family on page 1');
	}

	check('mine=1 without auth is 401', (await api('/api/v1/components/browse?mine=1')).status === 401);
	check('library=1 without auth is 401', (await api('/api/v1/components/browse?library=1')).status === 401);

	// ---- admin seed gate ----------------------------------------------------
	check('anonymous seed POST is 401', (await api('/api/v1/admin/components/seed', { method: 'POST', body: { components: [] } })).status === 401);

	const user = await register('compverify');
	check(
		'non-admin seed POST is 403',
		(await api('/api/v1/admin/components/seed', { cookie: user.cookie, method: 'POST', body: { components: [] } })).status === 403
	);
	check('non-admin seed census GET is 403', (await api('/api/v1/admin/components/seed', { cookie: user.cookie })).status === 403);

	// ---- user component creation (unified things path) ----------------------
	const noRender = await api('/api/v1/things', {
		cookie: user.cookie,
		method: 'POST',
		body: { thingtime: ['component'], crystal: { name: 'No render' } }
	});
	check('component without render is 400', noRender.status === 400, JSON.stringify(noRender.body).slice(0, 120));

	const reserved = await api('/api/v1/things', {
		cookie: user.cookie,
		method: 'POST',
		body: { thingtime: ['component'], shareId: 'component-squat-attempt', crystal: { name: 'Squat', render: SAMPLE_RENDER } }
	});
	check('reserved component- shareId is refused', reserved.status === 400, JSON.stringify(reserved.body).slice(0, 120));

	const created = await api('/api/v1/things', {
		cookie: user.cookie,
		method: 'POST',
		body: {
			thingtime: ['component'],
			acl: ['tt:user'],
			crystal: {
				name: 'My Button v2',
				library: 'thingtime',
				category: 'buttons',
				componentKey: 'thingtime-button-solid',
				version: 2,
				args: SAMPLE_ARGS,
				savedArgs: { label: 'Saved label' },
				render: SAMPLE_RENDER
			}
		}
	});
	const createdThing = created.body?.thing || created.body?.doc || created.body;
	const createdId = createdThing?.id || createdThing?.shareId;
	check('user saves a component version', created.status === 200 && created.body?.ok !== false && !!createdId, JSON.stringify(created.body).slice(0, 160));

	const mine = await api('/api/v1/components/browse?mine=1', { cookie: user.cookie });
	check(
		'mine=1 lists the saved version',
		mine.status === 200 && (mine.body?.components || []).some((entry) => entry.crystal?.name === 'My Button v2')
	);
	const mineEntry = (mine.body?.components || []).find((entry) => entry.crystal?.name === 'My Button v2');
	check('saved version keeps savedArgs snapshot', mineEntry?.crystal?.savedArgs?.label === 'Saved label');

	// the platform source sharing the componentKey now counts one saved version
	const sourceBrowse = await api('/api/v1/components/browse?q=Solid%20Button&limit=20', { cookie: user.cookie });
	const source = (sourceBrowse.body?.components || []).find((entry) => entry.id === 'component-thingtime-button-solid');
	check('componentKey kin counts as usage on the source', !!source && source.usageCount >= 1, `usageCount=${source?.usageCount}`);

	// ---- react + save decoration -------------------------------------------
	const reacted = await api('/api/v1/things/react', { cookie: user.cookie, method: 'POST', body: { id: 'component-thingtime-button-solid', emoji: '🔥' } });
	check('react on a seeded component works', reacted.status === 200 && reacted.body?.ok === true);
	const savedResp = await api('/api/v1/things/save', { cookie: user.cookie, method: 'POST', body: { id: 'component-thingtime-button-solid' } });
	check('library save on a seeded component works', savedResp.status === 200 && savedResp.body?.ok === true);
	const decorated = await api('/api/v1/components/browse?q=Solid%20Button&limit=20', { cookie: user.cookie });
	const decoratedEntry = (decorated.body?.components || []).find((entry) => entry.id === 'component-thingtime-button-solid');
	check('browse decorates viewer reactions', !!decoratedEntry && decoratedEntry.viewerReactions.includes('🔥'));
	check('browse decorates saved flag', !!decoratedEntry && decoratedEntry.saved === true);
	const libraryScope = await api('/api/v1/components/browse?library=1', { cookie: user.cookie });
	check(
		'library=1 lists the saved component',
		libraryScope.status === 200 && (libraryScope.body?.components || []).some((entry) => entry.id === 'component-thingtime-button-solid')
	);

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
