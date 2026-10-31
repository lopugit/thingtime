import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
let allowed = true;
const reads: unknown[] = [];
const thing = { id: 'form', thingtime: ['component'], crystal: { name: 'Equipment', render: { children: Array.from({ length: 200 }, (_, index) => ({ index, text: 'x'.repeat(500), options: ['Tool', 'Battery', 'Vehicle', 'Fuel', 'Other'] })) } } };
mock.module('../things/things', { namedExports: {
  getThing: async (viewer: unknown, id: string) => { reads.push({ viewer, id }); return allowed ? { ok: true, thing } : { ok: false, status: 403, error: 'Access denied' }; }
} });
for (const path of ['../actions/execute', '../things/search', '../components/browse', '../webpages/webpages', '../webpages/suites']) mock.module(path, { namedExports: {} });
const { createLopuToolContext, runLopuTool } = await import('./chatTools');

test('get_thing provides an actionable inspection hint and reauthorizes each page', async () => {
  const viewer = { id: 'owner', username: 'owner' };
  const ctx = createLopuToolContext(viewer, {}, () => {});
  const run = (input: object) => runLopuTool({ id: 'read', name: 'get_thing', input: { id: 'form', ...input } }, ctx);
  const summary = await run({});
  assert.equal(summary.ok, true);
  if (!summary.ok) return;
  assert.deepEqual((summary.data as any).inspection.path, '');
  const first = await run({ path: '/render', offset: 0 });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const page = (first.data as any).crystalRead;
  assert.ok(page.json.includes('options'));
  assert.ok(page.nextOffset > 0);
  assert.equal((await run({ path: '/acl', offset: 0 })).ok, false, 'storage envelope is not reachable');
  allowed = false;
  const revoked = await run({ path: '/render', offset: page.nextOffset, revision: page.revision });
  assert.equal(revoked.ok, false);
  assert.match((revoked as any).error, /Access denied/);
  assert.deepEqual(reads, Array.from({ length: 4 }, () => ({ viewer, id: 'form' })));
});

test('restored pages run through the real get_thing validator and fresh viewer authorization', async () => {
 const { restoreReadContext, rememberReadReference } = await import('./readContext');
 allowed = true;
 const ctx = createLopuToolContext({ id: 'owner', username: 'owner' }, {}, () => {});
 const call = { id: 'read', name: 'get_thing', input: { id: 'form', path: '/render', offset: 0 } };
 const initial = await runLopuTool(call, ctx);
 const refs = rememberReadReference([], call, initial);
 const fresh = await restoreReadContext(refs, runLopuTool, ctx);
 assert.equal(fresh.references.length, 1);
 assert.match(fresh.text, /Equipment|Tool/);
 allowed = false;
 const revoked = await restoreReadContext(refs, runLopuTool, ctx);
 assert.equal(revoked.references.length, 0);
 assert.doesNotMatch(revoked.text, /Equipment|Battery/);
 allowed = true;
 thing.crystal.render.children[0].text = 'changed';
 const changed = await restoreReadContext(refs, runLopuTool, ctx);
 assert.equal(changed.references.length, 0);
 assert.doesNotMatch(changed.text, /Battery/);
 assert.match(changed.text, /changed/);
});
