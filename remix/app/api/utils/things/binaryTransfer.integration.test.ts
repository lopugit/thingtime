import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { bundleFromPlan } from '../../../utils/thingTransfer/browser';
import { decodeTransferArchive, encodeTransferArchive, type TransferBundle } from '../../../utils/thingTransfer/archive';
import type { ThingTransfer } from '../../../utils/thingTransfer/format';
import { capabilitySatisfies, THINGTIME_CAPABILITY_MANIFEST_PATH } from '../capabilities/capabilityContract';

const base = process.env.TT_TRANSFER_TEST_URL;
const cookie = process.env.TT_TRANSFER_TEST_COOKIE;
const enabled = process.env.TT_TRANSFER_BINARY_TEST === '1';
// A real, small PNG. This test uses the ordinary upload/sniff/storage pipeline,
// never MongoDB, direct object credentials, approval changes or mock storage.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('real image ZIP round-trip and concurrent emoji claims preserve bytes and existing copies', {
  skip: !enabled, timeout: 240_000
}, async () => {
  assert.ok(base && cookie, 'Set a local TT_TRANSFER_TEST_URL and disposable TT_TRANSFER_TEST_COOKIE');
  const origin = new URL(base!);
  assert.ok(['localhost', '127.0.0.1'].includes(origin.hostname), 'Only a local fixture server is allowed');
  assert.equal(origin.username + origin.password, '', 'Do not embed credentials in the URL');
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
    'api.auth-me': '1.0.0', 'api.things-export': '1.8.0', 'api.things-import': '1.8.0', 'api.things': '1.11.0',
    'api.attachment-uploads': '1.3.0', 'api.attachment-upload-parts': '1.1.0',
    'api.attachment-upload-complete': '1.3.0', 'api.attachment-upload-abort': '1.1.0',
    'api.attachment-delete': '1.1.0', 'api.attachment-content': '1.6.4', 'api.emojis-delete': '1.0.0'
  })) {
    assert.ok(capabilitySatisfies(capabilities.features?.[feature]?.version, version), `Missing ${feature} ${version}`);
  }
  const me = await json('/api/v1/auth/me');
  assert.ok(me.user?.id, 'A signed-in disposable fixture account is required');
  assert.equal(me.user.publicUploadsEnabled, true, 'Fixture uploads need existing approval; this test never enables uploads');

  const uploads = new Set<string>();
  const copies = new Map<string, 'post' | 'custom-emoji'>();
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
      if (typeof id === 'string') copies.set(id, thing.thingtime[0] as 'post' | 'custom-emoji');
    }
    for (const id of result.remainingIds || []) if (typeof id === 'string') unresolved.add(id);
  };
  const importBundle = async (bundle: TransferBundle) => {
    const files: Record<string, string> = {};
    for (const file of bundle.manifest.files) {
      const thing = bundle.manifest.things.find(thing => thing.id === file.targetId)!;
      files[file.id] = await upload(bundle.files.get(file.id)!, thing.thingtime.includes('custom-emoji') ? 'custom-emoji' : 'post');
    }
    const response = await request('/api/v1/things/import', 'POST', { manifest: bundle.manifest, files });
    const result = await response.json(); remember(result, bundle.manifest);
    assert.equal(response.status, 200, `Import returned ${response.status}`);
    assert.equal(result.ok, true);
    return result;
  };
  const exportedBundle = async (ids: string[]) => {
    const result = await json('/api/v1/things/export', 'POST', { ids });
    const bundle = await bundleFromPlan(result.plan, { fetch: ((path: string) => request(path)) as typeof fetch });
    return decodeTransferArchive(await encodeTransferArchive(bundle));
  };
  const manifest: ThingTransfer = { format: 'thingtime.transfer', version: 1, roots: ['post', 'emoji'],
    things: [
      { id: 'post', thingtime: ['post'], crystal: { type: 'text', text: `binary-transfer-${randomUUID()}` } },
      { id: 'emoji', thingtime: ['custom-emoji'], crystal: { name: 'transfer', emojiFileId: 'emoji-image' } }
    ], files: ['post', 'emoji'].map((id, index) => ({ id: `${id}-image`, targetId: id, path: `files/${index}.png`,
      name: 'transfer-fixture.png', mime: 'image/png', bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'),
      title: 'Image title', description: 'Image description', filenamePreview: 'retained.png' })) };
  try {
    const first = await importBundle({ manifest, files: new Map(manifest.files.map(file => [file.id, png])) });
    const exported = await exportedBundle(first.roots);
    assert.equal(exported.files.size, 2);
    for (const file of exported.manifest.files) {
      assert.deepEqual(Buffer.from(exported.files.get(file.id)!), png);
      assert.equal(file.title, 'Image title'); assert.equal(file.description, 'Image description');
      assert.equal(file.filenamePreview, 'retained.png');
    }
    const second = await importBundle(exported);
    assert.equal(new Set([...first.roots, ...second.roots]).size, 4);
    const copied = await exportedBundle(second.roots);
    for (const bytes of copied.files.values()) assert.deepEqual(Buffer.from(bytes), png);
    for (const roots of [first.roots, second.roots]) {
      assert.equal((await request('/api/v1/things/export', 'POST', { ids: roots }, false)).status, 404);
    }

    const raceManifest: ThingTransfer = { ...manifest, roots: ['emoji'], things: [manifest.things[1]], files: [manifest.files[1]] };
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
  } finally {
    const failures: string[] = [];
    for (const [id, kind] of copies) {
      try {
        const response = await request(kind === 'custom-emoji' ? '/api/v1/emojis/delete' : '/api/v1/things', kind === 'custom-emoji' ? 'POST' : 'DELETE', { id });
        if (![200, 404].includes(response.status)) failures.push(id);
        if ((await request('/api/v1/things/export', 'POST', { ids: [id] })).status !== 404) failures.push(id);
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
    assert.equal(unresolved.size, 0, 'Server reported unresolved compensation; inspect this fixture run before retrying');
    assert.deepEqual(failures, [], 'Disposable binary fixture cleanup failed; retained IDs shown for recovery');
  }
});
