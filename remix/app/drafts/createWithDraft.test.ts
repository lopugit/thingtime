import assert from 'node:assert/strict';
import test from 'node:test';
import { createWithDraft } from './createWithDraft';
import { workspaceDraftContext, workspaceDraftRequest } from './workspaceDraft';
test('content creation completes while draft flush and retirement remain stalled or fail', { timeout: 1000 }, async () => {
 for (const operation of [() => new Promise<never>(() => {}), async () => { throw new Error('Draft unavailable'); }]) {
  let writes = 0, cleanups = 0;
  const response = await createWithDraft({ flush: operation, retire: () => { cleanups++; return operation(); } }, async () => { writes++; return { ok: true, id: 'created' }; });
  assert.equal(response.id, 'created'); assert.equal(writes, 1); await Promise.resolve(); assert.equal(cleanups, 1);
 }
});
test('a failed content write keeps its draft for retry', async () => {
 let retired = false;
 const draft = { flush: async () => {}, retire: async () => { retired = true; } };
 await assert.rejects(createWithDraft(draft, async () => { throw new Error('Content unavailable'); }), /Content unavailable/);
 await assert.rejects(createWithDraft(draft, async () => ({ ok: false, error: 'Invalid' })));
 assert.equal(retired, false);
});
test('draft contexts isolate account, origin and plane, and retained requests cannot adopt another workspace', async () => {
 const base = { kind: 'account', origin: 'https://thingtime.example', ownerId: 'owner', dataPlane: 'home' } as const;
 const contexts = await Promise.all([base, { ...base, ownerId: 'other' }, { ...base, dataPlane: 'other' }, { ...base, origin: 'https://other.example' }, { kind: 'anonymous' } as const].map(scope => workspaceDraftContext(scope, 'schema-builder:new')));
 assert.equal(new Set(contexts).size, 5); assert.equal(await workspaceDraftContext(base, 'schema-builder:new'), contexts[0]);
 let active = true, calls = 0, release!: (value: any) => void;
 const request = workspaceDraftRequest({ assertCurrent() { if (!active) throw new Error('Retired'); }, onInvalidate: () => () => {} }, (async () => { calls++; return new Promise(resolve => { release = resolve; }); }) as any);
 const pending = request('owner'); active = false; release({ ok: true }); await assert.rejects(pending, /Retired/);
 await assert.rejects(request('owner'), /Retired/); assert.equal(calls, 1);
});
