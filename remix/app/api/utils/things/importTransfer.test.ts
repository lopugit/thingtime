import test from 'node:test';
import assert from 'node:assert/strict';
import { importTransfer, orderTransferImports } from './importTransfer';
import { TRANSFER_FORMAT, type ThingTransfer } from '../../../utils/thingTransfer/format';

const fixture = (): ThingTransfer => ({ format: TRANSFER_FORMAT, version: 1, roots: ['folder'], files: [], things: [
  { id: 'data', thingtime: ['data'], folderId: 'folder', crystal: { schemaId: 'schema', name: 'note', text: 'schema' }, extended: { custom: 42 } },
  { id: 'schema', thingtime: ['schema'], folderId: 'folder', crystal: { name: 'My schema' } },
  { id: 'folder', thingtime: ['folder'], crystal: { name: 'Folder' } }
] });

const harness = () => {
  const writes: any[] = [];
  const removed: string[] = [];
  let next = 0;
  return { writes, removed, deps: {
    uuid: () => `new-${++next}`,
    create: async (owner: string, input: any, viewer: any) => { writes.push({ owner, input, viewer }); return { ok: true, doc: { shareId: input.shareId } } as any; },
    remove: async (_viewer: any, id: any) => { removed.push(id); return { ok: true } as any; }
  } };
};

test('imports folders and schemas before dependent data, with private fresh ownership and preserved extended content', async () => {
  const { writes, deps } = harness();
  const original = fixture();
  const result = await importTransfer({ id: 'recipient' }, { manifest: original, folderId: 'destination' }, undefined, deps);
  assert.equal(result.ok, true);
  assert.deepEqual(writes.map((write) => write.input.thingtime[0]), ['folder', 'schema', 'data']);
  for (const write of writes) { assert.equal(write.owner, 'recipient'); assert.deepEqual(write.input.acl, ['tt:user']); assert.equal(write.viewer.id, 'recipient'); }
  assert.equal(writes[0].input.folderId, 'destination');
  assert.equal(writes[2].input.folderId, writes[0].input.shareId);
  assert.equal(writes[2].input.crystal.schemaId, writes[1].input.shareId);
  assert.equal(writes[2].input.crystal.text, 'schema');
  assert.deepEqual(writes[2].input.extended, { custom: 42 });
  assert.deepEqual(original, fixture());
});

test('rejects forged account records, caller ACL/owner fields, and unresolved structural cycles before writes', async () => {
  const { writes, deps } = harness();
  const managed = fixture(); managed.things[0].thingtime = ['user'];
  assert.equal((await importTransfer({ id: 'recipient' }, { manifest: managed }, undefined, deps)).ok, false);
  const forged = fixture(); Object.assign(forged.things[0], { ownerId: 'victim', acl: ['tt:all'] });
  assert.equal((await importTransfer({ id: 'recipient' }, { manifest: forged }, undefined, deps)).ok, false);
  const cycle = fixture(); cycle.things[0].targetId = 'schema'; cycle.things[1].targetId = 'data';
  assert.throws(() => orderTransferImports(cycle), /Circular/);
  assert.equal((await importTransfer({ id: 'recipient' }, { manifest: cycle }, undefined, deps)).ok, false);
  assert.equal(writes.length, 0);
});

test('failure cleans only newly created records in reverse order and reports failed cleanup', async () => {
  const { writes, removed, deps } = harness();
  const create = deps.create;
  deps.create = async (...args) => writes.length === 2 ? { ok: false, status: 403, error: 'quota denied' } : create(...args);
  const result = await importTransfer({ id: 'recipient' }, { manifest: fixture() }, undefined, deps);
  assert.equal(result.ok, false);
  assert.deepEqual(removed, writes.map((write) => write.input.shareId).reverse());
  const second = harness();
  const createForSecond = second.deps.create;
  second.deps.create = async (...args) => second.writes.length ? { ok: false, status: 403, error: 'quota denied' } : createForSecond(...args);
  second.deps.remove = async () => ({ ok: false, status: 503, error: 'cleanup unavailable' });
  const failed = await importTransfer({ id: 'recipient' }, { manifest: fixture() }, undefined, second.deps);
  assert.equal(failed.ok, false);
  assert.ok('remainingIds' in failed && Array.isArray(failed.remainingIds) && failed.remainingIds.length === 1);
});

test('file imports require distinct authorized ready uploads before any Thing writes', async () => {
  const { writes, deps } = harness();
  const manifest = fixture();
  manifest.files = [{ id: 'old-file', targetId: 'data', name: 'test.txt', mime: 'text/plain', path: 'files/000000', bytes: 4, sha256: 'a'.repeat(64) }];
  const absent = await importTransfer({ id: 'recipient' }, { manifest }, undefined, deps);
  assert.equal(absent.ok, false);
  const denied = await importTransfer({ id: 'recipient' }, { manifest, files: { 'old-file': 'foreign-upload' } }, undefined, {
    ...deps, inspectFiles: async () => ({ ok: false, status: 403, error: 'not your upload' })
  });
  assert.equal(denied.ok, false);
  assert.equal(writes.length, 0);
});

test('cancelled imports perform no writes and do not retry creation', async () => {
  const { writes, deps } = harness();
  const result = await importTransfer({ id: 'recipient' }, { manifest: fixture() }, AbortSignal.abort(new Error('cancelled')), deps);
  assert.equal(result.ok, false);
  assert.equal(writes.length, 0);
});
