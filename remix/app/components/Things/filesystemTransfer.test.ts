import assert from 'node:assert/strict';
import test from 'node:test';
import { transferFilesystem, type FilesystemTransferPort } from './filesystemTransfer';
import type { FileClipboard } from './filesystemClient';
import { contentPartPlan } from '~/fileSync/contentFingerprint';
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

test('native file copies preserve Blob handles beyond paired-device buffer limits', async () => {
  const { port, calls } = fixture();
  const bytes = new Uint8Array(1024 * 1024), blobs = new Map<string, File>();
  const items = ['large-one', 'large-two'].map(id => {
    const blob = new File(Array.from({ length: 70 }, () => bytes), `${id}.bin`);
    blobs.set(id, blob);
    return { ...file(id), crystal: { name: blob.name, size: blob.size } };
  });
  const written: File[] = [];
  port.read = async item => blobs.get(item.id)!;
  port.write = async (_destination, blob) => { written.push(blob); };
  await transferFilesystem({ ...source(items), mode: 'copy' }, { folderId: 'other' }, port);
  assert.deepEqual(written, [...blobs.values()]);
  assert.equal(written[0], blobs.get('large-one'));
  assert.equal(written[1], blobs.get('large-two'));
  assert.deepEqual(calls, []);
  await assert.rejects(transferFilesystem({ ...source(items), mode: 'copy' }, { deviceId: 'mac', path: '' }, port), /Paired-device transfers/);
});

test('a canonical sync file uses its versioned content size and stays intact if destination write fails', async () => {
  const { port, calls } = fixture();
  const synced = { ...file('one'), thingtime: ['file'], crystal: { name: 'one.txt', content: { size: 3 }, trashed: false } };
  port.write = async () => { throw Error('destination refused'); };
  await assert.rejects(transferFilesystem(source([synced]), { deviceId: 'mac', path: '' }, port), /destination refused/);
  assert.deepEqual(calls, ['read:one']);
});

test('Files shows active canonical files, excludes trashed canonical files, and keeps ordinary attachments', async () => {
  const { isFilesystemItem } = await import('./filesystemCloudFile');
  const ordinary = file('ordinary');
  const canonical = { ...ordinary, thingtime: ['file'], crystal: { trashed: false } };
  assert.equal(isFilesystemItem(ordinary), true);
  assert.equal(isFilesystemItem(canonical), true);
  assert.equal(isFilesystemItem({ ...canonical, crystal: { trashed: true } }), false);
});

test('publishing a browser upload pins ready attachment bytes and recovers an uncertain commit by operation ID', async t => {
  const { publishFilesystemUpload } = await import('./filesystemCloudFile');
  const version = 'a'.repeat(64);
  let command: any;
  const requests: string[] = [];
  const mockedFetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    const target = new URL(String(url), 'https://example.test');
    requests.push(options?.method + ' ' + target.pathname);
    assert.equal(new Headers(options?.headers).get('X-Thingtime-Expected-Actor'), 'owner');
    if (target.pathname.endsWith('/content')) {
      assert.equal(target.searchParams.get('id'), 'upload');
      assert.equal(target.searchParams.get('fingerprint'), '1');
      return Response.json({ version });
    }
    if (options?.method === 'POST') {
      command = JSON.parse(String(options.body));
      assert.equal(command.folderId, 'sync-folder');
      assert.equal(command.attachmentId, 'upload');
      assert.equal(command.contentVersion, version);
      assert.equal(command.expectedRevision, null);
      throw new TypeError('Connection dropped after commit');
    }
    assert.equal(target.searchParams.get('id'), command.id);
    assert.equal(target.searchParams.get('operationId'), command.operationId);
    return Response.json({ receipt: { file: {
      id: command.id, name: command.name, folderId: command.folderId, revision: 'revision', trashed: false,
      content: { attachmentId: 'upload', version, size: 3, fingerprint: { algorithm: 'sha256-parts-v1', ...contentPartPlan(3), sha256: version } }
    } } });
  });
  try {
    await publishFilesystemUpload('owner', 'upload', 'fixture.txt', 'sync-folder', new AbortController().signal);
    assert.deepEqual(requests, ['GET /api/v1/attachments/content', 'POST /api/v1/files', 'GET /api/v1/files']);
  } finally {
    mockedFetch.mock.restore();
  }
});

