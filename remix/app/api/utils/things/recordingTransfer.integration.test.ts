import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../capabilities/capabilityContract';
import { bundleFromPlan } from '../../../utils/thingTransfer/browser';
import { decodeTransferArchive, encodeTransferArchive } from '../../../utils/thingTransfer/archive';

test('real private recording survives ZIP import and source deletion', {
  skip: process.env.TT_TRANSFER_RECORDING_TEST !== '1', timeout: 180_000
}, async () => {
  const origin = new URL(process.env.TT_TRANSFER_TEST_URL!);
  const cookie = process.env.TT_TRANSFER_TEST_COOKIE, username = process.env.TT_TRANSFER_TEST_USERNAME;
  assert.equal(process.env.TT_TRANSFER_REMOTE_DEV_TEST, '1'); assert.ok(cookie && username);
  assert.equal(origin.protocol, 'https:'); assert.equal(origin.pathname, '/');
  assert.equal(origin.username + origin.password + origin.port + origin.search + origin.hash, '');
  assert.ok(origin.hostname === 'dev.thingtime.com' || /^pr-[1-9][0-9]*\.previews\.dev\.thingtime\.com$/.test(origin.hostname));
  const request = (path: string, method = 'GET', body?: unknown, authenticated = true) => {
    const url = new URL(path, origin); assert.equal(url.origin, origin.origin);
    return fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { 'Content-Type': 'application/json', Origin: origin.origin, ...(authenticated ? { Cookie: cookie! } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  };
  const json = async (path: string, method = 'GET', body?: unknown) => {
    const response = await request(path, method, body);
    assert.equal(response.status, 200, `${method} ${path.split('?')[0]} HTTP ${response.status}`);
    return response.json();
  };
  const capabilities = await json(THINGTIME_CAPABILITY_MANIFEST_PATH);
  assert.equal(capabilities.origin, origin.origin);
  for (const [feature, version] of Object.entries({ 'api.things-export': '1.12.0', 'api.things-import': '1.9.1',
    'api.things': '1.16.1', 'api.attachment-uploads': '1.3.0', 'api.attachment-upload-parts': '1.1.0',
    'api.attachment-upload-complete': '1.3.0', 'api.attachment-upload-abort': '1.1.0',
    'api.attachment-delete': '1.1.0', 'api.attachment-content': '1.6.4' }))
    assert.ok(capabilitySatisfies(capabilities.features?.[feature]?.version, version), `Missing ${feature}; no writes`);
  const me = (await json('/api/v1/auth/me')).user;
  assert.equal(me.username, username); assert.equal(me.accountKind, 'user'); assert.equal(me.privateUploadsEnabled, true);
  // 100ms of synthetic silence: no microphone, human voice, or processor call.
  const wav = Buffer.alloc(1644);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(1600, 40);
  const marker = randomUUID().slice(0, 8), uploads = new Set<string>(), failures: unknown[] = [];
  console.log(JSON.stringify({ recordingFixtureMarker: marker }));
  const upload = async (bytes: Uint8Array, purpose: 'recording' | 'recording-import') => {
    const requestId = randomUUID();
    console.log(JSON.stringify({ recordingUploadRequestId: requestId, purpose }));
    const plan = await json('/api/v1/attachments/uploads', 'POST', { requestId,
      filename: `transfer-silence-${marker}.wav`, contentType: 'audio/wav', sizeBytes: bytes.length, purpose });
    const id = plan.upload?.id; assert.equal(typeof id, 'string'); uploads.add(id);
    console.log(JSON.stringify({ recordingUploadId: id }));
    assert.equal(plan.upload.partCount, 1);
    const checksum = createHash('sha256').update(bytes).digest('base64');
    const signed = await json('/api/v1/attachments/uploads/parts', 'POST', { uploadId: id, parts: [{ partNumber: 1, checksumSha256: checksum }] });
    assert.equal(signed.parts?.length, 1);
    const part = signed.parts[0], url = new URL(part.url);
    assert.equal(url.protocol, 'https:'); assert.equal(url.username + url.password, '');
    assert.equal(part.headers?.['x-amz-checksum-sha256'], checksum);
    const put = await fetch(url, { method: 'PUT', redirect: 'error', credentials: 'omit',
      headers: { 'x-amz-checksum-sha256': checksum }, body: Uint8Array.from(bytes), signal: AbortSignal.timeout(30_000) })
      .catch(() => { throw new Error('Storage upload failed; signed URL withheld'); });
    assert.ok(put.ok, `Storage HTTP ${put.status}`);
    assert.equal((await json('/api/v1/attachments/uploads/complete', 'POST', { uploadId: id })).attachment?.id, id);
    return id as string;
  };
  const contentPath = (id: string) => `/api/v1/attachments/content?id=${encodeURIComponent(id)}&cache=bytes`;
  const readBytes = async (id: string) => {
    const response = await request(contentPath(id)); assert.equal(response.status, 200);
    return Buffer.from(await response.arrayBuffer());
  };
  try {
    const original = await upload(wav, 'recording');
    assert.deepEqual(await readBytes(original), wav);
    const exported = await json('/api/v1/things/export', 'POST', { ids: [original] });
    const bundle = await bundleFromPlan(exported.plan, { fetch: ((path: string) => request(path)) as typeof fetch });
    const decoded = await decodeTransferArchive(await encodeTransferArchive(bundle));
    assert.equal(decoded.manifest.things.length, 1); assert.equal(decoded.manifest.files.length, 1);
    const file = decoded.manifest.files[0]; assert.equal(file.targetId, original);
    assert.deepEqual(Buffer.from(decoded.files.get(file.id)!), wav);
    const copied = await upload(decoded.files.get(file.id)!, 'recording-import');
    const imported = await json('/api/v1/things/import', 'POST', { manifest: decoded.manifest, files: { [file.id]: copied } });
    assert.deepEqual(imported.roots, [copied]); assert.equal(imported.ids[original], copied); assert.notEqual(copied, original);
    assert.equal((await request(`/api/v1/things?id=${encodeURIComponent(copied)}`)).status, 200);
    assert.ok([401, 403, 404].includes((await request(contentPath(copied), 'GET', undefined, false)).status));
    await json('/api/v1/attachments/delete', 'POST', { id: original });
    assert.equal((await request(contentPath(original))).status, 404);
    assert.deepEqual(await readBytes(copied), wav);
    const reexported = await json('/api/v1/things/export', 'POST', { ids: [copied] });
    assert.equal(reexported.plan.things[0].id, copied); assert.equal(reexported.plan.files.length, 1);
    console.log(JSON.stringify({ recordingZipRoundTrip: true, independentBytes: true, reexportable: true }));
  } catch (error) { failures.push(error); }
  finally {
    for (const id of uploads) try {
      await request('/api/v1/attachments/uploads/abort', 'POST', { uploadId: id });
      await request('/api/v1/attachments/delete', 'POST', { id });
      assert.equal((await request(contentPath(id))).status, 404, `Recording cleanup ${id}`);
      assert.equal((await request(`/api/v1/things?id=${encodeURIComponent(id)}`)).status, 404);
    } catch (error) { failures.push(error); }
    if (failures.length) throw Object.assign(new Error('Recording acceptance or cleanup failed'), { errors: failures });
    console.log(JSON.stringify({ recordingCleanup: true, removed: uploads.size }));
  }
});
