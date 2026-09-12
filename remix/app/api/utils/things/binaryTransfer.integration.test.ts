import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { bundleFromPlan } from '../../../utils/thingTransfer/browser';
import { decodeTransferArchive, encodeTransferArchive, type TransferBundle } from '../../../utils/thingTransfer/archive';
import { validateTransfer, type ThingTransfer } from '../../../utils/thingTransfer/format';
import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../capabilities/capabilityContract';

const base = process.env.TT_TRANSFER_TEST_URL;
const cookie = process.env.TT_TRANSFER_TEST_COOKIE;
const enabled = process.env.TT_TRANSFER_BINARY_TEST === '1';
const expectedUsername = process.env.TT_TRANSFER_TEST_USERNAME;
const fixtureOrigin = (value: string, remoteDev = false, username?: string) => {
  const origin = new URL(value);
  assert.equal(origin.username + origin.password, '', 'Do not embed credentials in the URL');
  assert.equal(origin.pathname + origin.search + origin.hash, '/', 'Use an origin, not a resource URL');
  const local = ['localhost', '127.0.0.1'].includes(origin.hostname) && ['http:', 'https:'].includes(origin.protocol);
  const dev = origin.protocol === 'https:' && !origin.port &&
    (origin.hostname === 'dev.thingtime.com' || /^pr-[1-9][0-9]*\.previews\.dev\.thingtime\.com$/.test(origin.hostname));
  assert.ok(local || (remoteDev && dev && !!username?.trim()),
    'Remote tests require explicit dev opt-in and an expected fixture username; production is never allowed');
  return origin;
};

