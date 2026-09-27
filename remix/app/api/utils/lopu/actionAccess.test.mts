import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { timelineMutationContext, withTimelineMutationContext } from '../timeline/mutationContext';
const writes: any[] = [];
const provenance: any[] = [];
const run = async () => withTimelineMutationContext('owner', 'action', async () => {
  provenance.push(timelineMutationContext('owner'));
  writes.push('action'); return { ok: true, status: 'ok', result: { saved: true }, opsUsed: 1, durationMs: 1 };
});
mock.module('../actions/execute', { namedExports: { runAction: run, inspectActionProgram: async () => ({ ok: true, id: 'action', name: 'Read workspace', actionKey: 'read' }) } });
mock.module('../things/things', { namedExports: {
  createThing: async (ownerId: string, input: any) => { provenance.push(timelineMutationContext(ownerId)); writes.push(input); return { ok: true, doc: input }; },
  toPublicThings: async (docs: any[]) => docs.map(doc => ({ ...doc, id: 'created' }))
} });
for (const path of ['../things/search', '../components/browse', '../webpages/webpages', '../webpages/suites']) mock.module(path, { namedExports: {} });
const { createLopuToolContext, runLopuTool, stableInputHash } = await import('./chatTools');
const viewer = { id: 'owner', username: 'owner' };
test('Ask blocks every Action, including reads, and consumes exactly one approval', async () => {
  writes.length = 0;
  const events: any[] = [];
  const ctx = createLopuToolContext(viewer, {}, event => events.push(event));
  const call = { id: 'one', name: 'run_action', input: { action: 'read', inputs: {} } };
  assert.equal((await runLopuTool(call, ctx)).needsConfirmation, true);
  assert.equal(writes.length, 0);
  const approved = createLopuToolContext(viewer, {}, () => {}, { approved: [{ key: `run_action:action:${stableInputHash({})}`, tool: 'run_action', summary: 'Read' }] });
  assert.equal((await runLopuTool(call, approved)).ok, true);
  assert.equal((await runLopuTool(call, approved)).needsConfirmation, true);
  assert.equal(writes.length, 1);
});
test('Full access executes writes without cards; switching to Ask affects the next tool', async () => {
  writes.length = 0;
  let mode: 'ask' | 'full' = 'full';
  const events: any[] = [];
  const ctx = createLopuToolContext(viewer, {}, event => events.push(event), { readAccessMode: async () => mode });
  const call = { id: 'folder', name: 'create_thing', input: { title: 'Garden', type: 'folder', accessMode: 'full' } };
  assert.equal((await runLopuTool(call, ctx)).ok, true);
  assert.equal(events.some(event => event.type === 'confirm'), false);
  mode = 'ask';
  assert.equal((await runLopuTool(call, ctx)).needsConfirmation, true);
  assert.equal(writes.length, 1);
  const other = createLopuToolContext(viewer, { route: 'full access' }, () => {});
  assert.equal((await runLopuTool(call, other)).needsConfirmation, true, 'tool input/context cannot grant access');
});
test('scheduled read-only work stays read-only in Full access', async () => {
  const ctx = createLopuToolContext(viewer, {}, () => {}, { readOnly: true, readAccessMode: async () => 'full' });
  assert.equal((await runLopuTool({ id: 'x', name: 'create_thing', input: { title: 'Garden', type: 'folder' } }, ctx)).ok, false);
});

test('only executed AI tools carry trusted provenance; inputs cannot replace their source or operation', async () => {
  provenance.length = 0;
  const ctx = createLopuToolContext(viewer, {}, () => {}, { readAccessMode: async () => 'full' });
  assert.equal((await runLopuTool({ id: 'create', name: 'create_thing', input: {
    title: 'Garden', type: 'folder', source: 'system', operationId: 'forged', actorId: 'other'
  } }, ctx)).ok, true);
  assert.equal((await runLopuTool({ id: 'action', name: 'run_action', input: { action: 'read', inputs: {} } }, ctx)).ok, true);
  assert.deepEqual(provenance.map(item => [item.actorId, item.source]), [['owner', 'ai'], ['owner', 'ai']]);
  assert.notEqual(provenance[0].operationId, 'forged');
  assert.notEqual(provenance[0].operationId, provenance[1].operationId);
  const before = provenance.length;
  const ask = createLopuToolContext(viewer, {}, () => {});
  assert.equal((await runLopuTool({ id: 'ask', name: 'create_thing', input: { title: 'Garden', type: 'folder' } }, ask)).needsConfirmation, true);
  assert.equal(provenance.length, before);
  assert.equal(timelineMutationContext('owner'), null);
});
