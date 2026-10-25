import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { copyPublicThing } from './publicCopy.client';
import { LocalThings } from './things';
import { WorkspaceDatabase } from './storage';
import { anonymousApi } from './api.client';
import { bindLocalWorkspace, anonymousWorkspaceDatabase } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import type { TransferPlan } from '../utils/thingTransfer/plan';
import { createQuotaFactory } from './storageTestFixture';
import { localAttachmentFileId } from './attachments';
import { binaryBlob, blobChecksum } from '../utils/thingTransfer/binary';

const origin = 'https://copy.test', scope = { kind: 'anonymous' } as const;
const plan = (): TransferPlan => ({ roots: ['shared-page'], things: [
	{ id: 'shared-page', thingtime: ['webpage'], crystal: { name: 'Shared page', blocks: [{ id: 'card', type: 'component', component: 'shared-card' }] } },
	{ id: 'shared-card', thingtime: ['component'], crystal: { name: 'Shared card', componentKey: 'shared-card', version: 1,
		render: { tag: 'img', props: { src: '/api/v1/attachments/content?id=shared-file', alt: 'Independent image' } } } }
], files: [{ id: 'shared-file', targetId: 'shared-card', sharedRoot: 'shared-page', name: 'image.png', mime: 'image/png', bytes: 3 }] });

function fixture(factory = new IDBFactory()) {
	const db = new WorkspaceDatabase(factory, undefined, undefined, IDBKeyRange), calls: { url: URL; init: RequestInit }[] = [];
	let live = true, exports = 0;
	const callbacks = new Set<() => void>(), lease = { assertCurrent() { if (!live) throw new Error('Workspace changed'); },
		onInvalidate(callback: () => void) { callbacks.add(callback); return () => { callbacks.delete(callback); }; } };
	const things = new LocalThings(db, scope, lease), initial = plan();
	const state = { manifestOrigin: origin, exportVersion: '1.17.0', bytes: new Uint8Array([1, 2, 3]),
		plan: initial, final: initial, refusal: 0, afterBytes: () => {}, mediaUrl: '', fileVersion: '1.11.0', receiptKey: 'a'.repeat(64), receiptChanged: false, etagChanged: false };
	const fetcher: typeof fetch = async (input, init: RequestInit = {}) => {
		const url = new URL(String(input)); calls.push({ url, init });
		assert.equal(url.origin, origin); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
		assert.equal(init.referrerPolicy, 'no-referrer'); assert.equal(init.cache, 'no-store');
		assert.equal(new Headers(init.headers).has('Authorization'), false);
		if (url.pathname === '/.well-known/thingtime-capabilities.json') return Response.json({ schemaVersion: 1, origin: state.manifestOrigin,
			features: { 'api.things-export': { version: state.exportVersion }, 'api.attachment-content': { version: state.fileVersion } } });
		if (url.pathname === '/api/v1/things/export') {
			assert.equal(init.method, 'POST'); assert.deepEqual(JSON.parse(String(init.body)), { ids: ['shared-page'], key: 'synthetic-link', includeChildren: true, includeDependencies: true, includeFiles: true, includeLinks: true });
			if (++exports > 1 && state.refusal) return Response.json({ ok: false }, { status: state.refusal });
			return Response.json({ ok: true, plan: exports > 1 ? state.final : state.plan });
		}
		assert.equal(url.pathname, '/api/v1/attachments/content'); assert.equal(url.searchParams.get('sharedRoot'), 'shared-page');
		assert.equal(url.searchParams.get('key'), 'synthetic-link'); assert.equal(url.searchParams.get('id'), 'shared-file');
		if (url.searchParams.get('cache') === 'validate') return Response.json({ ok: true, cacheKey: (state.receiptChanged ? 'b'.repeat(64) : state.receiptKey) + ':original', size: state.plan.files[0].bytes });
		state.afterBytes(); const response = new Response(state.bytes);
		if (url.searchParams.get('cache') === 'original-bytes') {
			assert.equal(new Headers(init.headers).get('If-Match'), '"' + state.receiptKey + ':original:v1"');
			response.headers.set('ETag', '"' + (state.etagChanged ? 'c'.repeat(64) : state.receiptKey) + ':original:v1"');
			response.headers.set('Content-Length', String(state.bytes.byteLength));
		}
		if (state.mediaUrl) Object.defineProperty(response, 'url', { value: state.mediaUrl });
		return response;
	};
	return { db, things, lease, calls, state, fetch: fetcher, retire() { live = false; callbacks.forEach(callback => callback()); },
		copy: () => copyPublicThing({ id: 'shared-page', key: 'synthetic-link' }, { origin, lease, things, fetch: fetcher }) };
}