test('sync destination lookup walks owned folders once per operation and refuses unknown or foreign folders', async () => {
  const { createSyncDestinationLookup } = await import('./filesystemCloudFile');
  const config = {
    ...file('sync'), thingtime: ['file-sync'], author: { id: 'owner' }, acl: ['tt:user'],
    crystal: {
      configurationVersion: 1, name: 'Folder sync', deviceId: 'mac', localRootId: 'local',
      remoteFolderId: 'sync-root', mode: 'two-way', paused: false, propagateDeletes: false,
      network: 'any', chargingOnly: false, excludedPaths: []
    }
  };
  const folder = (id: string, owner = 'owner', parent: string | null = null) =>
    ({ ...file(id, true), author: { id: owner }, folderId: parent } as ThingsThing);
  const folders = new Map([
    ['sync-root', folder('sync-root')],
    ['nested', folder('nested', 'owner', 'sync-root')],
    ['ordinary', folder('ordinary')],
    ['wrong-root', folder('wrong-root')],
    ['foreign', folder('foreign', 'different-owner', 'sync-root')]
  ]);
  let pageReads = 0;
  const folderReads: string[] = [];
  const isSync = createSyncDestinationLookup('owner', new AbortController().signal, {
    async configurations() {
      pageReads++;
      return { things: [config, { ...config, author: { id: 'different-owner' }, crystal: { ...config.crystal, remoteFolderId: 'wrong-root' } }] };
    },
    async folder(id) { folderReads.push(id); return folders.get(id) ?? null; }
  });
  assert.equal(await isSync('nested'), true);
  assert.equal(await isSync('nested'), true);
  assert.equal(await isSync('sync-root'), true);
  assert.equal(await isSync('ordinary'), false);
  assert.equal(await isSync('wrong-root'), false);
  await assert.rejects(isSync('foreign'), /folder is unavailable/);
  await assert.rejects(isSync('missing'), /folder is unavailable/);
  assert.equal(pageReads, 1);
  assert.deepEqual(folderReads, ['nested', 'sync-root', 'ordinary', 'wrong-root', 'foreign', 'missing']);
});

test('canonical Trash refuses a stale selected revision and commits current bytes under the original file ID', async t => {
  const { relocateCloudFilesystemFile } = await import('./filesystemCloudFile');
  const origin = 'https://filesystem-test.invalid';
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { value: { location: { origin } }, configurable: true });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  const id = '624b0e7e-df2c-4d07-ae79-38a1db097911';
  const version = 'a'.repeat(64);
  const record = {
    id, name: 'one.txt', folderId: 'source', revision: 'current', trashed: false,
    content: { attachmentId: 'owned-upload', version, size: 3, fingerprint: { algorithm: 'sha256-parts-v1', ...contentPartPlan(3), sha256: version } }
  };
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const target = new URL(String(url), origin);
    if (target.pathname.startsWith('/.well-known/')) return Response.json({ origin, schemaVersion: 1, features: { 'api.files': { version: '1.9.0' } } });
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('X-Thingtime-Expected-Actor'), 'owner');
    assert.equal(headers.get('X-Thingtime-Expected-Data-Plane'), 'home');
    if (options?.method !== 'POST') {
      assert.equal(target.searchParams.get('id'), id);
      return Response.json({ file: record });
    }
    writes++;
    const command = JSON.parse(String(options.body));
    assert.equal(command.id, id);
    assert.equal(command.expectedRevision, 'current');
    assert.equal(command.attachmentId, 'owned-upload');
    assert.equal(command.contentVersion, version);
    assert.equal(command.folderId, 'source');
    assert.equal(command.trashed, true);
    return Response.json({ file: { ...record, trashed: true, revision: 'trash' } });
  });
  const selected = { ...file(id), thingtime: ['file'], timelineHeadId: 'stale' };
  const signal = new AbortController().signal;
  await assert.rejects(relocateCloudFilesystemFile(selected, 'owner', 'source', true, signal), /File changed/);
  assert.equal(writes, 0);
  await relocateCloudFilesystemFile({ ...selected, timelineHeadId: 'current' }, 'owner', 'source', true, signal);
  assert.equal(writes, 1);
});
