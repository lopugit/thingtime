import test from 'node:test';
import assert from 'node:assert/strict';
import { importTransfer } from './importTransfer';
import { exportTransferPlan } from './exportTransfer';
import { readTransferAlgorithm } from './algorithmTransfer';
import { TRANSFER_FORMAT, type ThingTransfer } from '../../../utils/thingTransfer/format';

const fixture = (): ThingTransfer => ({ format: TRANSFER_FORMAT, version: 1, roots: ['source'], files: [], things: [{
  id: 'source', thingtime: ['feed-algorithm'], crystal: { name: 'Interest profile', emoji: '🧠', weights: { types: { text: 4 }, tags: {}, authors: {} }, eventCount: 2, lastTrainedAt: null }
}] });

test('algorithm snapshots use fresh dedicated IDs and compensate through the dedicated writer', async () => {
  const removed: string[] = [];
  const deps: any = {
    createAlgorithm: async (owner: string, thing: unknown) => { assert.equal(owner, 'recipient'); assert.deepEqual(thing, fixture().things[0]); return { ok: true, algorithm: { id: 'fresh' } }; },
    removeAlgorithm: async (_owner: string, id: string) => { removed.push(id); return { ok: true }; },
    create: async () => ({ ok: false, status: 409, error: 'quota' }),
    remove: async () => { throw new Error('Wrong cleanup writer'); }
  };
  const result = await importTransfer({ id: 'recipient' }, { manifest: fixture() }, undefined, deps);
  assert.ok(result.ok); if (result.ok) assert.deepEqual(result.roots, ['fresh']);
  const mixed = fixture(); mixed.things.push({ id: 'note', thingtime: ['data'], crystal: { name: 'note' } });
  assert.equal((await importTransfer({ id: 'recipient' }, { manifest: mixed }, undefined, deps)).ok, false);
  assert.deepEqual(removed, ['fresh']);
  const forged = fixture(); forged.things[0].crystal.shared = true;
  assert.equal((await importTransfer({ id: 'recipient' }, { manifest: forged }, undefined, deps)).ok, false);
});

test('anonymous readers cannot use full algorithm snapshots, including shared-preview IDs', async () => {
  assert.equal(await readTransferAlgorithm(undefined, 'shared-preview'), null);
  const denied = await exportTransferPlan(null, { ids: ['shared-preview'] }, undefined, { read: async () => null, readTheme: async () => null });
  assert.equal(denied.ok, false);
});

test('algorithm export uses the dedicated owner read even when generic Thing projection exists', async () => {
  const result = await exportTransferPlan({ id: 'owner' }, { ids: ['source'] }, undefined, {
    read: async () => ({ thingtime: ['feed-algorithm'] }) as any,
    readAlgorithm: async (owner, id) => { assert.equal(owner, 'owner'); assert.equal(id, 'source'); return fixture().things[0]; },
    project: async () => { throw new Error('Private weights need their dedicated projection'); },
    bound: async () => []
  });
  assert.ok(result.ok); if (result.ok) assert.deepEqual(result.plan.things, fixture().things);
});
