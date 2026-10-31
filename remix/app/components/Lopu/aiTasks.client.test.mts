import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
const capabilities: Array<[string, string]> = [];
mock.module('~/api/utils/capabilities/requireCapability.client', { namedExports: { requireThingtimeCapability: async (feature: string, version: string) => { capabilities.push([feature, version]); } } });
const { bindAiTaskOwner, readAiTaskOutput, readAiTaskDiagnostics, refreshAiTasks } = await import('./aiTasks.client');

test('expired task output stops polling; transient failures, owner and scope changes can retry', async () => {
 let calls = 0, status = 410, scope = 'one';
 const fetchMock = mock.method(globalThis, 'fetch', async (url: any) => {
  if (!String(url).includes('?')) return Response.json({ ownerId: 'owner', contextKey: scope, tasks: [] });
  calls++; return new Response('{}', { status });
 });
 const task = { id: 'expired' } as any;
 try {
  bindAiTaskOwner('owner'); await refreshAiTasks();
  for (let i = 0; i < 5; i++) await readAiTaskOutput(task);
  assert.equal(calls, 1);
  await refreshAiTasks(); await readAiTaskOutput(task); assert.equal(calls, 1);
  scope = 'two'; await refreshAiTasks(); await readAiTaskOutput(task); assert.equal(calls, 2);
  bindAiTaskOwner('other'); await readAiTaskOutput(task); assert.equal(calls, 3);
  status = 503;
  await readAiTaskOutput({ id: 'temporary' } as any); await readAiTaskOutput({ id: 'temporary' } as any);
  assert.equal(calls, 5);
 } finally { fetchMock.mock.restore(); bindAiTaskOwner(null); }
});

test('diagnostics negotiate 1.4 and fence late owner/source changes through JSON parsing', async () => {
  let scope = 'diagnostic-scope', mode = 'okay'; let release: (() => void) | undefined;
  const task = { id: 'diagnostic-task' } as any;
  const fetchMock = mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    if (!String(url).includes('?')) return Response.json({ ownerId: 'owner', contextKey: scope, tasks: [] });
    assert.equal(init.headers['X-Thingtime-Task-Owner'], 'owner'); assert.equal(init.cache, 'no-store'); assert.match(String(url), /diagnostics=1/); assert.doesNotMatch(String(url), /offset=/);
    const body = { ownerId: mode === 'wrong-owner' ? 'other' : 'owner', contextKey: mode === 'wrong-scope' ? 'other' : scope, diagnostics: { taskId: mode === 'wrong-task' ? 'other-task' : task.id, workflowRunId: 'wrun_evidence' } };
    return { ok: true, json: async () => { if (mode === 'wait') await new Promise<void>(resolve => { release = resolve; }); return body; } } as Response;
  });
  try {
    bindAiTaskOwner('owner'); await refreshAiTasks(); assert.equal((await readAiTaskDiagnostics(task))?.workflowRunId, 'wrun_evidence');
    assert.deepEqual(capabilities.at(-1), ['api.lopu-background-tasks', '1.4.0']);
    for (const mismatch of ['wrong-owner', 'wrong-scope', 'wrong-task']) { mode = mismatch; assert.equal(await readAiTaskDiagnostics(task), null); }
    mode = 'wait'; const lateOwner = readAiTaskDiagnostics(task); while (!release) await new Promise(resolve => setImmediate(resolve)); bindAiTaskOwner('other'); release(); assert.equal(await lateOwner, null); release = undefined;
    bindAiTaskOwner('owner'); mode = 'okay'; await refreshAiTasks(); mode = 'wait'; const lateScope = readAiTaskDiagnostics(task);
    while (!release) await new Promise(resolve => setImmediate(resolve)); scope = 'new-scope'; await refreshAiTasks(); release(); assert.equal(await lateScope, null);
  } finally { fetchMock.mock.restore(); bindAiTaskOwner(null); }
});
