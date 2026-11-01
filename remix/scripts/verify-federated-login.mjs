#!/usr/bin/env node
// Live verification of "Login with Thingtime anywhere" — federated hint
// resolution, the cross-origin session handoff, and the FedCM IdP endpoints —
// against TWO stacks on DIFFERENT databases, proving the per-environment
// authority model end to end. Real API only, no mocks (FUNDAMENTALS §2).
//
//   node scripts/verify-federated-login.mjs [baseA] [baseB]
//
// Stack A = this worktree's dev stack (default http://127.0.0.1:14132).
// Stack B = a PRODUCTION build of the same tree against a SECOND mongod.
// Two sharp edges make both halves of that sentence load-bearing:
//   • it must be a built server, not `npm run dev` — nitro's dev-mode dotenv
//     re-applies .env keys with override on config reloads, so a second dev
//     stack in the same checkout can never point at different storage;
//   • it must be a second mongod (not a second db name) — the home database
//     name is pinned to 'thingtime' (collections.ts), so a URI path like
//     /thingtime_fed_b is ignored. Transactions also require a replica set.
// Recipe:
//   npm run build:client && npm run sync:nitro-template && npx nitro build
//   mongod --port 27018 --replSet rsB --dbpath /tmp/mongo-fed-b \
//     --bind_ip 127.0.0.1 --logpath /tmp/mongo-fed-b.log --fork
//   mongosh --port 27018 --eval 'rs.initiate({_id:"rsB",members:[{_id:0,host:"127.0.0.1:27018"}]})'
//   set -a; source .env; set +a   # share JWT material etc. with stack A
//   PORT=24132 HOST=127.0.0.1 \
//   MONGODB_CONNECTION_STRING="mongodb://127.0.0.1:27018/thingtime?directConnection=true&replicaSet=rsB" \
//     node .output/server/index.mjs
// (default http://127.0.0.1:24132)

import { randomBytes } from 'node:crypto';

const BASE_A = process.argv[2] || process.env.TT_VERIFY_BASE_A || 'http://127.0.0.1:14132';
const BASE_B = process.argv[3] || process.env.TT_VERIFY_BASE_B || 'http://127.0.0.1:24132';
const ORIGIN_A = new URL(BASE_A).origin;
const ORIGIN_B = new URL(BASE_B).origin;
// A pretend public alias for handoff-redemption tests (aud binding is checked
// against the receiving deployment's x-forwarded-aware public origin).
const TARGET = 'https://pr-777.previews.dev.thingtime.com';
const TARGET_HOST = new URL(TARGET).host;

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

