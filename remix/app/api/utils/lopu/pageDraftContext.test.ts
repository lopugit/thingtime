import assert from 'node:assert/strict';
import test from 'node:test';
import { activePageFromContext, createLopuToolContext, resolvePatchTarget, runPatchPage } from './chatTools.ts';
import { continuationContext } from './continuationCore.ts';
const viewer = { id: 'owner', username: 'owner' };
const at = '2026-09-27T05:00:00.000Z';
const block = { id: 'existing', type: 'text' as const, text: 'Keep this content' };
function harness() {
 const reads: unknown[] = [], writes: any[] = [], events: unknown[] = [];
 const deps = {
  webpages: { resolveWebpage: async (_viewer: any, input: any) => { reads.push(input); return { ok: true, source: 'user', page: { id: 'page', updatedAt: at, crystal: { name: 'Saved page', blocks: [block] } } }; } },
  things: { updateThing: async (_viewer: any, id: any, input: any, options: any) => { writes.push({ id, input, options }); return { ok: true, thing: { id, updatedAt: '2026-09-27T05:01:00.000Z', crystal: input.crystal } }; } }
 } as any;
 return { deps, reads, writes, events, context: (page: any) => createLopuToolContext(viewer, { page }, event => events.push(event)) };
}
test('missing blocks stay missing; actual empty arrays remain a ready empty draft', () => {
 assert.equal(activePageFromContext({ page: { id: 'page', source: 'user' } })?.blocks, null);
 assert.deepEqual(activePageFromContext({ page: { id: 'page', source: 'user', blocks: [] } })?.blocks, []);
 assert.equal(activePageFromContext({ page: { ready: false, dirty: false, blocks: [] } })?.blocks, null);
});
test('known clean omitted context resolves authorized saved contents before applying a patch', async () => {
 const h = harness(); const ctx = h.context({ id: 'page', source: 'user', dirty: false, ready: true, updatedAt: at });
 const result = await runPatchPage(h.deps, ctx, 'patch', { target: 'active', persist: true, ops: [{ op: 'insert', containerId: null, index: 'end', block: { id: 'new', type: 'text', text: 'Added' } }] });
 assert.equal(result.ok, true); assert.deepEqual(h.reads, [{ id: 'page' }]); assert.equal(h.writes.length, 1);
 assert.deepEqual(h.writes[0].input.crystal.blocks.map((item: any) => item.id), ['existing', 'new']);
 assert.deepEqual(h.writes[0].options, { expectedUpdatedAt: at });
});
test('omitted dirty, unknown and loading drafts cannot be patched through active or explicit-id aliases', async () => {
 for (const state of [{ dirty: true, ready: true }, { ready: true }, { dirty: false, ready: false }]) {
  for (const target of ['active', { id: 'page' }] as const) {
   const h = harness(); const ctx = h.context({ id: 'page', source: 'user', updatedAt: at, ...state });
   const result = await runPatchPage(h.deps, ctx, 'patch', { target, persist: true, ops: [{ op: 'setBlocks', blocks: [] }] });
   assert.equal(result.ok, false); assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.events.length, 0);
  }
 }
});
test('continuation discards stale payloads but retains dirty/readiness and base revision fences', async () => {
 const context = continuationContext({ page: { id: 'page', source: 'user', dirty: true, ready: true, updatedAt: at, blocks: [block] } });
 assert.equal('blocks' in context!.page!, false); assert.equal(context!.page!.updatedAt, at); assert.equal(context!.page!.dirty, true);
 const h = harness(); const result = await resolvePatchTarget(h.deps, h.context(context!.page), 'active');
 assert.ok('error' in result); assert.equal(h.reads.length, 0);
});
test('a supplied draft without a base version may change locally but cannot persist without a stale-write check', async () => {
 const h = harness(); const result = await runPatchPage(h.deps, h.context({ id: 'page', source: 'user', blocks: [block] }), 'patch', { target: 'active', persist: true, ops: [{ op: 'update', id: 'existing', patch: { text: 'New' } }] });
 assert.equal(result.ok, true); assert.equal(h.writes.length, 0); assert.match((result as any).summary, /base version is missing/);
});
