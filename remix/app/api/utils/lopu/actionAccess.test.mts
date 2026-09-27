import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
const writes: any[] = [];
let runFails = false;
const run = async () => { writes.push('action'); return { ok: true, status: runFails ? 'error' : 'ok', runId: 'run-1', error: runFails ? 'Second step failed' : undefined, result: { saved: true }, opsUsed: 1, durationMs: 1 }; };
let readable = true;
let inputs: Record<string, unknown>[] = [];
const inspected: any[] = [];
mock.module('../actions/execute', { namedExports: { runAction: run, inspectActionProgram: async (viewer: any, reference: string) => {
  inspected.push({ viewer, reference });
  return readable ? { ok: true, id: 'action', name: 'Read workspace', actionKey: 'read', runtime: 'browser', inputs, effects: { reads: ['data'] } } : { ok: false, status: 404, error: 'No runnable action matches' };
} } });
mock.module('../things/things', { namedExports: {
  createThing: async (_: string, input: any) => { writes.push(input); return { ok: true, doc: input }; },
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

test('saving attachments and extending schemas require approval and are denied in scheduled work', async () => {
  for (const call of [
    { id: 'save', name: 'save_attachment', input: { id: 'photo' } },
    { id: 'copy', name: 'create_schema', input: { name: 'Product', extends: 'post', fields: [] } }
  ]) {
    const events: any[] = [];
    const ctx = createLopuToolContext(viewer, {}, event => events.push(event));
    assert.equal((await runLopuTool(call, ctx)).needsConfirmation, true);
    assert.equal(events.filter(event => event.type === 'confirm').length, 1);
    const scheduled = createLopuToolContext(viewer, {}, () => {}, { readOnly: true, readAccessMode: async () => 'full' });
    assert.equal((await runLopuTool(call, scheduled)).ok, false);
  }
});


test('inspect_action reads the exact contract without execution/confirmation and reauthorizes each read', async () => {
  writes.length = 0;
  inspected.length = 0;
  inputs = [{ name: 'category', type: 'enum', required: true, values: ['Tool', 'Battery'] }];
  const events: any[] = [];
  const ctx = createLopuToolContext(viewer, {}, event => events.push(event), { readOnly: true });
  const inspect = (candidate?: object) => runLopuTool({ id: 'inspect', name: 'inspect_action', input: { action: 'saved-key', ...(candidate ? { inputs: candidate } : {}) } }, ctx);
  const result = await inspect();
  assert.equal(result.ok, true);
  assert.deepEqual((result.data as any).inputs, inputs);
  assert.equal((result.data as any).runtime, 'browser');
  assert.equal((result.data as any).inputsComplete, true);
  assert.equal((result.data as any).validation, undefined, 'inspection is not a run with empty inputs');
  const valid = await inspect({ category: 'Battery' });
  assert.deepEqual((valid.data as any).validation, { ok: true });
  const invalid = await inspect({ category: 'battery' });
  assert.deepEqual((invalid.data as any).validation, { ok: false, error: 'Input category must be one of Tool, Battery' });
  readable = false;
  const revoked = await inspect();
  assert.equal(revoked.ok, false);
  assert.equal(revoked.data, undefined);
  assert.ok(inspected.every(read => read.viewer === viewer && read.reference === 'saved-key'));
  assert.deepEqual(writes, []);
  assert.deepEqual(events, []);
  readable = true;
  inputs = [];
});

test('large contracts are explicitly incomplete with a lossless authorized read target', async () => {
  inputs = [{ name: 'program', type: 'json', default: { text: 'x'.repeat(9000) } }];
  const ctx = createLopuToolContext(viewer, {}, () => {});
  const result = await runLopuTool({ id: 'inspect', name: 'inspect_action', input: { action: 'saved-key' } }, ctx);
  const data = result.data as any;
  assert.equal(data.inputsComplete, false);
  assert.deepEqual(data.inputs, [{ name: 'program', type: 'json', required: undefined }]);
  assert.equal(data.inspection.id, 'action');
  assert.equal(data.inspection.path, '/inputs');
  assert.equal(data.inspection.offset, 0);
  assert.ok(JSON.stringify(data).length < 2000);
  inputs = [];
});

test('invalid declared inputs fail before asking for approval and a corrected run still needs approval', async () => {
  writes.length = 0;
  inputs = [{ name: 'category', type: 'enum', values: ['Tool', 'Battery'], required: true }];
  const events: any[] = [];
  const ctx = createLopuToolContext(viewer, {}, event => events.push(event));
  const runInput = (category: string) => runLopuTool({ id: 'save', name: 'run_action', input: { action: 'save', inputs: { category } } }, ctx);
  const bad = await runInput('battery');
  assert.equal(bad.ok, false);
  assert.equal(bad.needsConfirmation, undefined);
  assert.deepEqual(events, []);
  assert.deepEqual(writes, []);
  assert.equal((await runInput('Battery')).needsConfirmation, true);
  assert.deepEqual(writes, []);
  inputs = [];
});

test('partly failed Actions retain the run identity and warn against blindly replaying writes', async () => {
  runFails = true;
  const ctx = createLopuToolContext(viewer, {}, () => {}, { readAccessMode: async () => 'full' });
  const result = await runLopuTool({ id: 'save', name: 'run_action', input: { action: 'save', inputs: {} } }, ctx);
  assert.equal(result.ok, false);
  assert.equal((result.data as any).runId, 'run-1');
  assert.match((result.data as any).recovery, /Earlier steps may have completed/);
  runFails = false;
});