test('anonymous shared copy reauthorizes complete editable closure, stages bytes and survives independent offline copying', async () => {
	const f = fixture();
	try {
		const result = await f.copy(), root = await f.things.get(result.id), component = await f.things.get(result.idMap['shared-card']);
		assert.notEqual(root.id, 'shared-page'); assert.notEqual(component.id, 'shared-card');
		assert.equal((root.crystal.blocks as any[])[0].component, component.id);
		const attachment = result.things.find(row => row.thingtime.includes('attachment'))!;
		assert.notEqual(attachment.id, 'shared-file'); assert.ok(JSON.stringify(component.crystal).includes(attachment.id));
		assert.equal(JSON.stringify(result).includes('synthetic-link'), false);
		assert.deepEqual(new Uint8Array(await (await f.things.readFileBlob(attachment.id)).blob.arrayBuffer()), new Uint8Array([1, 2, 3]));
		assert.deepEqual(f.calls.map(call => call.url.pathname), ['/.well-known/thingtime-capabilities.json', '/api/v1/things/export', '/api/v1/attachments/content', '/api/v1/things/export']);
		await f.things.update({ id: component.id, crystal: { name: 'Edited independently' } });
		const bundle = await f.things.export([root.id]), copied = await f.things.import(bundle.manifest, null, bundle.files);
		await f.things.remove([root.id, component.id]);
		assert.equal((await f.things.get(copied.idMap[component.id])).crystal.name, 'Edited independently');
		assert.equal(f.calls.length, 4, 'further device copies need no remote read or upload');
	} finally { await f.db.close(); }
});

test('anonymous shared copies negotiate large original streams and pin receipts without persisting source authority', async () => {
	const f = fixture();
	try {
		f.state.fileVersion = '1.18.0'; f.state.bytes = new Uint8Array(17 * 1024 * 1024 + 3).fill(61);
		f.state.plan.files[0].bytes = f.state.bytes.length;
		const result = await f.copy();
		const attachment = result.things.find(row => row.thingtime.includes('attachment'))!;
		assert.equal((await f.things.readFileBlob(attachment.id)).blob.size, f.state.bytes.length);
		await f.db.close();
		const reopened = new LocalThings(f.db, scope, f.lease), bundle = await reopened.export([result.id]);
		assert.equal(bundle.manifest.files.length, 1);
		const portableId = bundle.manifest.files[0].id;
		assert.equal(portableId, localAttachmentFileId(attachment.id));
		assert.notEqual(portableId, attachment.id, 'portable byte IDs are not attachment Thing IDs');
		const retained = bundle.files.get(portableId);
		assert.ok(retained, 'a cold export must include every declared file');
		assert.equal(binaryBlob(retained).size, f.state.bytes.length);
		assert.equal(await blobChecksum(binaryBlob(retained)), await blobChecksum(new Blob([f.state.bytes])));
		assert.ok(f.calls.some(call => call.url.searchParams.get('cache') === 'original-bytes'));
		assert.equal(f.calls.filter(call => call.url.searchParams.get('cache') === 'validate').length, 3);
		assert.equal(JSON.stringify(result).includes(f.state.receiptKey), false);
		assert.equal(JSON.stringify(result).includes('synthetic-link'), false);
	} finally { await f.db.close(); }
});

