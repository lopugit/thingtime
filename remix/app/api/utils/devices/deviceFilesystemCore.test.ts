import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFilesystemInput, normalizeFilesystemResult, filesystemPath } from './deviceFilesystemCore';
import { deviceSupportsCommand, normalizeDeviceCommand } from './deviceCore';
test('filesystem paths cannot escape the device home or target upload scratch', () => {
  for (const path of ['/etc/passwd', '../secrets', 'a/../b', 'a//b', './a', 'a\\b', 'a\0b', '.thingtime-upload-anything']) assert.equal(filesystemPath(path), false, path);
  for (const path of ['', 'Documents', 'Documents/hello world.txt', 'Desktop/🌈.txt']) assert.equal(filesystemPath(path), true, path);
});
test('closed filesystem commands require a negotiated device capability', () => {
  assert.equal(deviceSupportsCommand('filesystem', []), false);
  assert.equal(deviceSupportsCommand('filesystem', ['filesystem.v1']), true);
  assert.equal(normalizeDeviceCommand('filesystem', { op: 'list', path: '', hidden: false }).ok, true);
  for (const input of [{ op: 'list', path: '', shell: 'ls' }, { op: 'list', path: '', cursor: -1 }, { op: 'read', path: 'a', offset: 0 },
    { op: 'move', path: 'a', destination: 'a/b', version: '1:2' }, { op: 'trash', path: '.Trash/a', version: '1:2' }]) assert.equal(normalizeFilesystemInput(input), null);
});
test('chunk framing refuses oversized, malformed and mismatched writes/results', () => {
  const write = { op: 'write', path: 'a', transferId: '11111111-1111-1111-1111-111111111111', offset: 0, total: 3, sha256: 'a'.repeat(64), data: 'YWJj' } as const;
  assert.deepEqual(normalizeFilesystemInput(write), write);
  for (const patch of [{ data: 'not-base64' }, { total: 2 }, { offset: -1 }, { sha256: 'x'.repeat(64) }, { data: 'AAAA'.repeat(30_000) }]) assert.equal(normalizeFilesystemInput({ ...write, ...patch }), null);
  assert.ok(normalizeFilesystemResult(write, { path: 'a', offset: 3, complete: true }));
  assert.equal(normalizeFilesystemResult(write, { path: 'a', offset: 3, complete: false }), null);
  assert.equal(normalizeFilesystemResult({ op: 'read', path: 'a', offset: 0, version: '1:2' }, { data: 'YWJj', offset: 0, size: 4, version: '1:2' }), null);
});
test('directory results cannot invent paths or inject extra fields', () => {
  const input = { op: 'list', path: 'Documents' } as const;
  const entry = { path: 'Documents/a', name: 'a', type: 'file', inode: '1:2', version: '1:2:3', size: 3, modifiedAt: '2026-09-21T00:00:00Z' };
  assert.ok(normalizeFilesystemResult(input, { path: 'Documents', entries: [entry], nextCursor: null }));
  for (const patch of [{ path: '/etc/passwd' }, { name: '../a' }, { token: 'secret' }]) assert.equal(normalizeFilesystemResult(input, { path: 'Documents', entries: [{ ...entry, ...patch }], nextCursor: null }), null);
  assert.equal(normalizeFilesystemResult(input, { path: 'Documents', entries: [entry, entry], nextCursor: null }), null);
});

test('file payloads stay out of command histories while exact reads respect expiry', async () => {
  const { publicDeviceCommand, deviceSessionSendRedactionFields } = await import('./deviceCommands');
  const now = new Date();
  const doc = { shareId: 'command', targetId: 'device', createdAt: now, updatedAt: now,
    crystal: { kind: 'filesystem', input: { op: 'write', data: 'YWJj', path: 'private.txt' }, result: { path: 'private.txt', offset: 3, complete: true }, resultExpiresAt: new Date(now.getTime() + 600_000) } };
  assert.equal(publicDeviceCommand(doc).input.data, undefined);
  assert.equal(publicDeviceCommand(doc).result, undefined);
  assert.deepEqual(publicDeviceCommand(doc, true).result, doc.crystal.result);
  assert.equal(publicDeviceCommand({ ...doc, crystal: { ...doc.crystal, resultExpiresAt: now } }, true).result, undefined);
  assert.equal(deviceSessionSendRedactionFields(doc, now)['crystal.input.data'], '');
});

test('capability refresh participates in the full monotonic snapshot hash', async () => {
  const { deviceSnapshotHash, decideDeviceRevision, normalizeDeviceState } = await import('./deviceCore');
  const state = normalizeDeviceState({ locked: false, volume: null, brightness: null, openApps: [] })!;
  const before = deviceSnapshotHash(state, [], ['system.volume.write']);
  const after = deviceSnapshotHash(state, [], ['system.volume.write', 'system.brightness.write', 'filesystem.v1']);
  assert.notEqual(before, after);
  assert.equal(decideDeviceRevision(10, before, 9, after), 'stale');
  assert.equal(decideDeviceRevision(10, before, 10, after), 'conflict');
  assert.equal(decideDeviceRevision(10, before, 11, after), 'update');
  assert.equal(decideDeviceRevision(11, after, 11, after), 'same');
});
