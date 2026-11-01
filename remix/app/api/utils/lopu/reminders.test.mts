import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
let row: any, source: any, available: boolean, allowed: boolean, beforeCommit: () => void, emitted: any[], filterSeen: any;
const apply = (update: any) => { for (const [key, value] of Object.entries(update.$set || {})) { if (key.startsWith('crystal.')) row.crystal[key.slice(8)] = value; else row[key] = value; } };
const things = {
  async findOneAndUpdate(filter: any, update: any) {
    filterSeen = filter;
    if (filter.ownerId) {
      if (filter.ownerId !== row.ownerId || filter.shareId !== row.shareId || (filter.nextRunAt && !row.nextRunAt)) return null;
    } else { if (!available || !row.crystal.enabled) return null; available = false; }
    apply(update); return structuredClone(row);
  },
  async findOne(filter: any) { return source && source.ownerId === filter.ownerId && source.acl?.join() === 'tt:user' && !source.appId ? structuredClone(source) : null; },
  async updateOne(filter: any, update: any) {
    if (filter._id === 'source') return { matchedCount: source && !source.crystal.completed && source.acl.join() === 'tt:user' ? 1 : 0 };
    if (filter.lease !== row.lease || (filter['crystal.enabled'] && !row.crystal.enabled)) return { matchedCount: 0 };
    apply(update); return { matchedCount: 1 };
  },
  async insertOne(doc: any) { row = doc; }
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: { getHomeThingsCollection: async () => things } });
mock.module(new URL('../auth/users.ts', import.meta.url).href, { namedExports: { getUserNotificationPrefs: async () => ({ masters: { push: allowed } }) } });
mock.module(new URL('../things/things.ts', import.meta.url).href, { namedExports: { createThing: async (owner: string, value: any, _actor: any, _app: any, hooks: any) => { assert.deepEqual(value.acl, ['tt:user']); const doc = { shareId: 'private-data', ownerId: owner }; await hooks.afterInsert(doc, { transaction: true }); return { ok: true, doc }; } } });
mock.module(new URL('../notifications/notifications.ts', import.meta.url).href, { namedExports: { emitSystemNotificationOnce: async (input: any, id: string, checkpoint: any) => { beforeCommit(); if (!await checkpoint({ transaction: true })) return false; emitted.push({ ...input, id }); return true; } } });
const { runLopuReminders, createLopuReminder, setLopuReminderEnabled } = await import('./reminders');
beforeEach(() => {
  row = { _id: 'schedule', shareId: 'schedule', ownerId: 'owner', targetId: 'source', nextRunAt: new Date(Date.now() - 900_000), crystal: { title: 'Water the plants', description: 'A little water', enabled: true, everyMinutes: 5, delivery: 'normal' } };
  source = { _id: 'source', shareId: 'source', ownerId: 'owner', acl: ['tt:user'], updatedAt: new Date(), crystal: {} };
  available = true; allowed = true; beforeCommit = () => {}; emitted = [];
});
test('creation saves an ordinary private Thing and linked protected schedule in one transaction', async () => {
  const result = await createLopuReminder('owner', { title: 'Test', at: new Date(Date.now() + 300_000).toISOString() });
  assert.equal(result.ok, true); assert.equal(row.targetId, 'private-data'); assert.equal(row.storageClass, 'control'); assert.deepEqual(row.acl, ['tt:user']);
});
test('due recurring work sends once and moves beyond now', async () => {
  assert.deepEqual(await runLopuReminders(), { sent: 1, failed: 0 });
  assert.equal(emitted[0].recipientId, 'owner'); assert.ok(row.nextRunAt.getTime() > Date.now());
  assert.deepEqual(await runLopuReminders(), { sent: 0, failed: 0 });
});
test('one-off completion disables the schedule; it cannot resume without a new date', async () => {
  row.crystal.everyMinutes = null;
  assert.equal((await runLopuReminders()).sent, 1);
  assert.equal(row.nextRunAt, null); assert.equal(row.crystal.enabled, false);
  assert.equal((await setLopuReminderEnabled('owner', 'schedule', true)).ok, false);
});
test('muted, deleted, public and completed reminders do not send', async () => {
  allowed = false; assert.equal((await runLopuReminders()).sent, 0); assert.ok(row.nextRunAt.getTime() > Date.now());
  allowed = true;
  for (const change of [() => { source.acl = ['tt:all']; }, () => { source.acl = ['tt:user']; source.crystal.completed = true; }, () => { source = null; }]) {
    change(); available = true; row.crystal.enabled = true; assert.equal((await runLopuReminders()).sent, 0);
  }
  assert.equal(emitted.length, 0);
});
test('pause or completion racing the transaction prevents emission', async () => {
  beforeCommit = () => { row.crystal.enabled = false; };
  assert.equal((await runLopuReminders()).sent, 0);
  row.crystal.enabled = true; available = true; beforeCommit = () => { source.crystal.completed = true; };
  assert.equal((await runLopuReminders()).sent, 0);
});
test('other accounts cannot pause or resume a schedule', async () => {
  assert.equal((await setLopuReminderEnabled('intruder', 'schedule', false)).ok, false);
  assert.equal(filterSeen.ownerId, 'intruder'); assert.equal(row.crystal.enabled, true);
});
