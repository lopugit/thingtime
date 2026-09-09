import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
const saved: any[] = [];
let home = false;
mock.module(new URL('../mongodb/endpoint.ts', import.meta.url).href, { namedExports: {
  runWithMongoEndpoint: async (endpoint: unknown, work: any) => {
    assert.equal(endpoint, null); home = true;
    try { return await work(); } finally { home = false; }
  }
} });
mock.module(new URL('../notifications/notifications.ts', import.meta.url).href, { namedExports: {
  emitSystemNotificationOnce: async (input: any, id: string) => { assert.equal(home, true); saved.push({ input, id }); return true; }
} });
const { createLopuToolContext, runLopuTool } = await import('./chatTools');
test('notification tools use the home account and scope deduplication to each chat request', async () => {
  const viewer = { id: 'owner', username: 'owner' };
  const call = { id: 'provider-reused-id', name: 'send_notification', input: { title: 'Test', recipientId: 'other' } };
  const missing = createLopuToolContext(viewer, {}, () => {});
  assert.equal((await runLopuTool(call, missing)).ok, false); assert.equal(saved.length, 0);
  for (const requestScope of ['chat:one', 'chat:one', 'chat:two']) {
    const context = createLopuToolContext(viewer, {}, () => {}, { requestScope });
    assert.equal((await runLopuTool(call, context)).ok, true);
  }
  assert.equal(saved[0].input.recipientId, 'owner');
  assert.equal(saved[0].id, saved[1].id);
  assert.notEqual(saved[0].id, saved[2].id);
});
