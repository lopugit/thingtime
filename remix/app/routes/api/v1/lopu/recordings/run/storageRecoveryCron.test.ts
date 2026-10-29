import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import type * as RecordingAutomationHandlers from './_run';
const order: string[] = [];
let storageFails = false;
let providerFails = false;
mock.module('~/api/utils/storage/userStorageRecovery', { namedExports: { runUserStorageRecovery: async () => { order.push('storage'); if (storageFails) throw new Error('private-driver-diagnostic'); return { ready: 1, pending: 0, blocked: 0, skipped: 0 }; } } });
mock.module('~/api/utils/lopu/recordingsWorker', { namedExports: { runRecordingAutomation: async () => { order.push('recordings'); if (providerFails) throw new Error('provider-unavailable'); return {}; } } });
mock.module('~/api/utils/lopu/recordingsReminders', { namedExports: { sendRecordingReminders: async () => { order.push('reminders'); return {}; } } });
mock.module('~/api/utils/lopu/reminders', { namedExports: { runLopuReminders: async () => ({}) } });
mock.module('~/api/utils/lopu/recordingHandoff', { namedExports: { runRecordingHandoffs: async () => ({}) } });
mock.module('~/api/utils/auth/requireAdmin', { namedExports: { requireAdmin: async () => ({ error: { status: 403, message: 'Forbidden' } }) } });
mock.module('~/api/utils/attachments/attachmentResponses', { namedExports: { isSameOriginAttachmentRequest: () => false } });
mock.module('~/api/utils/mongodb/endpoint', { namedExports: { runWithMongoEndpoint: (_selection: unknown, run: () => unknown) => run() } });
let loader: typeof RecordingAutomationHandlers.loader;
let action: typeof RecordingAutomationHandlers.action;
before(async () => { ({ loader, action } = await import('./_run.tsx')); });
const previous = process.env.CRON_SECRET;
process.env.CRON_SECRET = 'synthetic-cron-secret';
after(() => { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; });
const request = (authorization?: string, method = 'GET') => new Request('https://thingtime.example/api/v1/lopu/recordings/run', { method, headers: authorization ? { authorization } : {} });

test('storage scheduler preserves exact cron-secret and admin/origin authorization gates', async () => {
  for (const header of [undefined, 'synthetic-cron-secret', 'Bearer synthetic-cron-secret-extra']) {
    assert.equal((await loader({ request: request(header) })).status, 401);
  }
  assert.equal((await action({ request: request(undefined, 'POST') })).status, 403);
  assert.deepEqual(order, []);
});
test('storage runs before provider work; its failure is sanitized and cannot starve existing workers', async () => {
  order.length = 0; storageFails = true; providerFails = false;
  const response = await loader({ request: request('Bearer synthetic-cron-secret') });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const body = await response.json();
  assert.deepEqual(body.storageRecovery, { unavailable: true });
  assert.deepEqual(order, ['storage', 'reminders', 'recordings']);
  assert.equal(JSON.stringify(body).includes('private-driver'), false);
});
test('an unrelated provider failure cannot prevent durable storage recovery', async () => {
  order.length = 0; storageFails = false; providerFails = true;
  await assert.rejects(loader({ request: request('Bearer synthetic-cron-secret') }), /provider-unavailable/);
  assert.deepEqual(order, ['storage', 'reminders', 'recordings']);
});
