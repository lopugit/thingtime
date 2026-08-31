#!/usr/bin/env node
// Live verification of passkeys + cross-deployment account hints — real API
// only, no mocks, no direct DB access (FUNDAMENTALS §2). A software WebAuthn
// authenticator (P-256 + minimal CBOR, `none` attestation) plays the browser's
// part so the FULL ceremony — options → attestation → login assertion →
// revocation — runs against the live endpoints exactly as a platform
// authenticator would.
//
//   node scripts/verify-passkeys.mjs [baseUrl]
//
// baseUrl defaults to TT_VERIFY_BASE or http://127.0.0.1:14132 (this
// worktree's nitro port; see remix/scripts/worktree-ports.cjs).

import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';

const BASE = process.argv[2] || process.env.TT_VERIFY_BASE || 'http://127.0.0.1:14132';
const ORIGIN = new URL(BASE).origin;

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

// ── cookie jar ─────────────────────────────────────────────────────────────

const newJar = () => ({ cookies: new Map() });
const storeCookies = (jar, res) => {
	for (const setCookie of res.headers.getSetCookie()) {
		const [pair] = setCookie.split(';');
		const eq = pair.indexOf('=');
		const name = pair.slice(0, eq).trim();
		const value = pair.slice(eq + 1);
		if (/max-age=0/i.test(setCookie)) jar.cookies.delete(name);
		else jar.cookies.set(name, value);
	}
};
const cookieHeader = (jar) => [...jar.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');

const api = async (jar, method, path, body) => {
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers: {
			...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
			...(jar.cookies.size ? { Cookie: cookieHeader(jar) } : {})
		},
		body: body !== undefined ? JSON.stringify(body) : undefined
	});
	storeCookies(jar, res);
	let json = null;
	try {
		json = await res.json();
	} catch {
		// non-JSON response — callers assert on status
	}
	return { status: res.status, json, res };
};

// ── minimal CBOR (maps incl. negative-int keys, byte/text strings, ints) ───

const cborHead = (major, arg) => {
	if (arg < 24) return Buffer.from([(major << 5) | arg]);
	if (arg < 256) return Buffer.from([(major << 5) | 24, arg]);
	if (arg < 65536) {
		const buf = Buffer.alloc(3);
		buf[0] = (major << 5) | 25;
		buf.writeUInt16BE(arg, 1);
		return buf;
	}
	const buf = Buffer.alloc(5);
	buf[0] = (major << 5) | 26;
	buf.writeUInt32BE(arg, 1);
	return buf;
};

const cborEncodeItem = (value) => {
	if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
		const buf = Buffer.from(value);
		return [cborHead(2, buf.length), buf];
	}
	if (typeof value === 'string') {
		const buf = Buffer.from(value, 'utf8');
		return [cborHead(3, buf.length), buf];
	}
	if (typeof value === 'number' && Number.isInteger(value)) {
		return value >= 0 ? [cborHead(0, value)] : [cborHead(1, -value - 1)];
	}
	if (value instanceof Map) {
		const parts = [cborHead(5, value.size)];
		for (const [key, entry] of value) parts.push(...cborEncodeItem(key), ...cborEncodeItem(entry));
		return parts;
	}
	if (value && typeof value === 'object') {
		const keys = Object.keys(value);
		const parts = [cborHead(5, keys.length)];
		for (const key of keys) parts.push(...cborEncodeItem(key), ...cborEncodeItem(value[key]));
		return parts;
	}
	throw new Error(`unsupported CBOR value: ${typeof value}`);
};

const cborEncode = (value) => Buffer.concat(cborEncodeItem(value));

// ── software authenticator ─────────────────────────────────────────────────

const b64url = (buf) => Buffer.from(buf).toString('base64url');

const makeAuthenticator = () => {
	const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
	const jwk = publicKey.export({ format: 'jwk' });
	const credentialId = randomBytes(32);
	return {
		credentialId,
		id: b64url(credentialId),
		coseKey: cborEncode(
			new Map([
				[1, 2], // kty: EC2
				[3, -7], // alg: ES256
				[-1, 1], // crv: P-256
				[-2, Buffer.from(jwk.x, 'base64url')],
				[-3, Buffer.from(jwk.y, 'base64url')]
			])
		),
		sign: (data) => createSign('SHA256').update(data).sign(privateKey) // DER, as WebAuthn ships ES256 sigs
	};
};

