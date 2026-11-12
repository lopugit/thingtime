import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { contentPartPlan } from './contentFingerprint';
import type { SyncScope } from './reconcile';
let capabilityError: Error | null = null;
mock.module('~/api/utils/capabilities/requireCapability.client', { namedExports: { requireThingtimeCapability: async (feature: string, version: string) => {
	assert.equal(feature, 'api.attachment-content'); assert.equal(version, '1.13.0'); if (capabilityError) throw capabilityError;
} } });
const { readAttachmentSyncEntry } = await import('./attachmentFingerprint.client');
const scope: SyncScope = { origin: 'https://example.test', ownerId: 'owner', dataPlane: 'home', rootId: 'root', deviceId: 'device' };
const receipt = { ok: true, id: 'attachment', version: 'b'.repeat(64), size: 2, fingerprint: { algorithm: 'sha256-parts-v1', ...contentPartPlan(2), sha256: 'a'.repeat(64) } };

test('cloud fingerprint transport fences origins, permissions, response size and mid-read account changes', async () => {
	const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: scope.origin } } });
	let current = scope, calls = 0;
	let respond = () => Response.json(receipt);
	const fetchMock = mock.method(globalThis, 'fetch', async (url: any, options: any) => {
		calls++; assert.equal(String(url), '/api/v1/attachments/content?id=attachment&fingerprint=1');
		assert.equal(options.credentials, 'same-origin'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
		return respond();
	});
	const read = (signal?: AbortSignal) => readAttachmentSyncEntry({ attachmentId: 'attachment', path: 'file.bin', scope, currentScope: () => current, signal });
	try {
		assert.equal((await read()).fingerprint?.sha256, receipt.fingerprint.sha256);
		for (const status of [403, 404, 409, 429, 503]) {
			respond = () => Response.json({ ok: false }, { status });
			await assert.rejects(read(), /keep the current sync state/);
		}
		respond = () => new Response('x'.repeat(8193)); await assert.rejects(read(), /too large/);
		respond = () => Response.json({ ...receipt, id: 'another' }); await assert.rejects(read(), /Invalid attachment/);
		const before = calls;
		current = { ...scope, ownerId: 'another' }; await assert.rejects(read(), /context changed/); assert.equal(calls, before);
		current = scope; capabilityError = Error('unsupported server'); await assert.rejects(read(), /unsupported server/); assert.equal(calls, before);
		capabilityError = null;
		const controller = new AbortController(); controller.abort(); await assert.rejects(read(controller.signal), { name: 'AbortError' }); assert.equal(calls, before);
		const mutableScope = { ...scope };
		respond = () => { mutableScope.ownerId = 'changed'; return Response.json(receipt); };
		await assert.rejects(readAttachmentSyncEntry({ attachmentId: 'attachment', path: 'file.bin', scope: mutableScope, currentScope: () => mutableScope }), /context changed/);
		let cancelled = false, chunks = 0;
		respond = () => new Response(new ReadableStream({ pull(stream) {
			if (chunks++ === 0) stream.enqueue(new TextEncoder().encode('{'));
			else { current = { ...scope, rootId: 'another' }; stream.enqueue(new TextEncoder().encode('}')); }
		}, cancel() { cancelled = true; } }, { highWaterMark: 0 }));
		await assert.rejects(read(), /context changed/); assert.equal(cancelled, true);
	} finally {
		fetchMock.mock.restore(); capabilityError = null;
		if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow); else delete (globalThis as any).window;
	}
});
