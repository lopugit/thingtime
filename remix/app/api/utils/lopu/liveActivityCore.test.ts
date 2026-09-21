import assert from 'node:assert/strict';
import test from 'node:test';
import { lopuActivityPushPayload, lopuActivityState, normalizeLopuActivityInput, type LopuActivityChat } from './liveActivityCore';

const chat = (chatId: string, management: 'server' | 'client' = 'server'): LopuActivityChat => ({ chatId, management, status: 'running' });
const task = (targetId: string, status: string, workflowStatus?: string) => ({ targetId, crystal: { status, workflowStatus } });

test('parallel chats aggregate; a workflow checkpoint is not completion', () => {
  assert.deepEqual(lopuActivityState([chat('a'), chat('b')], [task('a', 'completed', 'running'), task('b', 'running')]), { activeCount: 2, serverCount: 2, phase: 'running' });
  assert.deepEqual(lopuActivityState([chat('a'), chat('b')], [task('a', 'completed', 'completed'), task('b', 'running')]), { activeCount: 1, serverCount: 1, phase: 'running' });
  assert.deepEqual(lopuActivityState([chat('a'), chat('b')], [task('a', 'completed'), task('b', 'stopped')]), { activeCount: 0, serverCount: 0, phase: 'finished' });
});

test('server cannot end active client chats or infer completion from missing tasks', () => {
  assert.equal(lopuActivityState([chat('a', 'client'), chat('b')], [task('b', 'completed')]).activeCount, 1);
  assert.equal(lopuActivityState([chat('a')], []).activeCount, 1);
  assert.equal(lopuActivityState([chat('a')], [{ ...task('a', 'completed'), rootTaskId: 'older-root' }]).activeCount, 1);
  assert.equal(lopuActivityState([chat('a')], [task('a', 'needs-attention')]).phase, 'needs-attention');
});

test('APNs state has no private chat content and contains stale/end deadlines', () => {
  const state = lopuActivityState([chat('private-chat-id')], [task('private-chat-id', 'running')]);
  const payload = lopuActivityPushPayload(state, 10_000);
  assert.equal(payload.aps.event, 'update');
  assert.equal(payload.aps['stale-date'], 130);
  assert.doesNotMatch(JSON.stringify(payload), /private-chat-id/);
  const ended = lopuActivityPushPayload({ activeCount: 0, serverCount: 0, phase: 'finished' }, 20_000);
  assert.equal(ended.aps.event, 'end');
  assert.equal(ended.aps['dismissal-date'], 80);
});

test('registration bounds and validates tokens, IDs, states and membership', () => {
  const input = { activityId: 'activity', token: 'AB'.repeat(32), environment: 'production', chats: [chat('a'), chat('a')] };
  assert.equal(normalizeLopuActivityInput(input)?.chats.length, 1);
  assert.equal(normalizeLopuActivityInput(input)?.token, 'ab'.repeat(32));
  for (const change of [{ token: 'secret' }, { environment: 'other' }, { activityId: 'bad\nvalue' }, { chats: Array(101).fill(chat('a')) }, { chats: [{ ...chat('a'), status: 'complete' }] }]) assert.equal(normalizeLopuActivityInput({ ...input, ...change }), null);
});