test('large-copy negotiation, ETag changes and same-size receipt replacement leave no partial local copy', async () => {
	for (const failure of ['old-capability', 'etag', 'replacement'] as const) {
		const f = fixture();
		try {
			if (failure === 'old-capability') f.state.plan.files[0].bytes = 17 * 1024 * 1024;
			else f.state.fileVersion = '1.18.0';
			if (failure === 'etag') f.state.etagChanged = true;
			if (failure === 'replacement') f.state.afterBytes = () => { f.state.receiptChanged = true; };
			await assert.rejects(f.copy()); assert.deepEqual(await f.things.snapshot(), []);
			if (failure === 'old-capability') assert.equal(f.calls.filter(call => call.url.pathname === '/api/v1/attachments/content').length, 0);
		} finally { await f.db.close(); }
	}
});

test('shared copy refuses root revocation or changed dependency after downloading without a partial import', async () => {
	for (const failure of ['revoked', 'changed', 'missing-dependency', 'missing-file', 'wrong-root', 'wrong-kind', 'truncated', 'foreign-origin', 'retired'] as const) {
		const f = fixture();
		try {
			if (failure === 'revoked') f.state.refusal = 403;
			if (failure === 'changed') { f.state.final = structuredClone(f.state.plan); f.state.final.things[1].crystal.name = 'Changed while copying'; }
			if (failure === 'missing-dependency') f.state.plan.things.pop();
			if (failure === 'missing-file') f.state.plan.files = [];
			if (failure === 'wrong-root') f.state.plan.roots = ['other'];
			if (failure === 'wrong-kind') f.state.plan.things[0].thingtime = ['user'];
			if (failure === 'truncated') f.state.bytes = new Uint8Array([1]);
			if (failure === 'foreign-origin') f.state.mediaUrl = 'https://other.test/bytes';
			if (failure === 'retired') f.state.afterBytes = () => f.retire();
			await assert.rejects(f.copy(), undefined, failure);
			if (failure !== 'retired') assert.deepEqual(await f.things.snapshot(), [], failure);
		} finally { await f.db.close(); }
	}
});

test('shared-copy capability origin/versions, cancellation and quota fail closed before local content exists', async () => {
	for (const failure of ['manifest-origin', 'export-version', 'file-version', 'cancelled', 'quota'] as const) {
		const f = fixture(failure === 'quota' ? createQuotaFactory({ records: 1 }) : undefined);
		try {
			if (failure === 'manifest-origin') f.state.manifestOrigin = 'https://foreign.test';
			if (failure === 'export-version') f.state.exportVersion = '2.0.0';
			if (failure === 'file-version') f.state.fileVersion = '1.0.0';
			await assert.rejects(failure === 'cancelled' ? copyPublicThing({ id: 'shared-page' }, { origin, things: f.things, lease: f.lease, fetch: f.fetch }, AbortSignal.abort()) : f.copy());
			assert.deepEqual(await f.things.snapshot(), []);
			if (['manifest-origin', 'export-version', 'cancelled'].includes(failure)) assert.ok(f.calls.length <= 1);
		} finally { await f.db.close(); }
	}
});

test('anonymous API forks public sources through read-only export while owned copies stay fully offline', async () => {
	const oldWindow = globalThis.window, oldFactory = globalThis.indexedDB, oldFetch = globalThis.fetch, f = fixture();
	Object.assign(globalThis, { window: { dispatchEvent() {}, location: { origin } }, indexedDB: new IDBFactory(), fetch: f.fetch });
	bindLocalWorkspace(true, rootIdentity.read().generation);
	try {
		const api = anonymousApi({ things: { fork: async (_input: { id: string; key?: string }): Promise<any> => { throw new Error('Account fork forbidden'); } } });
		const first = await api.things.fork({ id: 'shared-page', key: 'synthetic-link' }); assert.ok(first.id);
		const second = await api.things.fork({ id: first.id }); assert.notEqual(second.id, first.id); assert.equal(f.calls.length, 4);
		await anonymousWorkspaceDatabase().transaction(scope, 'readwrite', { assertCurrent() {}, onInvalidate: () => () => {} }, async tx => { await tx.delete('things', first.id); });
		await assert.rejects(api.things.fork({ id: first.id }), /not in this workspace/i); assert.equal(f.calls.length, 4);
	} finally {
		await anonymousWorkspaceDatabase().close(); await f.db.close();
		Object.assign(globalThis, { window: oldWindow, indexedDB: oldFactory, fetch: oldFetch });
	}
});
