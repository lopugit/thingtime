/** Real production request handlers and a disposable home replica/store only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { realpath, stat, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
const directory = process.env.THINGTIME_CLOUD_INVENTORY_TEST_DIRECTORY;
assert.ok(directory && /^mongodb:\/\/127\.0\.0\.1:\d+\/thingtime\?replicaSet=cloud-inventory-pages$/.test(process.env.MONGODB_CONNECTION_STRING || ''));
const actual = await realpath(directory!); assert.equal(dirname(actual), await realpath(tmpdir()));
assert.ok(basename(actual).startsWith('thingtime-cloud-inventory-pages-'));
assert.equal((await stat(actual)).mode & 0o077, 0);
const base = 'http://127.0.0.1:28242', username = 'empty-' + randomUUID().slice(0,8);
// Explicit disposable test-administrator setup; never read any real account,
// app environment or credential. The real upload permission guard stays active.
process.env.ADMIN_USERNAMES = '';
process.env.APP_URL = base; process.env.JWT_SECRET = randomUUID() + randomUUID(); process.env.NODE_ENV = 'test';
process.env.THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR = join(actual, 'empty-object-store');
process.env.THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN = base;
const register = await import('../app/routes/api/v1/auth/register/_register');
const uploads = await import('../app/routes/api/v1/attachments/uploads/_uploads');
const complete = await import('../app/routes/api/v1/attachments/uploads/complete/_complete');
const content = await import('../app/routes/api/v1/attachments/content/_content');
const things = await import('../app/routes/api/v1/things/_things');
const files = await import('../app/routes/api/v1/files/_files');
const { handleLocalAttachmentStorageRequest } = await import('../app/api/utils/attachments/localAttachmentStorage');
let cookie = '';
const request = (path: string, body?: unknown) => new Request(base + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const call = async (handler: any, path: string, body?: unknown) => {
    const response: Response = await handler({ request: request(path, body) });
    assert.equal(response.status, 200, path.split('?')[0] + ' status');
    const data = await response.json(); assert.notEqual(data.ok, false); return { response, data };
};
const signedUp = await call(register.action, '/api/v1/auth/register', { username, password: randomUUID() + '-Disposable!', email: username + '@example.invalid' });
cookie = signedUp.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
// Bootstrap the already-created disposable account through the supported
// environment administrator policy (reserved admin names cannot sign up).
process.env.ADMIN_USERNAMES = username;
const input = { requestId: randomUUID(), purpose: 'file', filename: 'empty.txt', contentType: 'application/octet-stream', sizeBytes: 0 };
const first = (await call(uploads.action, '/api/v1/attachments/uploads', input)).data.upload;
assert.equal(first.state, 'ready'); assert.equal(first.partCount, 0); assert.equal(first.expiresAt, null);
const replay = (await call(uploads.action, '/api/v1/attachments/uploads', input)).data.upload;
assert.deepEqual(replay, first);
await call(complete.action, '/api/v1/attachments/uploads/complete', { uploadId: first.id });
const fingerprint = (await call(content.loader, '/api/v1/attachments/content?id=' + first.id + '&fingerprint=1')).data;
assert.equal(fingerprint.size, 0); assert.equal(fingerprint.fingerprint.partCount, 0);
assert.equal(fingerprint.fingerprint.sha256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
const objectFiles = await readdir(join(actual, 'empty-object-store', 'objects', first.id));
assert.equal(objectFiles.filter(name => name.endsWith('.bin')).length, 1);
const read = await content.loader({ request: request('/api/v1/attachments/content?id=' + first.id) });
assert.equal(read.status, 302);
const location = new URL(read.headers.get('location')!, base); assert.equal(location.origin, base);
const bytes = await handleLocalAttachmentStorageRequest(new Request(location));
assert.equal(bytes.status, 200); assert.equal(bytes.headers.get('content-length'), '0'); assert.equal((await bytes.arrayBuffer()).byteLength, 0);
const root = (await call(things.action, '/api/v1/things', { thingtime: ['folder'], acl: ['tt:user'], crystal: { name: 'Empty acceptance' } })).data.thing;
const commit = { id: randomUUID(), operationId: randomUUID(), expectedRevision: null, name: 'empty.txt', folderId: root.id,
    attachmentId: first.id, contentVersion: fingerprint.version, trashed: false };
const committed = (await call(files.action, '/api/v1/files', commit)).data.file;
assert.equal(committed.content.size, 0); assert.equal(committed.content.fingerprint.partCount, 0);
assert.deepEqual((await call(files.action, '/api/v1/files', commit)).data.file, committed);
const observed = (await call(files.loader, '/api/v1/files?rootId=' + root.id + '&path=empty.txt')).data.observation.entry;
assert.equal(observed.size, 0); assert.equal(observed.sha256, fingerprint.fingerprint.sha256);
// Rebind through ordinary conditional file commits and restore the original
// stored empty version, retaining canonical operation receipts.
const second = (await call(uploads.action, '/api/v1/attachments/uploads', { ...input, requestId: randomUUID() })).data.upload;
const secondFingerprint = (await call(content.loader, '/api/v1/attachments/content?id=' + second.id + '&fingerprint=1')).data;
const updated = (await call(files.action, '/api/v1/files', { ...commit, operationId: randomUUID(), expectedRevision: committed.revision,
    attachmentId: second.id, contentVersion: secondFingerprint.version })).data.file;
const restored = (await call(files.action, '/api/v1/files', { ...commit, operationId: randomUUID(), expectedRevision: updated.revision })).data.file;
assert.equal(restored.content.attachmentId, first.id); assert.equal(restored.content.size, 0);
assert.deepEqual((await call(files.loader, '/api/v1/files?id=' + commit.id + '&operationId=' + commit.operationId)).data.receipt.file, committed);
const anonymous = new Request(base + '/api/v1/attachments/content?id=' + first.id + '&fingerprint=1');
assert.notEqual((await content.loader({ request: anonymous })).status, 200);
console.log(JSON.stringify({ cloudInventoryPagesProof: true, emptyFileProof: true,
    checks: ['real-session-upload-permission', 'Mongo-zero-reservation-finalization', 'same-request-one-object', 'stored-zero-byte-download',
        'verified-zero-fingerprint', 'file-commit-replay', 'empty-path-observation', 'conditional-empty-restore', 'immutable-receipt', 'anonymous-refusal'],
    boundary: 'Production Request handlers, Mongo replica and durable local object adapter; not live S3 or installed-device acceptance' }));
process.exit(0);