const newJar = () => ({ cookies: new Map() });
const storeCookies = (jar, res) => {
	for (const setCookie of res.headers.getSetCookie()) {
		const [pair] = setCookie.split(';');
		const eq = pair.indexOf('=');
		if (/max-age=0/i.test(setCookie)) jar.cookies.delete(pair.slice(0, eq).trim());
		else jar.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
	}
};
const cookieHeader = (jar) => [...jar.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');

const api = async (base, jar, method, path, body, headers = {}) => {
	const res = await fetch(`${base}${path}`, {
		method,
		headers: {
			...(body !== undefined && typeof body === 'string'
				? { 'Content-Type': 'application/x-www-form-urlencoded' }
				: body !== undefined
					? { 'Content-Type': 'application/json' }
					: {}),
			...(jar && jar.cookies.size ? { Cookie: cookieHeader(jar) } : {}),
			...headers
		},
		body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
	});
	if (jar) storeCookies(jar, res);
	let json = null;
	try {
		json = await res.json();
	} catch {
		// non-JSON — callers assert on status
	}
	return { status: res.status, json, res };
};

const suffix = `${Date.now().toString(36)}${randomBytes(5).toString('hex')}`;
const username = `fed-${suffix}`;
const password = `Fed-${suffix}-9!`;

const main = async () => {
	console.log(`verify-federated-login\n  A = ${BASE_A} (this environment)\n  B = ${BASE_B} (different database)\n`);

	for (const [name, base] of [
		['A', BASE_A],
		['B', BASE_B]
	]) {
		const ping = await api(base, null, 'GET', '/api/v1/auth/account-hints-docs').catch(() => null);
		if (!ping || ping.status !== 200) {
			console.error(`stack ${name} (${base}) is not reachable — start it first (see the header comment).`);
			process.exit(1);
		}
	}

	// ── a user + session live only in B's environment ──
	console.log('cross-environment hints (per-environment authority)');
	const owner = newJar();
	const reg = await api(BASE_B, owner, 'POST', '/api/v1/auth/register', {
		username,
		password,
		email: `${username}@example.com`
	});
	check('register on B', reg.status === 200 && reg.json?.ok === true, `status ${reg.status} ${JSON.stringify(reg.json)}`);
	check('B wrote a tt_hints pointer', owner.cookies.has('tt_hints'));

	// A cannot resolve B's pointer (different database) — it must KEEP it and
	// report B's origin as unresolved for the client to federate.
	const hintsOnA = await api(BASE_A, newJarWith('tt_hints', owner.cookies.get('tt_hints')), 'GET', '/api/v1/auth/account-hints');
	check('A resolves nothing locally', hintsOnA.json?.ok === true && hintsOnA.json.hints?.length === 0);
	check(
		'A reports B as unresolved (federation handle)',
		Array.isArray(hintsOnA.json?.unresolved) && hintsOnA.json.unresolved.includes(ORIGIN_B),
		JSON.stringify(hintsOnA.json?.unresolved)
	);
	check('A did not prune B’s pointer', !hintsOnA.res.headers.getSetCookie().some((c) => c.startsWith('tt_hints=')));

	// The federated resolve: B vouches for its own pointer, cross-origin.
	const resolveOnB = await api(
		BASE_B,
		newJarWith('tt_hints', owner.cookies.get('tt_hints')),
		'GET',
		'/api/v1/auth/account-hints/resolve',
		undefined,
		{ Origin: ORIGIN_A }
	);
	check(
		'B vouches for its own session',
		resolveOnB.json?.ok === true && resolveOnB.json.hints?.some((h) => h.user?.username === username),
		JSON.stringify(resolveOnB.json)
	);
	check(
		'CORS allows the Thingtime-family caller',
		resolveOnB.res.headers.get('access-control-allow-origin') === ORIGIN_A &&
			resolveOnB.res.headers.get('access-control-allow-credentials') === 'true'
	);
	check('resolve is read-only (no Set-Cookie)', resolveOnB.res.headers.getSetCookie().length === 0);

	const evilResolve = await api(BASE_B, newJarWith('tt_hints', owner.cookies.get('tt_hints')), 'GET', '/api/v1/auth/account-hints/resolve', undefined, {
		Origin: 'https://evil.example'
	});
	check('CORS denies non-family origins', !evilResolve.res.headers.get('access-control-allow-origin'));

	// ── session handoff ──
	console.log('\ncross-origin session handoff');
	const anonMint = await api(BASE_B, newJar(), 'POST', '/api/v1/auth/sso-handoff', { origin: TARGET });
	check('handoff requires a session', anonMint.status === 401);

	const badOrigin = await api(BASE_B, owner, 'POST', '/api/v1/auth/sso-handoff', { origin: 'not-an-origin' });
	check('handoff rejects malformed origins', badOrigin.status === 400);

	const mint = await api(BASE_B, owner, 'POST', '/api/v1/auth/sso-handoff', { origin: TARGET });
	check('handoff mints a code', mint.json?.ok === true && typeof mint.json.code === 'string', JSON.stringify(mint.json));

	// Cross-environment redemption fails closed: A's database has no such
	// session, even though the aud matches.
	const crossEnv = await api(BASE_A, newJar(), 'POST', '/api/v1/auth/sso-session', { code: mint.json.code }, {
		'x-forwarded-host': TARGET_HOST,
		'x-forwarded-proto': 'https'
	});
	check('different environment fails closed', crossEnv.status === 401, `status ${crossEnv.status}`);

	// Wrong aud: right environment, wrong receiving origin.
	const mint2 = await api(BASE_B, owner, 'POST', '/api/v1/auth/sso-handoff', { origin: TARGET });
	const wrongAud = await api(BASE_B, newJar(), 'POST', '/api/v1/auth/sso-session', { code: mint2.json.code }, {
		'x-forwarded-host': 'other.previews.dev.thingtime.com',
		'x-forwarded-proto': 'https'
	});
	check('aud binding enforced', wrongAud.status === 403, `status ${wrongAud.status}`);

	// The real thing: right environment, right origin.
	const visitor = newJar();
	const mint3 = await api(BASE_B, owner, 'POST', '/api/v1/auth/sso-handoff', { origin: TARGET });
	const redeemed = await api(BASE_B, visitor, 'POST', '/api/v1/auth/sso-session', { code: mint3.json.code }, {
		'x-forwarded-host': TARGET_HOST,
		'x-forwarded-proto': 'https'
	});
	check('redeem succeeds on the bound origin', redeemed.json?.ok === true && redeemed.json.user?.username === username, JSON.stringify(redeemed.json));
	check('redeem sets a session cookie', visitor.cookies.has('tt_auth'));
	check('redeem merges the switcher roster', visitor.cookies.has('tt_accounts'));

	const me = await api(BASE_B, visitor, 'GET', '/api/v1/auth/me');
	check('handoff session works', me.json?.user?.username === username, JSON.stringify(me.json));

	// Replay: second redemption is refused AND revokes the session (theft
	// signal — if a code leaked, everything minted from it dies).
	const replay = await api(BASE_B, newJar(), 'POST', '/api/v1/auth/sso-session', { code: mint3.json.code }, {
		'x-forwarded-host': TARGET_HOST,
		'x-forwarded-proto': 'https'
	});
	check('replay refused', replay.status === 401);
	const afterReplay = await api(BASE_B, visitor, 'GET', '/api/v1/auth/me');
	check('replay revokes the stolen session (theft response)', !afterReplay.json?.user, JSON.stringify(afterReplay.json));

	// ── FedCM endpoints ──
	console.log('\nFedCM identity provider');
	const wellKnown = await api(BASE_B, null, 'GET', '/.well-known/web-identity');
	check(
		'well-known discovery',
		Array.isArray(wellKnown.json?.provider_urls) && wellKnown.json.provider_urls[0] === `${ORIGIN_B}/api/v1/fedcm/config`,
		JSON.stringify(wellKnown.json)
	);

	const config = await api(BASE_B, null, 'GET', '/api/v1/fedcm/config');
	check(
		'config manifest endpoints are absolute',
		config.json?.accounts_endpoint === `${ORIGIN_B}/api/v1/fedcm/accounts` &&
			config.json?.id_assertion_endpoint === `${ORIGIN_B}/api/v1/fedcm/assertion`,
		JSON.stringify(config.json)
	);

	const accountsNoSFD = await api(BASE_B, owner, 'GET', '/api/v1/fedcm/accounts');
	check('accounts refuses non-FedCM fetches', accountsNoSFD.status === 400);

	const accountsAnon = await api(BASE_B, newJar(), 'GET', '/api/v1/fedcm/accounts', undefined, { 'Sec-Fetch-Dest': 'webidentity' });
	check('accounts 401s when signed out', accountsAnon.status === 401);

	const accounts = await api(BASE_B, owner, 'GET', '/api/v1/fedcm/accounts', undefined, { 'Sec-Fetch-Dest': 'webidentity' });
	const fedcmAccount = accounts.json?.accounts?.find((entry) => entry.id);
	check(
		'accounts lists the roster account',
		accounts.status === 200 && fedcmAccount && accounts.json.accounts.length === 1,
		JSON.stringify(accounts.json)
	);

	const assertion = await api(
		BASE_B,
		owner,
		'POST',
		'/api/v1/fedcm/assertion',
		`client_id=thingtime-self&account_id=${encodeURIComponent(fedcmAccount?.id || '')}&nonce=${randomBytes(8).toString('hex')}`,
		{ 'Sec-Fetch-Dest': 'webidentity', Origin: TARGET }
	);
	check('assertion mints a handoff token', assertion.status === 200 && typeof assertion.json?.token === 'string', JSON.stringify(assertion.json));

	const foreignAccount = await api(BASE_B, owner, 'POST', '/api/v1/fedcm/assertion', `client_id=thingtime-self&account_id=not-in-roster`, {
		'Sec-Fetch-Dest': 'webidentity',
		Origin: TARGET
	});
	check('assertion refuses non-roster accounts', foreignAccount.status === 401);

	// Full FedCM → session loop: redeem the assertion token like the RP would.
	const fedcmVisitor = newJar();
	const fedcmRedeem = await api(BASE_B, fedcmVisitor, 'POST', '/api/v1/auth/sso-session', { code: assertion.json?.token }, {
		'x-forwarded-host': TARGET_HOST,
		'x-forwarded-proto': 'https'
	});
	check('FedCM token redeems into a session', fedcmRedeem.json?.ok === true && fedcmRedeem.json.user?.username === username);
	const fedcmMe = await api(BASE_B, fedcmVisitor, 'GET', '/api/v1/auth/me');
	check('FedCM session works end to end', fedcmMe.json?.user?.username === username);

	// ── docs registration ──
	console.log('\ndocs');
	const docs = await api(BASE_A, null, 'GET', '/api/v1/auth/sso-session-docs');
	check('sso-session docs live', docs.json?.ok === true && docs.json.docs?.endpoint === '/api/v1/auth/sso-session');
	const fedcmDocs = await api(BASE_A, null, 'GET', '/api/v1/fedcm/assertion-docs');
	check('fedcm docs live', fedcmDocs.json?.ok === true);

	console.log(`\n${passed} passed, ${failures.length} failed`);
	if (failures.length) {
		console.log(`failures:\n  - ${failures.join('\n  - ')}`);
		process.exit(1);
	}
};

function newJarWith(name, value) {
	const jar = newJar();
	if (value) jar.cookies.set(name, value);
	return jar;
}

main().catch((err) => {
	console.error('verify-federated-login crashed:', err);
	process.exit(1);
});
