import assert from 'node:assert/strict';
import test from 'node:test';
import { rootIdentity } from '../utils/rootIdentity';
import { bindLocalWorkspace } from './runtime.client';
import { accountSuiteTransport } from './suiteTransport.client';

test('suite sender negotiates receipts and pins delegated actor, origin, data plane and immutable request', async () => {
	const saved = { window: globalThis.window, fetch: globalThis.fetch };
	const origin = 'https://suite-delegation.example';
	const principal = { kind: 'account', origin, ownerId: 'principal', dataPlane: 'home' } as const;
	const scope = { ...principal, ownerId: 'character', delegatedBy: 'principal' };
	rootIdentity.confirm(rootIdentity.read().generation);
	bindLocalWorkspace(false, rootIdentity.read().generation, principal);
	const calls: { url: string; init: RequestInit }[] = [];
	let changed = false;
	Object.assign(globalThis, { window: { location: { origin }, dispatchEvent() {} }, fetch: async (url: string, init: RequestInit) => {
		if (url.includes('capabilities')) return Response.json({ schemaVersion: 1, origin, features: {
			'api.auth-characters': { version: '1.0.0' }, 'api.webpages-suites-install': { version: '1.7.0' }, 'api.mongodb-endpoint': { version: '1.1.0' }
		} });
		calls.push({ url, init }); return changed ? Response.json({ ok: false, code: 'WORKSPACE_CHANGED' }, { status: 409 }) : Response.json({ ok: true });
	} });
	try {
		const transport = accountSuiteTransport(scope, { assertCurrent() {}, onInvalidate: () => () => {} });
		const request = { key: 'web-standards', onlyMissing: true as const, requestId: crypto.randomUUID(), bundleVersion: 'suite-bundle-v1:synthetic' };
		const before = structuredClone(request);
		await transport.install(request, new AbortController().signal);
		assert.equal(calls.length, 1);
		assert.equal(calls[0].url, '/api/v1/webpages/suites/install');
		const headers = new Headers(calls[0].init.headers);
		assert.equal(headers.get('X-Thingtime-Character'), 'character');
		assert.equal(headers.get('X-Thingtime-Expected-Actor'), 'character');
		assert.equal(headers.get('X-Thingtime-Expected-Data-Plane'), 'home');
		assert.equal(calls[0].init.credentials, 'same-origin');
		assert.equal(calls[0].init.redirect, 'error');
		assert.deepEqual(JSON.parse(calls[0].init.body as string), before);
		assert.deepEqual(request, before);
		bindLocalWorkspace(false, rootIdentity.read().generation, principal, false);
		await assert.rejects(transport.install(request, new AbortController().signal), /offline|Reconnect|confirmation/i);
		assert.equal(calls.length, 1, 'Unconfirmed account cannot reuse its cookies for suite sync.');
		bindLocalWorkspace(false, rootIdentity.read().generation, principal, true);
		const generation = rootIdentity.read().generation;
		changed = true;
		await assert.rejects(transport.install(request, new AbortController().signal), /session changed/);
		assert.notEqual(rootIdentity.read().generation, generation, 'Server identity refusal retires the old root binding.');
	} finally { bindLocalWorkspace(true, rootIdentity.read().generation); Object.assign(globalThis, saved); }
});

test('a server without durable suite receipts receives no provisional install', async () => {
	const saved = { window: globalThis.window, fetch: globalThis.fetch }, origin = 'https://suite-old-contract.example';
	const scope = { kind: 'account', origin, ownerId: 'owner', dataPlane: 'home' } as const;
	rootIdentity.confirm(rootIdentity.read().generation); bindLocalWorkspace(false, rootIdentity.read().generation, scope);
	let writes = 0;
	Object.assign(globalThis, { window: { location: { origin }, dispatchEvent() {} }, fetch: async (url: string) => {
		if (url.includes('capabilities')) return Response.json({ schemaVersion: 1, origin, features: {
			'api.webpages-suites-install': { version: '1.6.0' }, 'api.mongodb-endpoint': { version: '1.1.0' }
		} });
		writes++; return Response.json({ ok: true });
	} });
	try {
		const transport = accountSuiteTransport(scope, { assertCurrent() {}, onInvalidate: () => () => {} });
		await assert.rejects(transport.install({ key: 'web-standards', onlyMissing: true, requestId: crypto.randomUUID(), bundleVersion: 'synthetic' }, new AbortController().signal), /incompatible/);
		assert.equal(writes, 0);
	} finally { bindLocalWorkspace(true, rootIdentity.read().generation); Object.assign(globalThis, saved); }
});
