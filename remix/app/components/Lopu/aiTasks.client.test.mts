import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
mock.module('~/api/utils/capabilities/requireCapability.client', { namedExports: { requireThingtimeCapability: async () => {} } });
const { bindAiTaskOwner, readAiTaskOutput, refreshAiTasks } = await import('./aiTasks.client');

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
