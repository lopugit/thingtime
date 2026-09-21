import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { Binary } from 'mongodb';
let registrations: any[] = [], tasks: any[] = [], sessions: any[] = [], filters: any[] = [], sent: any[] = [], deletions: any[] = [];
const cursor = (rows: any[]) => { const result = { sort: () => result, project: () => result, limit: () => result, toArray: async () => rows }; return result; };
const things = { find: (filter: any) => { filters.push(filter); return cursor(filter.thingtime === 'push-device' ? registrations : tasks); }, deleteMany: async () => {}, deleteOne: async (value: any) => {deletions.push(value);}, updateOne: async () => {} };
mock.module('../mongodb/collections.ts', { namedExports: { getHomeThingsCollection: async () => things, getSessionsCollection: async () => ({find: (filter: any) => {filters.push(filter); return cursor(sessions);}}) } });
mock.module('../notifications/apns.ts', { namedExports: { sendLiveActivityPush: async (...args: any[]) => {sent.push(args); return {status: 200, reason: null};} } });
const { refreshLopuLiveActivitiesForOwner } = await import('./liveActivity.ts');
const setup = () => {
  filters = []; sent = []; deletions = []; sessions = [{jti: 'session'}];
  registrations = [{shareId: 'registration', targetId: 'session', updatedAt: new Date(), secure: new Binary(Buffer.from('ab'.repeat(32))), crystal: {activityId: 'activity', environment: 'sandbox', topic: 'com.example.push-type.liveactivity', chats: [{chatId: 'chat', management: 'server', status: 'running'}]}}];
  tasks = [{targetId: 'chat', crystal: {status: 'completed', workflowStatus: 'completed'}}];
};

test('delivery queries owner/source/session boundaries and sends one aggregate terminal update', async () => {
  setup(); await refreshLopuLiveActivitiesForOwner('owner', 'scope');
  assert.equal(filters[0].ownerId, 'owner'); assert.equal(filters[0].taskScope, 'scope');
  assert.equal(filters[1].userId, 'owner'); assert.equal(filters[1].revokedAt, null);
  const taskFilter = filters.find(filter => filter.thingtime === 'lopu-background-task');
  assert.equal(taskFilter.ownerId, 'owner'); assert.equal(taskFilter.taskScope, 'scope');
  assert.deepEqual(taskFilter.rootTaskId, {$exists: false});
  assert.equal(sent.length, 1); assert.equal(sent[0][1].aps.event, 'end');
  assert.equal(sent[0][0].topic, 'com.example.push-type.liveactivity');
  assert.doesNotMatch(JSON.stringify(sent[0][1]), /chat|owner|scope|ab{10}/);
  assert.equal(deletions.length, 1);
});

test('revoked session cannot receive an activity push', async () => {
  setup(); sessions = []; await refreshLopuLiveActivitiesForOwner('owner', 'scope');
  assert.equal(sent.length, 0); assert.equal(deletions.length, 1);
});

test('unchanged progress is throttled but final state is always sent', async () => {
  setup(); tasks[0].crystal = {status: 'running'};
  registrations[0].activityLastState = JSON.stringify({activeCount: 1, serverCount: 1, phase: 'running'});
  registrations[0].activityLastPushedAt = new Date();
  await refreshLopuLiveActivitiesForOwner('owner', 'scope'); assert.equal(sent.length, 0);
  tasks[0].crystal = {status: 'completed'};
  await refreshLopuLiveActivitiesForOwner('owner', 'scope'); assert.equal(sent.length, 1);
});
