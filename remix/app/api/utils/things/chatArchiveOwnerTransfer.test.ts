import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteOwnedChatArchive } from './chatArchiveOwnerTransfer';

const input = { actorKind: 'user', accountKind: 'user', ownerId: 'owner', sameOrigin: true, id: 'archive', expectedUpdatedAt: '2026-09-12T00:00:00.000Z' };
const harness = () => {
  const state = { reads: 0, removals: [] as unknown[], root: { shareId: 'archive' } as any };
  return { state, deps: {
    custom: () => false,
    collection: async () => ({ findOne: async (filter: unknown, options: unknown) => {
      state.reads++;
      assert.deepEqual(filter, { shareId: 'archive', ownerId: 'owner', archiveRootId: 'archive', archiveVersion: 1, thingtime: ['chat-archive'] });
      assert.deepEqual(options, { projection: { shareId: 1, appId: 1, sandbox: 1, sandboxSpace: 1 } });
      return state.root;
    } }) as any,
    remove: async (...args: unknown[]) => { state.removals.push(args); return { ok: true as const, deleted: 4 }; }
  } };
};

test('first-party owner archive deletion forwards the preview fence to the dedicated lifecycle', async () => {
  const { state, deps } = harness();
  assert.deepEqual(await deleteOwnedChatArchive(input, deps), { ok: true });
  assert.deepEqual(state.removals, [['owner', 'archive', input.expectedUpdatedAt]]);
});

test('PATs, apps, service accounts, cross-origin and custom planes cannot enter archive deletion', async () => {
  for (const overrides of [{ actorKind: 'pat' }, { actorKind: 'app' }, { actorKind: 'anonymous' },
    { accountKind: 'service' }, { sameOrigin: false }, { ownerId: '' }, { id: '../archive' }]) {
    const { state, deps } = harness();
    assert.equal(await deleteOwnedChatArchive({ ...input, ...overrides }, deps), null);
    assert.equal(state.reads, 0); assert.deepEqual(state.removals, []);
  }
  const { state, deps } = harness(); deps.custom = () => true;
  assert.equal(await deleteOwnedChatArchive(input, deps), null); assert.equal(state.reads, 0);
});

test('ordinary or missing Things and namespace-stamped roots stay outside the archive lifecycle', async () => {
  for (const root of [null, { shareId: 'archive', appId: 'app' }, { shareId: 'archive', sandbox: false }, { shareId: 'archive', sandboxSpace: '' }]) {
    const { state, deps } = harness(); state.root = root;
    assert.equal(await deleteOwnedChatArchive(input, deps), null); assert.deepEqual(state.removals, []);
  }
});

test('cleanup failures are recoverable and never expose provider details', async () => {
  for (const status of [400, 409, 503, undefined]) {
    const { deps } = harness();
    deps.remove = async () => { throw { status, error: 'private-object-key-and-provider-secret' }; };
    const result = await deleteOwnedChatArchive(input, deps);
    assert.ok(result && result.ok === false); assert.equal(result.status, status || 503);
    assert.doesNotMatch(JSON.stringify(result), /private-object|provider-secret/);
  }
});
