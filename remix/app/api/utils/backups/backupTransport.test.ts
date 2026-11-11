import assert from 'node:assert/strict';
import test from 'node:test';
import { isGatewayWorkIdle, reserveGatewayWorkShutdown } from '../deployment/environmentGateway';
import { runBoundedBackupRequest } from './backupTransport.server';
import { internalAccountSession, withInternalAccountSession } from '../auth/internalAccountSession';
import { fenceAccountSession } from '../auth/fenceAccountSession';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
	let captured: Request | null = null;
	const reference = { origin: 'https://transport.test', ownerId: 'owner', jti: 'synthetic-session-reference' };
	const context = { request: new Request(reference.origin + '/api/v1/backups'), guard: async () => {},
		withRequest: async <T>(request: Request, work: () => Promise<T>) => { captured = request; return withInternalAccountSession(request, reference, async () => {}, work); } };
	return { context, get captured() { return captured; }, request: new Request(reference.origin + '/api/v1/auth/me') };
}
test('hung handler times out, releases its trusted binding and cancels a late response body', async () => {
	const f = fixture(), result = deferred<Response>(); let cancelled = false;
	await assert.rejects(runBoundedBackupRequest(f.context, f.request, async () => result.promise, 20), { name: 'TimeoutError' });
	assert.ok(f.captured); assert.equal(internalAccountSession(f.captured!), undefined);
	assert.equal(reserveGatewayWorkShutdown(), null, 'timed-out handler may still be committing its accepted effect');
	result.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
	await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelled, true);
	assert.equal(isGatewayWorkIdle(), true);
});
test('hung body read and even a stalled stream cancel cannot retain the trusted binding', async () => {
	const f = fixture(); let cancelled = false;
	const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}), cancel: () => { cancelled = true; return new Promise<void>(() => {}); } });
	await assert.rejects(runBoundedBackupRequest(f.context, f.request, async () => new Response(stream), 20), { name: 'TimeoutError' });
	assert.equal(cancelled, true); assert.equal(internalAccountSession(f.captured!), undefined);
});
test('a newly attempted protected fence after abort is refused; an already accepted effect is not undone or repeated', async () => {
	const f = fixture(), proceed = deferred<void>(), late = deferred<void>(); let effects = 0;
	const handler = async ({ request }: { request: Request }) => {
		await proceed.promise;
		try { await fenceAccountSession(request, 'owner', { inTransaction: () => true }); effects++; }
		catch { /* normal tokenless fence refuses after the Request binding ends */ }
		late.resolve(); return Response.json({ ok: true });
	};
	await assert.rejects(runBoundedBackupRequest(f.context, f.request, handler, 20), { name: 'TimeoutError' });
	proceed.resolve(); await late.promise; assert.equal(effects, 0);
	const acknowledged = fixture(), finish = deferred<void>(), receipts = new Map<string, string>(); let calls = 0;
	const operationId = 'immutable-original-operation';
	await assert.rejects(runBoundedBackupRequest(acknowledged.context, acknowledged.request, async () => {
		calls++; receipts.set(operationId, 'accepted-before-timeout'); await finish.promise; return Response.json({ operationId, ok: true });
	}, 20), { name: 'TimeoutError' });
	assert.equal(receipts.get(operationId), 'accepted-before-timeout'); assert.equal(calls, 1);
	finish.resolve(); await new Promise(resolve => setImmediate(resolve));
	assert.equal(receipts.get(operationId), 'accepted-before-timeout'); assert.equal(calls, 1);
});

test('a stalled initial guard times out without binding or dispatching a late handler', async () => {
 const f = fixture(), gate = deferred<void>(); let calls = 0;
 f.context.guard = async () => gate.promise;
 await assert.rejects(runBoundedBackupRequest(f.context, f.request, async () => { calls++; return Response.json({ok:true}); }, 20), {name:'TimeoutError'});
	assert.equal(reserveGatewayWorkShutdown(), null, 'response deadline cannot settle the actual guard');
 assert.equal(f.captured, null); gate.resolve(); await new Promise(resolve=>setImmediate(resolve)); assert.equal(calls,0);
	assert.equal(isGatewayWorkIdle(), true);
});
