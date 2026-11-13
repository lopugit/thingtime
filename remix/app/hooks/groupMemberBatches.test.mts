import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyGroupMemberBatches } from './groupMemberBatches.ts';

const unknown = () => Object.assign(new Error('Interrupted response'), { outcome: 'unknown' });

test('a committed batch with an interrupted response is confirmed by exact group readback', async () => {
  const members = new Set<string>();
  const calls: string[][] = [];
  const result = await applyGroupMemberBatches({ id: 'group', addMemberIds: ['one', 'two'] }, {
    guard: () => {},
    submit: async body => { calls.push(body.addMemberIds || []); for (const id of body.addMemberIds || []) members.add(id); throw unknown(); },
    read: async () => ({ id: 'group', memberCount: members.size, members: [...members].map(id => ({ id })) })
  });
  assert.deepEqual(calls, [['one', 'two']]);
  assert.equal(result.membership.memberCount, 2);
});

test('an interrupted partial batch preserves the group without replaying missing members', async () => {
  const members = new Set(['one']);
  const calls: string[][] = [];
  await assert.rejects(applyGroupMemberBatches({ id: 'group', addMemberIds: ['one', 'two'] }, {
    guard: () => {},
    submit: async body => {
      calls.push(body.addMemberIds || []);
      throw unknown();
    },
    read: async () => ({ id: 'group', memberCount: members.size, members: [...members].map(id => ({ id })) })
  }), (error: any) => error.groupId === 'group');
  assert.deepEqual(calls, [['one', 'two']]);
});

test('a lost add response followed by another tab revoking does not undo the revocation', async () => {
  let calls = 0;
  await assert.rejects(applyGroupMemberBatches({ id: 'group', addMemberIds: ['one'] }, {
    guard: () => {},
    submit: async () => { calls++; throw unknown(); },
    read: async () => ({ id: 'group', memberCount: 0, members: [] })
  }), (error: any) => error.groupId === 'group');
  assert.equal(calls, 1);
});

test('a lost remove response followed by another tab adding does not undo the addition', async () => {
  let calls = 0;
  await assert.rejects(applyGroupMemberBatches({ id: 'group', removeMemberIds: ['one'] }, {
    guard: () => {},
    submit: async () => { calls++; throw unknown(); },
    read: async () => ({ id: 'group', memberCount: 1, members: [{ id: 'one' }] })
  }), (error: any) => error.groupId === 'group');
  assert.equal(calls, 1);
});

test('an account change during a pending request stops all further batches and readback', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let sameActor = true, submissions = 0, reads = 0;
  const work = applyGroupMemberBatches({ id: 'group', addMemberIds: Array.from({ length: 101 }, (_, n) => `member-${n}`) }, {
    guard: () => { if (!sameActor) throw new DOMException('Account changed', 'AbortError'); },
    submit: async () => { submissions++; await pending; return { membership: { id: 'group', memberCount: 100 } }; },
    read: async () => { reads++; return undefined; }
  });
  sameActor = false;
  release();
  await assert.rejects(work, { name: 'AbortError' });
  assert.equal(submissions, 1);
  assert.equal(reads, 0);
});

test('unavailable readback preserves an uncertain group for recovery', async () => {
  await assert.rejects(
    applyGroupMemberBatches({ id: 'group', addMemberIds: ['one'] }, {
      guard: () => {},
      submit: async () => { throw unknown(); },
      read: async () => undefined
    }),
    (error: any) => error.groupId === 'group' && /may be incomplete/.test(error.message)
  );
});