test('binary fixture origin guard requires explicit dev consent and refuses production and lookalike hosts', () => {
  assert.equal(fixtureOrigin('http://127.0.0.1:12280').hostname, '127.0.0.1');
  assert.equal(fixtureOrigin('https://pr-764.previews.dev.thingtime.com', true, 'fixture').protocol, 'https:');
  for (const value of ['https://thingtime.com', 'https://dev.thingtime.com.evil.test',
    'http://dev.thingtime.com', 'https://pr-764.previews.dev.thingtime.com:444',
    'https://user:secret@dev.thingtime.com', 'https://dev.thingtime.com/p/thing']) {
    assert.throws(() => fixtureOrigin(value, true, 'fixture'));
  }
  assert.throws(() => fixtureOrigin('https://dev.thingtime.com'));
  assert.throws(() => fixtureOrigin('https://dev.thingtime.com', true));
});
// A real, small PNG. This test uses the ordinary upload/sniff/storage pipeline,
// never MongoDB, direct object credentials, approval changes or mock storage.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('real image and archive ZIP round-trip and concurrent emoji claims preserve independent bytes', {
  skip: !enabled, timeout: 240_000
}, async () => {
  assert.ok(base && cookie, 'Set TT_TRANSFER_TEST_URL and disposable TT_TRANSFER_TEST_COOKIE');
  const origin = fixtureOrigin(base!, process.env.TT_TRANSFER_REMOTE_DEV_TEST === '1', expectedUsername);
  const request = async (path: string, method = 'GET', body?: unknown, authenticated = true) => {
    const url = new URL(path, origin);
    assert.equal(url.origin, origin.origin, 'Session credentials must stay on the fixture origin');
    return fetch(url, { method, redirect: 'error',
      headers: { 'Content-Type': 'application/json', Origin: origin.origin, ...(authenticated ? { Cookie: cookie! } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  };
  const json = async (path: string, method = 'GET', body?: unknown) => {
    const response = await request(path, method, body);
    const data = await response.json();
    // Never include a whole response: upload plans contain presigned URLs and
    // account responses can carry private configuration.
    assert.equal(response.status, 200, `${method} ${path.split('?')[0]} returned ${response.status}`);
    return data;
  };
  const capabilities = await json(THINGTIME_CAPABILITY_MANIFEST_PATH);
  assert.equal(capabilities.origin, origin.origin);
  for (const [feature, version] of Object.entries({
    'api.auth-me': '1.0.0', 'api.things-export': '1.10.0', 'api.things-import': '1.9.1', 'api.things': '1.15.0',
    'api.attachment-uploads': '1.3.0', 'api.attachment-upload-parts': '1.1.0',
    'api.attachment-upload-complete': '1.3.0', 'api.attachment-upload-abort': '1.1.0',
    'api.attachment-delete': '1.1.0', 'api.attachment-content': '1.6.4', 'api.emojis-delete': '1.0.0'
  })) {
    assert.ok(capabilitySatisfies(capabilities.features?.[feature]?.version, version), `Missing ${feature} ${version}`);
  }
  const me = await json('/api/v1/auth/me');
  assert.ok(me.user?.id, 'A signed-in disposable fixture account is required');
  if (expectedUsername) assert.equal(me.user.username, expectedUsername, 'Unexpected fixture account');
  assert.equal(me.user.publicUploadsEnabled, true, 'Fixture uploads need existing approval; this test never enables uploads');

  const uploads = new Set<string>();
  const copies = new Map<string, 'post' | 'custom-emoji' | 'chat-archive'>();
  const unresolved = new Set<string>();
  const upload = async (bytes: Uint8Array, purpose: 'post' | 'custom-emoji') => {
    const plan = await json('/api/v1/attachments/uploads', 'POST', {
      requestId: randomUUID(), filename: 'transfer-fixture.png', contentType: 'image/png', sizeBytes: bytes.length, purpose
    });
    const id = plan.upload?.id;
    assert.equal(typeof id, 'string'); uploads.add(id);
    assert.equal(plan.upload.partCount, 1, 'The tiny fixture should occupy exactly one part');
    const checksum = createHash('sha256').update(bytes).digest('base64');
    const signed = await json('/api/v1/attachments/uploads/parts', 'POST', { uploadId: id, parts: [{ partNumber: 1, checksumSha256: checksum }] });
    assert.equal(signed.parts?.length, 1);
    const part = signed.parts[0];
    assert.equal(part.partNumber, 1);
    const url = new URL(part.url);
    assert.equal(url.protocol, 'https:', 'Real storage upload must use HTTPS');
    assert.equal(url.username + url.password, '');
    assert.equal(part.headers?.['x-amz-checksum-sha256'], checksum);
    // No session cookie, bearer token, referer or arbitrary response headers
    // cross this origin boundary. Do not follow a storage redirect.
    const put = await fetch(url, { method: 'PUT', redirect: 'error', credentials: 'omit',
      headers: { 'x-amz-checksum-sha256': checksum }, body: Uint8Array.from(bytes), signal: AbortSignal.timeout(30_000) })
      .catch(() => { throw new Error('Storage part network request failed (signed URL withheld)'); });
    assert.ok(put.ok, `Storage part returned ${put.status}`);
    const ready = await json('/api/v1/attachments/uploads/complete', 'POST', { uploadId: id });
    assert.equal(ready.attachment?.id, id);
    assert.equal(ready.attachment?.size, bytes.length);
    return id;
  };
  const remember = (result: any, manifest: ThingTransfer) => {
    for (const thing of manifest.things) {
      const id = result.ids?.[thing.id];
      const kind = thing.thingtime[0];
      // Historical children are deleted atomically with their archive root,
      // never through the ordinary Thing mutation path.
      if (typeof id === 'string' && (kind === 'post' || kind === 'custom-emoji' || kind === 'chat-archive')) copies.set(id, kind);
    }
    for (const id of result.remainingIds || []) if (typeof id === 'string') unresolved.add(id);
  };
  const importBundle = async (bundle: TransferBundle) => {
    validateTransfer(bundle.manifest);
    const files: Record<string, string> = {};
    for (const file of bundle.manifest.files) {
      const thing = bundle.manifest.things.find(thing => thing.id === file.targetId)!;
      files[file.id] = await upload(bundle.files.get(file.id)!, thing.thingtime.includes('custom-emoji') ? 'custom-emoji' : 'post');
    }
    const response = await request('/api/v1/things/import', 'POST', { manifest: bundle.manifest, files });
    const result = await response.json(); remember(result, bundle.manifest);
    const errorFingerprint = typeof result.error === 'string' ? createHash('sha256').update(result.error).digest('hex') : 'none';
    assert.equal(response.status, 200, `Import returned ${response.status}; error fingerprint ${errorFingerprint}`);
    assert.equal(result.ok, true);
    return result;
  };
  const exportedBundle = async (ids: string[]) => {
    const result = await json('/api/v1/things/export', 'POST', { ids });
    const bundle = await bundleFromPlan(result.plan, { fetch: ((path: string) => request(path)) as typeof fetch });
    return decodeTransferArchive(await encodeTransferArchive(bundle));
  };
  const at = '2026-09-01T00:00:00.000Z';
  const manifest: ThingTransfer = { format: 'thingtime.transfer', version: 1, roots: ['post', 'emoji', 'archive'],
    things: [
      { id: 'post', thingtime: ['post'], crystal: { type: 'text', text: `binary-transfer-${randomUUID()}` } },
      { id: 'emoji', thingtime: ['custom-emoji'], crystal: { name: 'transfer', emojiFileId: 'emoji-image' } },
      { id: 'archive', thingtime: ['chat-archive'], crystal: { name: 'Binary archive fixture', topic: '', chatType: 'dm', createdAt: at, selfParticipantId: 'self' } },
      { id: 'self', targetId: 'archive', thingtime: ['chat-archive-participant'], crystal: { username: 'fictional-original', displayName: 'Original self', nickname: '', joinedAt: at } },
      { id: 'friend', targetId: 'archive', thingtime: ['chat-archive-participant'], crystal: { username: 'fictional-archived-friend', displayName: 'Archived friend', nickname: 'F', joinedAt: at, avatarFileId: 'friend-image' } },
      { id: 'message', targetId: 'archive', thingtime: ['chat-archive-message'], crystal: { participantId: 'self', text: 'Exact media history 🥰', createdAt: at, deleted: false } }
    ], files: ['post', 'emoji', 'friend', 'message'].map((id, index) => ({ id: `${id}-image`, targetId: id, path: `files/${String(index).padStart(6, '0')}`,
      name: 'transfer-fixture.png', mime: 'image/png', bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'),
      title: 'Image title', description: 'Image description', filenamePreview: 'retained.png' })) };
  let primaryFailure: unknown;
  try {
    const first = await importBundle({ manifest, files: new Map(manifest.files.map(file => [file.id, png])) });
    const exported = await exportedBundle(first.roots);
    assert.equal(exported.files.size, 4);
    for (const file of exported.manifest.files) {
      assert.deepEqual(Buffer.from(exported.files.get(file.id)!), png);
      assert.equal(file.title, 'Image title'); assert.equal(file.description, 'Image description');
      assert.equal(file.filenamePreview, 'retained.png');
    }
    const second = await importBundle(exported);
    assert.equal(new Set([...first.roots, ...second.roots]).size, 6);
    const copiedArchiveId = second.ids[first.ids.archive];
    assert.equal(typeof copiedArchiveId, 'string');
    const archivePath = (id: string) => `/api/v1/things?id=${encodeURIComponent(id)}&archive=true`;
    const archive = (await json(archivePath(copiedArchiveId))).archive;
    assert.equal(archive.group.messages[0].crystal.text, 'Exact media history 🥰');
    const friend = archive.group.participants.find((row: any) => row.crystal.username === 'fictional-archived-friend');
    assert.ok(friend); assert.equal(friend.crystal.displayName, 'Archived friend');
    assert.equal(archive.attachments.length, 2);
    assert.ok(archive.attachments.some((file: any) => file.id === friend.crystal.avatarFileId && file.targetId === friend.id));
    assert.ok(archive.attachments.some((file: any) => file.targetId === archive.group.messages[0].id));
    for (const file of archive.attachments) {
      assert.equal(file.title, 'Image title'); assert.equal(file.description, 'Image description');
      assert.equal(file.filenamePreview, 'retained.png');
    }
    const copied = await exportedBundle(second.roots);
    for (const bytes of copied.files.values()) assert.deepEqual(Buffer.from(bytes), png);
    for (const roots of [first.roots, second.roots]) {
      assert.equal((await request('/api/v1/things/export', 'POST', { ids: roots }, false)).status, 404);
    }

    const raceManifest = validateTransfer({ ...manifest, roots: ['emoji'], things: [manifest.things[1]], files: [{ ...manifest.files[1], path: 'files/000000' }] });
    const oneUpload = await upload(png, 'custom-emoji');
    const raced = await Promise.all([0, 1].map(async () => {
      const response = await request('/api/v1/things/import', 'POST', { manifest: raceManifest, files: { 'emoji-image': oneUpload } });
      const result = await response.json(); remember(result, raceManifest);
      return { status: response.status, result };
    }));
    assert.equal(raced.filter(item => item.status === 200 && item.result.ok).length, 1, 'Exactly one import may claim an upload');
    const loser = raced.find(item => item.status !== 200 || !item.result.ok)!;
    assert.equal(loser.status, 400, 'A rate-limit or server failure is not proof of the freshness fence');
    assert.equal(loser.result.error, 'Emoji import requires a fresh, ready, owned image upload with matching bytes');
    const winner = raced.find(item => item.status === 200 && item.result.ok)!;
    const survived = await exportedBundle(winner.result.roots);
    assert.deepEqual(Buffer.from([...survived.files.values()][0]), png, 'Losing import must not delete the winner');
    // Prove the ordinary read path can see each copy before using its 404
    // as deletion evidence. Cleanup reads must not consume the export budget.
    for (const [id, kind] of copies) assert.equal((await request(`/api/v1/things?id=${encodeURIComponent(id)}${kind === 'chat-archive' ? '&archive=true' : ''}`)).status, 200);
    await json('/api/v1/things', 'DELETE', { id: first.ids.archive });
    assert.equal((await request(archivePath(first.ids.archive))).status, 404);
    copies.delete(first.ids.archive);
    const independent = await exportedBundle([copiedArchiveId]);
    assert.equal(independent.files.size, 2, 'Copied avatar and message image must survive source deletion');
    for (const bytes of independent.files.values()) assert.deepEqual(Buffer.from(bytes), png);
  } catch (error) {
    primaryFailure = error;
  } finally {
    const failures: string[] = [];
    for (const [id, kind] of copies) {
      try {
        const response = await request(kind === 'custom-emoji' ? '/api/v1/emojis/delete' : '/api/v1/things', kind === 'custom-emoji' ? 'POST' : 'DELETE', { id });
        if (![200, 404].includes(response.status)) failures.push(`${id}: delete HTTP ${response.status}`);
        const verify = await request(`/api/v1/things?id=${encodeURIComponent(id)}${kind === 'chat-archive' ? '&archive=true' : ''}`);
        if (verify.status !== 404) failures.push(`${id}: verify HTTP ${verify.status}`);
      } catch { failures.push(id); }
    }
    for (const id of uploads) {
      try {
        // These IDs belong only to this invocation. Abort handles unfinished
        // uploads; deletion handles finalized drafts left by a failed import.
        await request('/api/v1/attachments/uploads/abort', 'POST', { uploadId: id });
        await request('/api/v1/attachments/delete', 'POST', { id });
        const response = await request(`/api/v1/attachments/content?id=${encodeURIComponent(id)}&cache=bytes`);
        if (response.status !== 404) failures.push(id);
      } catch { failures.push(id); }
    }
    const errors = primaryFailure ? [primaryFailure] : [];
    if (unresolved.size) errors.push(new Error('Server reported unresolved compensation; inspect this fixture run before retrying'));
    if (failures.length) errors.push(new Error(`Disposable fixture cleanup requires verification: ${failures.join(', ')}`));
    if (errors.length) throw new AggregateError(errors, 'Binary transfer acceptance or cleanup failed');
  }
});
