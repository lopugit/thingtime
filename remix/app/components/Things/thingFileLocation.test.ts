import test from 'node:test';
import assert from 'node:assert/strict';
import { isUnfiledAttachment, resolveFileLocation, type LocationThing } from './fileLocationCore';
const file: LocationThing = { id: 'file', thingtime: ['file'], folderId: 'nested', crystal: { name: 'search.svg' } };
const nested: LocationThing = { id: 'nested', thingtime: ['folder'], folderId: 'home', crystal: { name: 'Icons' } };
const home: LocationThing = { id: 'home', thingtime: ['folder'], crystal: { title: 'Home' } };
const rows = new Map([file, nested, home].map(row => [row.id, row]));
const read = async (id: string) => rows.get(id) ?? null;
test('storage blob resolves exact authorized canonical file ancestry with containing-folder links', async () => {
  const result = await resolveFileLocation({ id: 'att', thingtime: ['attachment'], targetId: 'file' }, read);
  assert.equal(result.state, 'recorded');
  assert.deepEqual(result.segments.map(x => x.name), ['Home', 'Icons', 'search.svg']);
  assert.equal(result.segments[1].href, '/things?folder=nested');
  assert.equal(result.segments[2].href, '/thing/file');
});
test('unbound blob does not invent a folder from its filename', async () => {
  assert.deepEqual(await resolveFileLocation({ id: 'att', thingtime: ['attachment'], crystal: { name: '/Home/search.svg' } }, read), { state: 'unrecorded', segments: [] });
});
test('private/missing ancestry and cycles never publish partial or fabricated paths', async () => {
  assert.equal((await resolveFileLocation(file, async () => null)).state, 'unavailable');
  assert.equal((await resolveFileLocation(file, async id => id === 'nested' ? { ...nested, folderId: 'nested' } : null)).state, 'unavailable');
});
test('root file remains an actual recorded file path', async () => {
  const result = await resolveFileLocation({ ...file, folderId: null }, read);
  assert.equal(result.state, 'recorded');
  assert.deepEqual(result.segments.map(x => x.name), ['search.svg']);
});

test('recovery collection excludes explicitly filed attachments and bound blobs', async () => {
  const blob: LocationThing = { id: 'blob', thingtime: ['attachment'], targetId: null, folderId: null, crystal: { name: 'search.svg', contentType: 'application/octet-stream', mediaKind: 'file', size: 494 } };
  assert.equal(isUnfiledAttachment(blob), true);
  assert.equal(isUnfiledAttachment({ ...blob, targetId: 'file' }), false);
  assert.equal(isUnfiledAttachment({ ...blob, folderId: 'nested' }), false);
  const placed = await resolveFileLocation({ ...blob, folderId: 'nested' }, read);
  assert.equal(placed.state, 'recorded');
  assert.deepEqual(placed.segments.map(x => x.name), ['Home', 'Icons', 'search.svg']);
});

test('unpublished sync bytes display original recorded source separately from current folder paths', async () => {
  const blob: LocationThing = { id: 'att', thingtime: ['attachment'], fileSyncOrigin: { version: 1, deviceId: 'device', localRootId: 'local-root', cloudRootId: 'cloud-root', fileId: 'file', folderId: 'nested', path: 'Original/Icons/search.svg' } };
  const result = await resolveFileLocation(blob, read);
  assert.equal(result.state, 'origin');
  assert.equal(result.segments[0].name, 'Original/Icons/search.svg');
  assert.equal(result.segments[0].href, '/things?folder=nested');
  const published = await resolveFileLocation({ ...blob, targetId: 'file' }, read);
  assert.equal(published.state, 'recorded');
  assert.deepEqual(published.segments.map(x => x.name), ['Home', 'Icons', 'search.svg']);
});
