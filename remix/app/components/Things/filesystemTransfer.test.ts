import assert from 'node:assert/strict';
import test from 'node:test';
import { transferFilesystem, type FilesystemTransferPort } from './filesystemTransfer';
import type { FileClipboard } from './filesystemClient';
import type { ThingsThing } from './thingsCore';
const file = (id: string, folder = false): ThingsThing => ({ id, thingtime: [folder ? 'folder' : 'attachment'], crystal: { name: `${id}${folder ? '' : '.txt'}`, size: 3 }, updatedAt: '2026-09-21T00:00:00Z', createdAt: '2026-09-21T00:00:00Z', author: null, visibility: 'private', acl: [], targetId: null, folderId: null, extended: null, tags: [] });
const source = (items = [file('one')]): FileClipboard => ({ ownerId: 'owner', mode: 'cut', location: { folderId: 'source' }, items });
const fixture = () => {
  const calls: string[] = [];
  const port: FilesystemTransferPort = {
    list: async location => location.folderId === 'source' ? [file('one')] : [],
    read: async item => { calls.push(`read:${item.id}`); return new File(['abc'], String(item.crystal.name)); },
    write: async (_location, file) => { calls.push(`write:${file.name}`); },
    mkdir: async (_location, name) => { calls.push(`mkdir:${name}`); return { folderId: `new-${name}` }; },
    remove: async item => { calls.push(`remove:${item.id}`); }, check: () => {}
  };
  return { port, calls };
};
test('cross-location move removes a source only after destination completion and fresh source verification', async () => {
  const { port, calls } = fixture();
  await transferFilesystem(source(), { deviceId: 'mac', path: 'Destination' }, port);
  assert.deepEqual(calls, ['read:one', 'write:one.txt', 'remove:one']);
});
test('failed or cancelled writes never remove their source', async () => {
  for (const failure of [new Error('disk full'), new DOMException('Cancelled', 'AbortError')]) {
    const { port, calls } = fixture(); port.write = async () => { throw failure; };
    await assert.rejects(transferFilesystem(source(), { deviceId: 'mac', path: '' }, port), failure);
    assert.equal(calls.some(call => call.startsWith('remove:')), false);
  }
});
test('a changed source tree keeps every source after successful copy', async () => {
  const { port, calls } = fixture();
  port.list = async location => location.folderId === 'source' ? [{ ...file('one'), updatedAt: '2026-09-21T01:00:00Z' }] : [];
  await assert.rejects(transferFilesystem(source(), { deviceId: 'mac', path: '' }, port), /source changed/);
  assert.deepEqual(calls, ['read:one', 'write:one.txt']);
});
test('folder transfer preflights hidden children and removes cloud children before their parent', async () => {
  const { port, calls } = fixture(); const folder = file('folder', true);
  port.list = async location => location.folderId === 'source' ? [folder] : location.folderId === 'folder' ? [file('one')] : [];
  await transferFilesystem(source([folder]), { deviceId: 'mac', path: '' }, port);
  assert.deepEqual(calls, ['mkdir:folder', 'read:one', 'write:one.txt', 'remove:one', 'remove:folder']);
});
test('preflight refuses special files, uncopyable Things and nested selections before any write', async () => {
  for (const item of [{ ...file('link'), inode: { type: 'symlink' } }, { ...file('post'), thingtime: ['post'] }, { ...file('huge'), crystal: { name: 'huge', size: 33 * 1024 * 1024 } }] as ThingsThing[]) {
    const { port, calls } = fixture();
    await assert.rejects(transferFilesystem(source([item]), { deviceId: 'mac', path: '' }, port));
    assert.deepEqual(calls, []);
  }
});
test('case-insensitive destination conflicts do not overwrite or remove files', async () => {
  const { port, calls } = fixture(); port.list = async () => [{ ...file('other'), crystal: { name: 'ONE.txt', size: 3 } }];
  await assert.rejects(transferFilesystem(source(), { deviceId: 'mac', path: '' }, port), /already exists/);
  assert.deepEqual(calls, []);
});
test('same-origin moves use the canonical native operation and copies never remove', async () => {
  const { port, calls } = fixture(); port.nativeMove = async () => { calls.push('move'); };
  await transferFilesystem(source(), { folderId: 'other' }, port);
  assert.deepEqual(calls, ['move']); calls.length = 0;
  await transferFilesystem({ ...source(), mode: 'copy' }, { folderId: 'other' }, port);
  assert.deepEqual(calls, ['read:one', 'write:one.txt']);
});

test('copy into a cloud descendant is rejected before any destination is created', async () => {
  const { port, calls } = fixture();
  const parent = file('parent', true), child = file('child', true);
  port.list = async location => location.folderId === 'parent' ? [child] : [];
  await assert.rejects(transferFilesystem({ ...source([parent]), mode: 'copy' }, { folderId: 'child' }, port), /cannot be pasted into itself/);
  assert.deepEqual(calls, []);
});
