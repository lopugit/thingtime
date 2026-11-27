/** Real API handlers, a disposable Mongo replica, and the canonical local object store. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const directory = process.env.THINGTIME_METADATA_TEST_DIRECTORY;
assert.ok(directory && /^mongodb:\/\/127\.0\.0\.1:\d+\/thingtime\?replicaSet=thing-metadata$/.test(process.env.MONGODB_CONNECTION_STRING || ''));
const actual = await realpath(directory);
assert.equal(dirname(actual), await realpath(tmpdir()));
assert.ok(basename(actual).startsWith('thingtime-metadata-'));
assert.equal((await stat(actual)).mode & 0o077, 0);
const base = 'http://127.0.0.1:11500';
process.env.APP_URL = base;
process.env.JWT_SECRET = randomUUID() + randomUUID();
process.env.ADMIN_USERNAMES = '';
process.env.NODE_ENV = 'test';
process.env.THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR = join(actual, 'object-store');
process.env.THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN = base;

const register = await import('../app/routes/api/v1/auth/register/_register');
const things = await import('../app/routes/api/v1/things/_things');
const metadata = await import('../app/routes/api/v1/things/metadata/_metadata');
const uploads = await import('../app/routes/api/v1/attachments/uploads/_uploads');
const parts = await import('../app/routes/api/v1/attachments/uploads/parts/_parts');
const complete = await import('../app/routes/api/v1/attachments/uploads/complete/_complete');
const content = await import('../app/routes/api/v1/attachments/content/_content');
const files = await import('../app/routes/api/v1/files/_files');
const { handleLocalAttachmentStorageRequest } = await import('../app/api/utils/attachments/localAttachmentStorage');
type Handler = (input: { request: Request }) => Response | Promise<Response>;
const call = async (handler: Handler, path: string, options: { body?: unknown; cookie?: string; method?: string; origin?: string } = {}) => {
  const { body, cookie = '', method = body === undefined ? 'GET' : 'POST', origin = base } = options;
  const response = await handler({ request: new Request(base + path, { method, headers: { Origin: origin, Cookie: cookie,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) });
  const data = await response.json();
  return { response, data };
};
const ok = async (...args: Parameters<typeof call>) => {
  const result = await call(...args);
  assert.equal(result.response.status, 200, `${args[1].split('?')[0]}: ${result.data.error || 'status'}`);
  assert.equal(result.data.ok, true);
  return result;
};
const signup = async () => {
  const username = 'meta-' + randomUUID().slice(0, 8);
  const { response, data } = await ok(register.action, '/api/v1/auth/register', { body: { username, password: randomUUID() + '-Disposable!', email: username + '@example.invalid' } });
  return { user: data.user, username, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
};
const owner = await signup(), other = await signup();
const { cookie } = owner;
// Reserve storage through the supported test-account administrator policy.
process.env.ADMIN_USERNAMES = owner.username;
const thingsPath = '/api/v1/things';
const metadataPath = `${thingsPath}/metadata`;
const sourcePath = (id: string) => `${thingsPath}?id=${encodeURIComponent(id)}`;
const metaPath = (id: string) => `${metadataPath}?id=${encodeURIComponent(id)}`;
const get = async (id: string, auth = cookie) => (await ok(metadata.loader, metaPath(id), { cookie: auth })).data;
const save = async (id: string) => (await ok(metadata.action, metaPath(id), { method: 'POST', cookie })).data;
const create = async (crystal: unknown, thingtime = ['data'], acl = ['tt:user']) => (await ok(things.action, thingsPath, { cookie, body: { thingtime, crystal, acl } })).data.thing;
const update = async (id: string, body: unknown) => (await ok(things.action, thingsPath, { cookie, method: 'PATCH', body: { id, ...body as object } })).data.thing;

const source = await create({ name: 'Metadata canonical JSON', nested: { b: [1, '📦'], a: 'é' }, content: { size: 9_000_000_000 } });
const first = await get(source.id);
assert.equal(first.metadata.id, null);
assert.equal(first.canSave, true);
assert.equal(first.metadata.jsonBytes, Buffer.byteLength(JSON.stringify({ crystal: source.crystal, extended: source.extended, tags: source.tags })));
assert.equal(first.metadata.attachedBytes, 0, 'authored content.size is never original attachment evidence');
assert.equal((await get(source.id)).metadata.id, null, 'GET cannot save a metadata Thing');
for (const auth of ['', other.cookie]) assert.equal((await call(metadata.loader, metaPath(source.id), { cookie: auth })).response.status, 404);
assert.equal((await call(metadata.action, metaPath(source.id), { cookie: other.cookie, method: 'POST' })).response.status, 404);
assert.equal((await call(metadata.action, metaPath(source.id), { cookie, method: 'POST', origin: 'https://untrusted.example' })).response.status, 403);
assert.ok((await call(things.action, thingsPath, { cookie, body: { thingtime: ['thing-metadata'], crystal: { attachedBytes: 999 } } })).response.status >= 400);

const attempts = await Promise.all([save(source.id), save(source.id)]);
const metadataId = attempts[0].metadata.id;
assert.ok(metadataId);
assert.equal(attempts[1].metadata.id, metadataId);
assert.equal(attempts[0].canSave, false);
assert.equal((await ok(metadata.action, metaPath(source.id), { cookie, body: { attachedBytes: 999 } })).data.metadata.attachedBytes, 0);
assert.equal((await get(source.id)).canSave, false);
const exact = (await ok(things.loader, sourcePath(metadataId), { cookie })).data.thing;
assert.deepEqual(exact.thingtime, ['thing-metadata']);
assert.equal(exact.targetId, source.id);
assert.equal(exact.crystal.sourceHash, first.metadata.sourceHash);
assert.ok(exact.crystal.renderComponent?.render?.children?.length);
assert.equal((await call(metadata.loader, metaPath(metadataId), { cookie })).response.status, 404);
assert.deepEqual((await ok(things.loader, `${thingsPath}?ids=${encodeURIComponent(JSON.stringify([metadataId]))}`, { cookie })).data.things, [null]);
const reordered = await update(source.id, { crystal: { nested: { a: 'é', b: [1, '📦'] } } });
assert.equal(reordered.id, source.id);
assert.equal((await get(source.id)).metadata.sourceHash, first.metadata.sourceHash);
assert.equal((await get(source.id)).canSave, false);
await update(source.id, { crystal: { nested: { a: 'é', b: ['📦', 1] } } });
const stale = await get(source.id);
assert.notEqual(stale.metadata.sourceHash, first.metadata.sourceHash);
assert.equal(stale.canSave, true);
assert.equal((await ok(things.loader, sourcePath(metadataId), { cookie })).data.thing.crystal.sourceHash, stale.metadata.sourceHash);
assert.equal((await save(source.id)).metadata.id, metadataId);
assert.equal((await get(source.id)).canSave, false);
assert.equal((await call(things.loader, sourcePath(metadataId), { cookie: other.cookie })).response.status, 404);
await update(source.id, { acl: ['tt:all'] });
assert.equal((await get(source.id, '')).canSave, false);
assert.equal((await ok(things.loader, sourcePath(metadataId))).data.thing.crystal.sourceHash, stale.metadata.sourceHash);
const hidden = await update(source.id, { visibility: 'hidden' });
assert.ok(hidden.linkKey);
const keyQuery = `&key=${encodeURIComponent(hidden.linkKey)}`;
assert.equal((await ok(metadata.loader, `${metaPath(source.id)}${keyQuery}`)).data.metadata.id, metadataId);
assert.equal((await ok(things.loader, `${sourcePath(metadataId)}${keyQuery}`)).data.thing.targetId, source.id);
await update(source.id, { acl: ['tt:user'] });
assert.equal((await call(things.loader, sourcePath(metadataId))).response.status, 404);
assert.equal((await call(metadata.loader, `${metaPath(source.id)}${keyQuery}`)).response.status, 404);
assert.equal((await call(things.loader, `${sourcePath(metadataId)}${keyQuery}`)).response.status, 404);

const bytes = Buffer.from(Array.from({ length: 5632 }, (_, index) => index % 251));
const digest = createHash('sha256').update(bytes).digest('base64');
const upload = (await ok(uploads.action, '/api/v1/attachments/uploads', { cookie,
  body: { requestId: randomUUID(), purpose: 'file', filename: 'original.bin', contentType: 'application/octet-stream', sizeBytes: bytes.length } })).data.upload;
const signed = (await ok(parts.action, '/api/v1/attachments/uploads/parts', { cookie,
  body: { uploadId: upload.id, parts: [{ partNumber: 1, checksumSha256: digest }] } })).data.parts[0];
assert.equal(new URL(signed.url).origin, base);
assert.equal((await handleLocalAttachmentStorageRequest(new Request(signed.url, { method: 'PUT', headers: signed.headers, body: bytes }))).status, 200);
await ok(complete.action, '/api/v1/attachments/uploads/complete', { cookie, body: { uploadId: upload.id } });
const attachmentPath = `/api/v1/attachments/content?id=${upload.id}`;
const receipt = (await ok(content.loader, `${attachmentPath}&fingerprint=1`, { cookie })).data;
const file = (await ok(files.action, '/api/v1/files', { cookie, body: { id: randomUUID(), operationId: randomUUID(), expectedRevision: null,
  name: 'Original-size metadata fixture.bin', folderId: null, attachmentId: upload.id, contentVersion: receipt.version, trashed: false } })).data.file;
const fileMetadata = (await save(file.id)).metadata;
assert.equal(fileMetadata.attachedBytes, bytes.length);
assert.equal(fileMetadata.knownAttachedBytes, bytes.length);
assert.equal(fileMetadata.attachmentCount, 1);
assert.notEqual(fileMetadata.jsonBytes, bytes.length);
const download = await content.loader({ request: new Request(base + attachmentPath, { headers: { Cookie: cookie } }) });
assert.equal(download.status, 302);
const downloaded = await handleLocalAttachmentStorageRequest(new Request(download.headers.get('Location')!));
assert.equal(downloaded.status, 200);
assert.equal(createHash('sha256').update(new Uint8Array(await downloaded.arrayBuffer())).digest('base64'), digest);
assert.equal((await call(metadata.loader, metaPath(file.id), { cookie: other.cookie })).response.status, 404);

const unavailable = await create({ name: 'Unavailable attachment reference', blocks: [{ id: 'media', type: 'media', src: attachmentPath },
  { id: 'duplicate', type: 'media', src: attachmentPath }] }, ['webpage']);
const missingBytes = (await get(unavailable.id)).metadata;
assert.equal(missingBytes.attachmentCount, 1);
assert.equal(missingBytes.attachedBytes, null);
assert.equal(missingBytes.unavailableAttachmentCount, 1);

const deleted = await create({ name: 'Metadata cascade fixture' });
const deletedMetadata = (await save(deleted.id)).metadata.id;
await ok(things.action, sourcePath(deleted.id), { cookie, method: 'DELETE' });
assert.equal((await call(things.loader, sourcePath(deletedMetadata), { cookie })).response.status, 404);
assert.equal((await call(metadata.loader, metaPath(deleted.id), { cookie })).response.status, 404);
if (process.env.THINGTIME_STORAGE_POLICY_TEST === '1') {
  const { runThingStoragePolicyProof } = await import('./thing-storage-policy.integration.mts');
  await runThingStoragePolicyProof({ base, cookie, otherCookie: other.cookie, file });
}
if (process.env.THINGTIME_STORAGE_BROWSER_TEST === '1') {
  const { runThingStorageBrowser } = await import('./thing-storage.browser.mts');
  await runThingStorageBrowser({ owner: owner.user, cookie, sourceId: file.id, jsonId: source.id, unavailableId: unavailable.id });
}
if (process.env.THINGTIME_METADATA_BROWSER === '1') {
  const { runThingMetadataBrowser } = await import('./thing-metadata.browser.mts');
  await runThingMetadataBrowser({ owner: owner.user, cookie, sourceId: file.id, jsonId: source.id, unavailableId: unavailable.id });
}
console.log('Thing metadata real handlers passed with a disposable Mongo replica and checksum-verified local object bytes.');
process.exit(0);