const clientDataFor = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin: ORIGIN, crossOrigin: false }));

// authData flags: UP (0x01) | UV (0x04) | AT (0x40)
const registrationResponseFor = (authenticator, options) => {
	const rpIdHash = createHash('sha256').update(options.rp.id).digest();
	const credIdLen = Buffer.alloc(2);
	credIdLen.writeUInt16BE(authenticator.credentialId.length);
	const authData = Buffer.concat([
		rpIdHash,
		Buffer.from([0x45]),
		Buffer.alloc(4), // counter 0 (synced-passkey style)
		Buffer.alloc(16), // zero AAGUID, like `none` attestation from most platforms
		credIdLen,
		authenticator.credentialId,
		authenticator.coseKey
	]);
	const clientDataJSON = clientDataFor('webauthn.create', options.challenge);
	return {
		id: authenticator.id,
		rawId: authenticator.id,
		type: 'public-key',
		clientExtensionResults: {},
		authenticatorAttachment: 'platform',
		response: {
			clientDataJSON: b64url(clientDataJSON),
			attestationObject: b64url(cborEncode({ fmt: 'none', attStmt: {}, authData })),
			transports: ['internal']
		}
	};
};

const assertionResponseFor = (authenticator, options, userHandle) => {
	const rpIdHash = createHash('sha256').update(options.rpId).digest();
	const authenticatorData = Buffer.concat([rpIdHash, Buffer.from([0x05]), Buffer.alloc(4)]);
	const clientDataJSON = clientDataFor('webauthn.get', options.challenge);
	const clientDataHash = createHash('sha256').update(clientDataJSON).digest();
	return {
		id: authenticator.id,
		rawId: authenticator.id,
		type: 'public-key',
		clientExtensionResults: {},
		response: {
			clientDataJSON: b64url(clientDataJSON),
			authenticatorData: b64url(authenticatorData),
			signature: b64url(authenticator.sign(Buffer.concat([authenticatorData, clientDataHash]))),
			userHandle
		}
	};
};

// ── the run ────────────────────────────────────────────────────────────────

