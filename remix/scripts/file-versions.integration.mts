// Opt-in real HTTP + object-storage acceptance using a disposable local account.
// Pass a mode-0600 fixture path, never credentials on the command line.
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { parseTimelineEntry } from '../app/timeline/contract';
import { parseCloudInventory } from '../app/fileSync/cloudInventory';
import { cloudFileSyncEntry } from '../app/fileSync/cloudFile';
const path = process.argv[2];
if (!path || ((await stat(path)).mode & 0o077)) throw Error('Pass a private mode-0600 test fixture');
const fixture = JSON.parse(await readFile(path, 'utf8'));
const base = new URL(fixture.base);
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname) || base.username || base.password || base.origin !== fixture.base) throw Error('Use a canonical local test origin');
const cookies = new Map<string, string>();
async function call(route: string, body?: unknown, authenticated = true, method = body === undefined ? 'GET' : 'POST') {
	const response = await fetch(base.origin + route, { method, redirect: 'error', signal: AbortSignal.timeout(30_000),
		headers: { Accept: 'application/json', Origin: base.origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
			...(authenticated ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
	if (authenticated) for (const header of response.headers.getSetCookie()) { const pair = header.split(';')[0], i = pair.indexOf('='); cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
	const data = await response.json(); return { response, data };
}
async function ok(route: string, body?: unknown) {
	const result = await call(route, body);
	if (!result.response.ok || result.data.ok === false) throw Error(`${route.split('?')[0]} refused (${result.response.status}): ${String(result.data.error || 'request failed').slice(0, 240)}`);
	return result.data;
}
const uploaded: { id: string; version: string; bytes: Buffer }[] = [];
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function upload(bytes: Buffer) {
 const start = await ok('/api/v1/attachments/uploads', { requestId: randomUUID(), filename: 'sync-version-fixture.bin', contentType: 'application/octet-stream', sizeBytes: bytes.length, purpose: 'file' });
 const id = start.upload.id;
 const signed = await ok('/api/v1/attachments/uploads/parts', { uploadId: id, parts: [{ partNumber: 1, checksumSha256: createHash('sha256').update(bytes).digest('base64') }] });
 const target = new URL(signed.parts[0].url, base); assert.ok(target.protocol === 'https:' || target.origin === base.origin);
 assert.equal((await fetch(target, { method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(30_000), headers: signed.parts[0].headers, body: bytes })).ok, true);
 await ok('/api/v1/attachments/uploads/complete', { uploadId: id });
 const receipt = await ok(`/api/v1/attachments/content?id=${id}&fingerprint=1`);
 const file = { id, version: receipt.version, bytes }; uploaded.push(file); return file;
}
let latest: any = null, signedIn = false, folderId: string | null = null;
const inventoryFixtures: string[] = [];
const id = randomUUID();
try {
 const discovery = await ok('/.well-known/thingtime-capabilities.json'); assert.equal(discovery.features['api.files'].version, '1.2.0');
 await ok('/api/v1/login', { username: fixture.username, password: fixture.password }); signedIn = true;
 assert.equal((await ok('/api/v1/auth/me')).user.id, fixture.userId);
 const a = await upload(Buffer.alloc(128, 11)), b = await upload(Buffer.alloc(257, 22));
 const create = { id, operationId: randomUUID(), expectedRevision: null, name: 'sync-version-fixture.bin', folderId: null, attachmentId: a.id, contentVersion: a.version, trashed: false };
 const initial = await ok('/api/v1/files', create); latest = initial.file; assert.equal(initial.replayed, false);
 const replacement = { ...create, operationId: randomUUID(), expectedRevision: latest.revision, attachmentId: b.id, contentVersion: b.version };
 const next = await ok('/api/v1/files', replacement); latest = next.file; assert.equal(latest.id, id); assert.notEqual(latest.revision, initial.file.revision);
 const duplicate = await ok('/api/v1/files', create); assert.equal(duplicate.replayed, true); assert.deepEqual(duplicate.file, initial.file);
 assert.deepEqual((await ok(`/api/v1/files?id=${id}&operationId=${create.operationId}`)).receipt.file, initial.file);
 assert.equal((await call('/api/v1/files', { ...create, name: 'changed' })).response.status, 409);
 assert.equal((await call('/api/v1/files', { ...replacement, operationId: randomUUID() })).response.status, 409);
 const attempts = ['left.bin', 'right.bin'].map(name => ({ ...replacement, operationId: randomUUID(), expectedRevision: latest.revision, name }));
 const raced = await Promise.all(attempts.map(body => call('/api/v1/files', body)));
 assert.equal(raced.filter(r => r.response.status === 200).length, 1); assert.equal(raced.filter(r => r.response.status === 409).length, 1);
 latest = (await ok(`/api/v1/files?id=${id}`)).file;
 const library = await ok('/api/v1/things?thingtime=file'); assert.ok(library.things.some((file: any) => file.id === id));
 const folder = await ok('/api/v1/things', { thingtime: ['folder'], crystal: { name: 'File version acceptance' }, visibility: 'private' }); folderId = folder.thing.id;
 const beforeMove = latest.revision;
 const moved = await ok('/api/v1/things/bulk', { op: 'move', ids: [id], folderId }); assert.equal(moved.failed, 0);
 latest = (await ok(`/api/v1/files?id=${id}`)).file; assert.equal(latest.folderId, folderId); assert.notEqual(latest.revision, beforeMove);
 assert.equal((await call('/api/v1/files', { ...replacement, operationId: randomUUID(), expectedRevision: beforeMove })).response.status, 409);
 const nested = (await ok('/api/v1/things', { thingtime: ['folder'], folderId, crystal: { name: 'Nested' } })).thing; inventoryFixtures.push(nested.id);
 const note = (await ok('/api/v1/things', { thingtime: ['data'], folderId: nested.id, crystal: { name: 'Ordinary note' } })).thing; inventoryFixtures.push(note.id);
 const observation = parseCloudInventory((await ok(`/api/v1/files?rootId=${folderId}`)).inventory, folderId!);
 assert.equal(observation.nodes.length, 2); const observedFile = observation.nodes.find(n => n.kind === 'file'); assert.equal(observedFile?.kind, 'file');
 if (observedFile?.kind === 'file') assert.deepEqual(observedFile.file, latest);
 assert.deepEqual(parseCloudInventory((await ok(`/api/v1/files?rootId=${nested.id}`)).inventory, nested.id).nodes, []);
 assert.equal((await call(`/api/v1/files?rootId=${folderId}`, undefined, false)).response.status, 401);
 assert.equal((await call(`/api/v1/files?rootId=${folderId}&id=${id}`)).response.status, 400);
 assert.equal((await call(`/api/v1/files?rootId=${id}`)).response.status, 404);
 for (const name of ['Ambiguous', 'ambiguous']) { const child = (await ok('/api/v1/things', { thingtime: ['folder'], folderId, crystal: { name } })).thing; inventoryFixtures.push(child.id); }
 const ambiguous = await call(`/api/v1/files?rootId=${folderId}`); assert.equal(ambiguous.response.status, 409); assert.equal(ambiguous.data.inventory, undefined);
 while (inventoryFixtures.length) { const child = inventoryFixtures.at(-1)!; assert.equal((await call(`/api/v1/things?id=${child}`, undefined, true, 'DELETE')).response.status, 200); inventoryFixtures.pop(); }
 assert.equal((await ok(`/api/v1/files?rootId=${folderId}`)).inventory.nodes.length, 1);
 console.log('PASS: complete private cloud inventory; exact stable-file fingerprints; nested folders; ordinary notes excluded; anonymous and mixed-selector refusal; case collision fails without partial data; fixture cleanup.');

 assert.equal((await call(`/api/v1/things?id=${folderId}`, undefined, true, 'DELETE')).response.status, 200); folderId = null;
 latest = (await ok(`/api/v1/files?id=${id}`)).file; assert.equal(latest.folderId, null);
 const trash = { ...replacement, operationId: randomUUID(), expectedRevision: latest.revision, name: latest.name, trashed: true };
 latest = (await ok('/api/v1/files', trash)).file; assert.equal(latest.trashed, true);
 const restore = { ...create, operationId: randomUUID(), expectedRevision: latest.revision };
 latest = (await ok('/api/v1/files', restore)).file; assert.equal(latest.trashed, false); assert.equal(cloudFileSyncEntry(latest, latest.name).id, id);
 for (const file of uploaded) {
  const response = await fetch(base.origin+`/api/v1/attachments/content?id=${file.id}&cache=bytes`, { headers: { Cookie: [...cookies].map(([k,v])=>`${k}=${v}`).join('; ') }, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200); assert.equal(hash(new Uint8Array(await response.arrayBuffer())), hash(file.bytes));
  assert.equal((await call('/api/v1/attachments/delete', { id: file.id, targetId: id })).response.status, 409);
 }
 assert.equal((await call(`/api/v1/things?id=${id}`, undefined, true, 'DELETE')).response.status, 404);
 assert.equal((await call(`/api/v1/files?id=${id}`, undefined, false)).response.status, 401);
 const history = await ok(`/api/v1/timeline?ownerId=${encodeURIComponent(fixture.userId)}&dataPlane=home&thingId=${id}`);
 const entries = history.entries.map(parseTimelineEntry); assert.equal(entries.length, 7); assert.equal(entries.filter((e: any) => e.event.after.adapter === 'file-content').length, 5);
 console.log('PASS: stable file identity; real replacement; concurrent writer refusal; exact replay/lookup; Timeline history; library listing; guarded folder moves and folder deletion; trash/restore; independent hashes of both retained versions; protected deletion and anonymous denial');
} finally {
 try {
  for (const child of inventoryFixtures.reverse()) await call(`/api/v1/things?id=${child}`, undefined, true, 'DELETE');
  if (folderId) await call(`/api/v1/things?id=${folderId}`, undefined, true, 'DELETE');
  if (latest) {
   const current = (await ok(`/api/v1/files?id=${id}`)).file;
   await ok('/api/v1/files', { id, operationId: randomUUID(), expectedRevision: current.revision, name: current.name, folderId: null,
    attachmentId: current.content.attachmentId, contentVersion: current.content.version, trashed: true });
   console.log('Fixture retained privately in Trash with its accounted byte versions:', id);
  } else for (const file of uploaded) await ok('/api/v1/attachments/delete', { id: file.id });
 } finally { if (signedIn) await ok('/api/v1/auth/accounts/remove', { userId: fixture.userId }); }
}
