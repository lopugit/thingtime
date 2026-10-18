import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { newPasswordFile, encryptPasswordFile, decryptPasswordFile, iterableStream, passwordFileParts } from '../passwords/fileCrypto';
import { emptyPasswordEntry } from '../passwords/model';
import { THINGTIME_CAPABILITY_MANIFEST_PATH } from '../api/utils/capabilities/capabilityContract';

const fixturePath = process.env.TT_PASSWORD_FILE_API_FIXTURE, artifacts = process.env.TT_PASSWORD_FILE_API_ARTIFACTS;
test('real password file API retains deletion receipts, fences replays and preserves parent/owner isolation', { skip: !fixturePath || !artifacts, timeout: 180_000 }, async () => {
  // Two-phase loopback setup: register a NEW synthetic account normally, then
  // restart only the test-owned server with its username in ADMIN_USERNAMES.
  // No direct DB writes or modifications of existing account data are needed.
  const fixture = JSON.parse(await readFile(fixturePath!, 'utf8'));
  assert.equal(fixture.fixtureKind, 'password-file-sync-qa'); assert.match(fixture.username, /^passwordfiles-[a-f0-9]{8}$/);
  const base = new URL(fixture.base); assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname));
  const headers = { 'Content-Type': 'application/json', Origin: base.origin };
  const calls: { operation: string; status: number }[] = [], parents = new Set<string>();
  let cookie = '', otherCookie = '', completed = false;
  const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  async function api(path: string, body?: unknown, credentials = cookie) {
    let response: Response;
    do {
      response = await fetch(new URL(path, base), { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(credentials ? { Cookie: credentials } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (response.status === 429) {
        const retry = Number(response.headers.get('Retry-After')); assert.ok(Number.isFinite(retry) && retry > 0 && retry <= 120);
        await response.body?.cancel(); await new Promise(resolve => setTimeout(resolve, retry * 1000));
      }
    } while (response.status === 429);
    return response;
  }
  async function request(input: Record<string, unknown>, expectedStatus = 200, credentials = cookie, ownerId = fixture.ownerId) {
    const response = await api('/api/v1/passwords', { ...input, expectedOwnerId: ownerId }, credentials);
    calls.push({ operation: String(input.operation), status: response.status });
    assert.equal(response.status, expectedStatus, String(input.operation));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    return response.json();
  }
  async function parent() {
    const id = randomUUID(); parents.add(id);
    await request({ operation: 'save', id, writeId: randomUUID(), revision: 0, entry: { ...emptyPasswordEntry(), title: 'Synthetic file lifecycle fixture' } });
    return id;
  }
  const bytes = new Uint8Array([7, 12, 0, 255, 41]);
  async function upload(entryId: string) {
    const metadata = newPasswordFile('synthetic-fixture.bin', bytes.length);
    const { upload } = await request({ operation: 'file-start', entryId, metadata });
    assert.match(upload.id, /^att_[a-f0-9]{64}$/); assert.ok(Number.isSafeInteger(upload.partSizeBytes) && upload.partSizeBytes > 0);
    let partNumber = 0;
    for await (const part of passwordFileParts(iterableStream(encryptPasswordFile(new Blob([bytes]).stream(), metadata)), upload.partSizeBytes)) {
      const checksumSha256 = Buffer.from(await crypto.subtle.digest('SHA-256', part as BufferSource)).toString('base64');
      const { parts } = await request({ operation: 'file-parts', entryId, fileId: upload.id, parts: [{ partNumber: ++partNumber, checksumSha256 }] });
      const objectUrl = new URL(parts[0].url, base);
      assert.equal(objectUrl.origin, base.origin, 'fixture must use local object storage');
      const response = await fetch(objectUrl, { method: 'PUT', headers: parts[0].headers, body: part as BodyInit, credentials: 'omit', redirect: 'error' });
      assert.equal(response.ok, true, 'signed ciphertext upload');
    }
    const completed = await request({ operation: 'file-complete', entryId, fileId: upload.id });
    assert.equal(completed.file.id, upload.id); assert.equal(completed.file.metadata.token, metadata.token);
    return { id: upload.id, metadata };
  }
  try {
    const login = await api('/api/v1/login', { username: fixture.username, password: fixture.password }, '');
    assert.equal(login.status, 200); cookie = cookies(login); assert.ok(cookie);
    const me = await (await api('/api/v1/auth/me')).json(); assert.equal(me.user.id, fixture.ownerId);
    assert.equal(me.user.isAdmin, true, 'only the newly registered fixture is bootstrapped as local admin');
    const capabilities = await (await api('/api/v1/capabilities')).json(); assert.equal(capabilities.features['api.passwords'], '1.2.0');
    const manifest = await (await api(THINGTIME_CAPABILITY_MANIFEST_PATH)).json(); assert.equal(manifest.features['api.passwords'].version, '1.2.0');
    const entryId = await parent(), wrongParent = await parent(), file = await upload(entryId);
    const listed = await request({ operation: 'file-list', entryIds: [entryId] }); assert.equal(listed.files.length, 1); assert.equal(listed.files[0].entryId, entryId);
    const download = await request({ operation: 'file-download', entryId, fileId: file.id });
    const downloadUrl = new URL(download.url, base); assert.equal(downloadUrl.origin, base.origin);
    const object = await fetch(downloadUrl, { credentials: 'omit', redirect: 'error' }); assert.equal(object.status, 200);
    const plain = new Uint8Array(await new Response(iterableStream(decryptPasswordFile(object.body!, file.metadata))).arrayBuffer()); assert.deepEqual(plain, bytes);
    await request({ operation: 'file-delete', entryId: wrongParent, fileId: file.id }, 404);
    await request({ operation: 'file-delete', entryId, fileId: file.id }, 401, '');
    const otherUsername = 'passwordfiles-' + randomUUID().slice(0, 8);
    const registered = await api('/api/v1/auth/register', { username: otherUsername, email: otherUsername + '@example.test', password: randomUUID() + randomUUID() }, '');
    assert.equal(registered.status, 200); otherCookie = cookies(registered); const otherId = (await registered.json()).user.id;
    await request({ operation: 'file-delete', entryId, fileId: file.id }, 404, otherCookie, otherId);
    for (let attempt = 0; attempt < 2; attempt++) assert.equal((await request({ operation: 'file-delete', entryId, fileId: file.id })).deferred, false);
    await request({ operation: 'file-delete', entryId: wrongParent, fileId: file.id }, 404);
    for (const operation of ['file-download', 'file-complete', 'file-parts']) await request({ operation, entryId, fileId: file.id }, 404);
    await request({ operation: 'file-start', entryId, metadata: file.metadata }, 409);
    assert.equal((await request({ operation: 'file-list', entryIds: [entryId] })).files.length, 0);
    const pendingMetadata = newPasswordFile('synthetic-abort.bin', 0), pending = await request({ operation: 'file-start', entryId, metadata: pendingMetadata });
    for (let attempt = 0; attempt < 2; attempt++) assert.equal((await request({ operation: 'file-abort', entryId, fileId: pending.upload.id })).deferred, false);
    await request({ operation: 'file-start', entryId, metadata: pendingMetadata }, 409);
    const child = await upload(entryId);
    for (let attempt = 0; attempt < 2; attempt++) await request({ operation: 'delete', id: entryId, revision: 1 }); parents.delete(entryId);
    await request({ operation: 'file-download', entryId, fileId: child.id }, 404);
    await mkdir(artifacts!, { recursive: true }); await writeFile(resolve(artifacts!, 'downloaded-fixture.bin'), plain);
    await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ local: true, account: fixture.ownerId, apiVersion: '1.2.0', byteIdentical: true, calls, publicContentCreated: false, existingAccountModified: false }, null, 2));
    completed = true;
  } finally {
    const pendingCleanup: string[] = [];
    for (const id of parents) await request({ operation: 'delete', id, revision: 1 }).catch(() => { pendingCleanup.push(id); });
    if (otherCookie) await api('/api/v1/auth/logout', {}, otherCookie).catch(() => { pendingCleanup.push('secondary-session'); });
    if (cookie) await api('/api/v1/auth/logout', {}).catch(() => { pendingCleanup.push('primary-session'); });
    await mkdir(artifacts!, { recursive: true });
    await writeFile(resolve(artifacts!, 'cleanup.json'), JSON.stringify({ pendingCleanup, note: 'New fixture account rows and minimal deletion receipts remain; no account deletion API exists.' }, null, 2));
    if (completed) assert.deepEqual(pendingCleanup, [], 'Fixture cleanup must finish or remain explicitly pending');
  }
});