const suffix = `${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
const username = `pkv-${suffix}`;
const password = `Verify-${suffix}-9!`;

const main = async () => {
	console.log(`verify-passkeys against ${BASE}\n`);

	// ── register a throwaway user (real API, shared signup path) ──
	console.log('registration + hints cookie');
	const owner = newJar();
	const reg = await api(owner, 'POST', '/api/v1/auth/register', { username, password, email: `${username}@example.com` });
	check('register 200', reg.status === 200 && reg.json?.ok === true, `status ${reg.status} ${JSON.stringify(reg.json)}`);
	check('register sets tt_auth', owner.cookies.has('tt_auth'));
	check('register sets tt_accounts roster pointer', owner.cookies.has('tt_accounts'));
	check('register sets tt_hints cross-deployment pointer', owner.cookies.has('tt_hints'));

	// ── passkey management guards ──
	console.log('\npasskey registration ceremony');
	const emptyList = await api(owner, 'GET', '/api/v1/auth/passkeys');
	check('list starts empty', emptyList.json?.ok === true && emptyList.json.passkeys?.length === 0);

	const anonOptions = await api(newJar(), 'POST', '/api/v1/auth/passkeys/register-options', { password });
	check('register-options rejects anonymous', anonOptions.status === 401);

	const wrongPw = await api(owner, 'POST', '/api/v1/auth/passkeys/register-options', { password: 'not-the-password' });
	check('register-options rejects wrong password', wrongPw.status === 403);

	const regOptions = await api(owner, 'POST', '/api/v1/auth/passkeys/register-options', { password });
	check('register-options 200 with options', regOptions.json?.ok === true && typeof regOptions.json.options?.challenge === 'string');
	check('challenge cookie set', owner.cookies.has('tt_webauthn_reg'));
	check(
		'options request a discoverable credential',
		regOptions.json?.options?.authenticatorSelection?.residentKey === 'required'
	);
	check(
		'registration requires device user verification',
		regOptions.json?.options?.authenticatorSelection?.userVerification === 'required'
	);

	const authenticator = makeAuthenticator();
	const userHandle = regOptions.json.options.user.id;
	const attestation = registrationResponseFor(authenticator, regOptions.json.options);
	const stored = await api(owner, 'POST', '/api/v1/auth/passkeys/register', {
		response: attestation,
		nickname: 'CI software key',
		description: 'minted by verify-passkeys.mjs'
	});
	check('register verifies + stores', stored.json?.ok === true && typeof stored.json.passkey?.id === 'string', JSON.stringify(stored.json));
	check('challenge cookie cleared after verify', !owner.cookies.has('tt_webauthn_reg'));
	const passkeyId = stored.json?.passkey?.id;

	const replayReg = await api(owner, 'POST', '/api/v1/auth/passkeys/register', { response: attestation });
	check('attestation replay refused (challenge consumed)', replayReg.json?.ok !== true);

	const dupOptions = await api(owner, 'POST', '/api/v1/auth/passkeys/register-options', { password });
	check('exclude list carries the credential', dupOptions.json?.options?.excludeCredentials?.some((c) => c.id === authenticator.id) === true);
	const dupStore = await api(owner, 'POST', '/api/v1/auth/passkeys/register', {
		response: registrationResponseFor(authenticator, dupOptions.json.options)
	});
	check('duplicate credential id → 409', dupStore.status === 409, `status ${dupStore.status}`);

	// ── metadata management ──
	console.log('\nnickname / description');
	const renamed = await api(owner, 'POST', '/api/v1/auth/passkeys/update', {
		id: passkeyId,
		nickname: 'Renamed CI key',
		description: 'still the software authenticator'
	});
	check('update renames', renamed.json?.ok === true && renamed.json.passkey?.nickname === 'Renamed CI key');

	// ── usernameless login ceremony ──
	console.log('\npasskey login ceremony');
	const visitor = newJar(); // a fresh browser: no session, no roster
	const loginOptions = await api(visitor, 'POST', '/api/v1/auth/passkeys/login-options');
	check('login-options 200, empty allowCredentials', loginOptions.json?.ok === true && loginOptions.json.options?.allowCredentials?.length === 0);
	check('login requires device user verification', loginOptions.json?.options?.userVerification === 'required');
	check('login challenge cookie set', visitor.cookies.has('tt_webauthn_auth'));

	const assertion = assertionResponseFor(authenticator, loginOptions.json.options, userHandle);
	const loggedIn = await api(visitor, 'POST', '/api/v1/auth/passkeys/login', { response: assertion });
	check('login verifies assertion', loggedIn.json?.ok === true && loggedIn.json.user?.username === username, JSON.stringify(loggedIn.json));
	check('login sets tt_auth', visitor.cookies.has('tt_auth'));
	check('login merges switcher roster', visitor.cookies.has('tt_accounts'));
	check('login writes cross-deployment hint', visitor.cookies.has('tt_hints'));
	check('login reports which passkey', loggedIn.json?.passkeyId === passkeyId);

	// auth/me returns { user } (no ok field)
	const me = await api(visitor, 'GET', '/api/v1/auth/me');
	check('session works (auth/me)', me.json?.user?.username === username, JSON.stringify(me.json));

	const replayLogin = await api(visitor, 'POST', '/api/v1/auth/passkeys/login', { response: assertion });
	check('assertion replay refused (challenge consumed)', replayLogin.json?.ok !== true);

	const afterLogin = await api(owner, 'GET', '/api/v1/auth/passkeys');
	const afterLoginKey = afterLogin.json?.passkeys?.find((p) => p.id === passkeyId);
	check('lastUsedAt recorded', typeof afterLoginKey?.lastUsedAt === 'string');
	check(
		'origin linked-app recorded',
		afterLoginKey?.linkedApps?.some((l) => l.appKey === `origin:${ORIGIN}` && l.usageCount >= 1) === true,
		JSON.stringify(afterLoginKey?.linkedApps)
	);

	// Squat regression (the reason app-link dedupe rides root uniqueKeys, not
	// a kind-blind crystal-path unique index): a free-form data thing carrying
	// the SAME crystal.linkKey must be accepted as ordinary data AND must not
	// disturb the real link. Under the retired unique index this insert died
	// with E11000 — and a duplicate could fail the whole boot index battery.
	// Two data things sharing one linkKey value: under a kind-blind unique
	// index the second dies with E11000, so this pins the retirement without
	// depending on any real link's key.
	const squatKey = `squat-${suffix}-${passkeyId}`;
	const squatOne = await api(owner, 'POST', '/api/v1/things', { crystal: { linkKey: squatKey } });
	const squatTwo = await api(owner, 'POST', '/api/v1/things', { crystal: { linkKey: squatKey } });
	check(
		'data things may share a linkKey crystal (no kind-blind unique index)',
		squatOne.json?.ok === true && squatTwo.json?.ok === true,
		`${squatOne.status}/${squatTwo.status} ${JSON.stringify(squatTwo.json)?.slice(0, 120)}`
	);
	// …and one carrying the REAL link's key must not disturb it either.
	await api(owner, 'POST', '/api/v1/things', { crystal: { linkKey: `${passkeyId}:origin:${ORIGIN}` } });

	const squatJar = newJar();
	const squatLoginOptions = await api(squatJar, 'POST', '/api/v1/auth/passkeys/login-options');
	const afterSquatLogin = await api(squatJar, 'POST', '/api/v1/auth/passkeys/login', {
		response: assertionResponseFor(authenticator, squatLoginOptions.json.options, userHandle)
	});
	check('passkey login still works with a squatting data thing present', afterSquatLogin.json?.ok === true, JSON.stringify(afterSquatLogin.json));

	const afterSquat = await api(owner, 'GET', '/api/v1/auth/passkeys');
	const originLinks = (afterSquat.json?.passkeys?.find((p) => p.id === passkeyId)?.linkedApps || []).filter(
		(l) => l.appKey === `origin:${ORIGIN}`
	);
	check(
		'the real link still dedupes to ONE row and keeps counting',
		originLinks.length === 1 && originLinks[0].usageCount >= 2,
		JSON.stringify(originLinks)
	);

	// ── cross-deployment hints ──
	console.log('\naccount hints (auto-login popup)');
	const ownHints = await api(owner, 'GET', '/api/v1/auth/account-hints');
	check('own hints resolve', ownHints.json?.ok === true && Array.isArray(ownHints.json.hints));
	const ownEntry = ownHints.json?.hints?.find((h) => h.user?.username === username);
	check('signed-in-here account marked alreadyHere', ownEntry?.alreadyHere === true, JSON.stringify(ownHints.json?.hints));

	// A "different deployment" = same hint cookie, none of the origin's other
	// cookies. The pointer must resolve to a live suggestion.
	const elsewhere = newJar();
	elsewhere.cookies.set('tt_hints', owner.cookies.get('tt_hints'));
	const farHints = await api(elsewhere, 'GET', '/api/v1/auth/account-hints');
	const farEntry = farHints.json?.hints?.find((h) => h.user?.username === username);
	check('hint resolves without a local session', farEntry !== undefined && farEntry.alreadyHere === false, JSON.stringify(farHints.json));
	check('hint carries origin + lastSeenAt', typeof farEntry?.origins?.[0]?.origin === 'string' && typeof farEntry?.origins?.[0]?.lastSeenAt === 'string');
	check('hint is a slim projection (no email)', farEntry && !('email' in farEntry.user));

	// Per-environment authority: a pointer written by ANOTHER deployment that
	// doesn't resolve here (different database) must be KEPT, while this
	// origin's own dead pointers are pruned — visiting one environment must
	// never destroy another environment's hints.
	const mixedJar = newJar();
	const nowSec = Math.floor(Date.now() / 1000);
	const mixedPointers = [
		{ r: 'ghost-foreign-roster', o: 'https://dev.thingtime.com', t: nowSec },
		{ r: 'ghost-local-roster', o: ORIGIN, t: nowSec }
	];
	mixedJar.cookies.set('tt_hints', `j:${Buffer.from(JSON.stringify(mixedPointers)).toString('base64url')}`);
	const mixed = await api(mixedJar, 'GET', '/api/v1/auth/account-hints');
	check('unverifiable pointers render no hints', mixed.json?.ok === true && mixed.json.hints?.length === 0);
	const rewritten = mixedJar.cookies.get('tt_hints') || '';
	let keptPointers = null;
	try {
		keptPointers = JSON.parse(Buffer.from(decodeURIComponent(rewritten).slice(2), 'base64url').toString('utf8'));
	} catch {
		keptPointers = null;
	}
	check(
		'own-origin dead pointer pruned, foreign pointer kept',
		Array.isArray(keptPointers) && keptPointers.length === 1 && keptPointers[0]?.o === 'https://dev.thingtime.com',
		JSON.stringify(keptPointers)
	);

	// ── revocation ──
	console.log('\nrevocation + deletion');
	const revokeWrongPw = await api(owner, 'POST', '/api/v1/auth/passkeys/revoke', { id: passkeyId, password: 'nope' });
	check('revoke rejects wrong password', revokeWrongPw.status === 403);

	const deleteBeforeRevoke = await api(owner, 'POST', '/api/v1/auth/passkeys/delete', { id: passkeyId, password });
	check('delete refuses non-revoked passkey', deleteBeforeRevoke.status === 409);

	const revoked = await api(owner, 'POST', '/api/v1/auth/passkeys/revoke', { id: passkeyId, password });
	check('revoke 200 + revokedAt', revoked.json?.ok === true && typeof revoked.json.passkey?.revokedAt === 'string');

	const revokedVisitor = newJar();
	const revokedOptions = await api(revokedVisitor, 'POST', '/api/v1/auth/passkeys/login-options');
	const revokedLogin = await api(revokedVisitor, 'POST', '/api/v1/auth/passkeys/login', {
		response: assertionResponseFor(authenticator, revokedOptions.json.options, userHandle)
	});
	check('revoked passkey cannot log in', revokedLogin.status === 401, `status ${revokedLogin.status}`);

	const deleted = await api(owner, 'POST', '/api/v1/auth/passkeys/delete', { id: passkeyId, password });
	check('delete revoked passkey', deleted.json?.ok === true);
	const finalList = await api(owner, 'GET', '/api/v1/auth/passkeys');
	check('list empty after delete', finalList.json?.ok === true && finalList.json.passkeys?.length === 0);

	// ── hint death: logging out elsewhere removes the suggestion ──
	console.log('\nhint liveness');
	await api(owner, 'POST', '/api/v1/auth/logout', { all: true });
	const deadHints = await api(elsewhere, 'GET', '/api/v1/auth/account-hints');
	const deadEntry = deadHints.json?.hints?.find((h) => h.user?.username === username);
	check('logged-out-elsewhere hint disappears', deadEntry === undefined, JSON.stringify(deadHints.json));

	// visitor's passkey-minted session is its own roster/session — still alive
	const visitorStill = await api(visitor, 'GET', '/api/v1/auth/me');
	check('other browser session unaffected by owner logout', visitorStill.json?.user?.username === username, JSON.stringify(visitorStill.json));

	// ── docs registration smoke ──
	console.log('\ndocs');
	const docs = await api(newJar(), 'GET', '/api/v1/auth/passkeys-docs');
	check('passkeys docs endpoint live', docs.json?.ok === true && docs.json.docs?.endpoint === '/api/v1/auth/passkeys');
	const hintsDocs = await api(newJar(), 'GET', '/api/v1/auth/account-hints-docs');
	check('account-hints docs endpoint live', hintsDocs.json?.ok === true);

	console.log(`\n${passed} passed, ${failures.length} failed`);
	if (failures.length) {
		console.log(`failures:\n  - ${failures.join('\n  - ')}`);
		process.exit(1);
	}
};

main().catch((err) => {
	console.error('verify-passkeys crashed:', err);
	process.exit(1);
});
