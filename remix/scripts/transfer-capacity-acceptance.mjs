#!/usr/bin/env node
// Real HTTP/multipart/disk-object acceptance. Requires a built Nitro output.
// No existing accounts, env files, object bucket or product database is used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { tsImport } from 'tsx/esm/api';
const { bundleFromPlan } = await tsImport('../app/utils/thingTransfer/browser.ts', import.meta.url);
const { encodeTransferArchiveBlob, decodeTransferArchiveBlob } = await tsImport('../app/utils/thingTransfer/archive.ts', import.meta.url);
const { validateTransfer, serializeTransfer } = await tsImport('../app/utils/thingTransfer/format.ts', import.meta.url);
const { capabilitySatisfies } = await tsImport('../app/api/utils/capabilities/capabilityContract.ts', import.meta.url);
assert.equal(process.platform, 'darwin', 'sandbox-exec is mandatory; no unrestricted fallback');
const cwd = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'tt-transfer-capacity-'));
const ports = { owner: 19861, db: 19862 };
const origin = `http://127.0.0.1:${ports.owner}`;
const mongoUri = `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=transfer-capacity`;
const policy = join(dir, 'network.sb');
const children = new Set();
const jwt = randomBytes(48).toString('hex');
const run = new AbortController();
const interrupt = () => run.abort(new Error('Acceptance interrupted'));
process.on('SIGTERM', interrupt); process.on('SIGINT', interrupt);
const deadline = setTimeout(() => run.abort(new Error('Whole-run deadline exceeded')), 12 * 60 * 1000);
const signal = local => local ? AbortSignal.any([run.signal, local]) : run.signal;
const delay = (ms, cancellable = true) => new Promise((resolve, reject) => {
  if (cancellable) run.signal.throwIfAborted();
  const done = () => { if (cancellable) run.signal.removeEventListener('abort', abort); resolve(); };
  const timer = setTimeout(done, ms);
  const abort = () => { clearTimeout(timer); reject(run.signal.reason); };
  if (cancellable) run.signal.addEventListener('abort', abort, { once: true });
});
let cookie = '', adminCookie = '', owner;
let phase = 'setup';
const uploads = new Set();
function start(executable, args, extra = {}) {
  run.signal.throwIfAborted();
  const child = spawn('/usr/bin/sandbox-exec', ['-f', policy, executable, ...args], {
    cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
      PATH: process.env.PATH, HOME: dir, TMPDIR: dir, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(ports.owner),
      MONGODB_CONNECTION_STRING: mongoUri, JWT_SECRET: jwt, THINGTIME_DATA_ENV: 'development',
      THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR: join(dir, 'objects'), THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN: origin,
      ...extra
    }
  });
  // Do not retain application logs: signup/session/storage output can contain
  // credentials, signed URLs or private account fields. Report phase only.
  child.on('error', () => { child.fixtureSpawnFailed = true; });
  child.stdout.resume(); child.stderr.resume(); children.add(child); return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, 'exit');
  try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  await Promise.race([ended, delay(5000, false)]);
  if (child.exitCode === null && child.signalCode === null) { process.kill(-child.pid, 'SIGKILL'); await Promise.race([ended, delay(5000, false)]); }
  assert.ok(child.exitCode !== null || child.signalCode !== null, 'Owned child did not stop');
}
async function ready(child) {
  for (let i = 0; i < 150; i++) {
    run.signal.throwIfAborted();
    assert.ok(!child.fixtureSpawnFailed, 'Failed to spawn sandboxed Nitro');
    assert.equal(child.exitCode, null, 'Built Nitro exited before readiness');
    try { if ((await fetch(origin + '/.well-known/thingtime-capabilities.json', { signal: signal(AbortSignal.timeout(500)) })).ok) return; } catch {}
    await delay(200);
  }
  throw new Error('Nitro readiness timeout');
}
async function request(path, options = {}) {
  const url = new URL(path, origin); assert.equal(url.origin, origin, 'Credentials must remain on the isolated origin');
  const headers = new Headers(options.headers);
  headers.set('Origin', options.crossSite ? 'https://cross-site.invalid' : origin);
  if (options.crossSite) headers.set('Sec-Fetch-Site', 'cross-site');
  const selectedCookie = options.cookie === undefined ? cookie : options.cookie;
  if (selectedCookie) headers.set('Cookie', selectedCookie);
  return fetch(url, { method: options.method || 'GET', ...options, headers, redirect: 'error', signal: signal(options.signal || AbortSignal.timeout(120000)) });
}
async function api(path, body, options = {}) {
  // Only an explicit 429 is retried. Reuse the exact serialized immutable
  // command; uncertain transport failures are never blindly submitted again.
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  const send = () => request(path, { ...options, method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...options.headers }, ...(serialized === undefined ? {} : { body: serialized }) });
  let response = await send();
  for (let retries = 0; response.status === 429 && (options.status || 200) !== 429 && retries < 3; retries++) {
    const retryAfter = response.headers.get('retry-after');
    const seconds = /^\d+(?:\.\d+)?$/.test(retryAfter || '') ? Number(retryAfter) : (Date.parse(retryAfter || '') - Date.now()) / 1000;
    assert.ok(Number.isFinite(seconds) && seconds >= 0 && seconds <= 120, '429 requires a bounded explicit Retry-After');
    await response.body?.cancel(); await delay(Math.ceil(seconds * 1000) + 100); response = await send();
  }
  if (response.status !== (options.status || 200)) {
    const error = new Error('Unexpected fixture API status');
    let body; try { body = await response.json(); } catch {}
    error.fixture = { path: new URL(path, origin).pathname, status: response.status,
      code: typeof body?.code === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(body.code) ? body.code : null };
    throw error;
  }
  const data = await response.json();
  return { data, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
}
async function digest(blob) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of blob.stream()) { run.signal.throwIfAborted(); hash.update(chunk); bytes += chunk.byteLength; }
  return { bytes, sha256: hash.digest('hex') };
}
async function upload(blob, filename) {
  const command = { requestId: randomUUID(), filename, contentType: 'text/plain', sizeBytes: blob.size, purpose: 'file-import' };
  const { data: plan } = await api('/api/v1/attachments/uploads', command);
  const id = plan.upload.id; uploads.add(id);
  assert.deepEqual((await api('/api/v1/attachments/uploads', command)).data.upload, plan.upload, 'Exact start retry retains its upload identity');
  assert.ok(plan.upload.partCount > 1, 'Exercise multipart rather than a single PUT');
  for (let index = 0; index < plan.upload.partCount; index++) {
    const bytes = new Uint8Array(await blob.slice(index * plan.upload.partSizeBytes, (index + 1) * plan.upload.partSizeBytes).arrayBuffer());
    const checksum = createHash('sha256').update(bytes).digest('base64');
    const { data: signed } = await api('/api/v1/attachments/uploads/parts', { uploadId: id, parts: [{ partNumber: index + 1, checksumSha256: checksum }] });
    const part = signed.parts[0], url = new URL(part.url, origin);
    assert.equal(url.origin, origin); assert.equal(url.pathname, '/api/v1/attachments/local-object');
    assert.equal(part.partNumber, index + 1); assert.equal(part.headers['x-amz-checksum-sha256'], checksum);
    const put = await fetch(url, { method: 'PUT', redirect: 'error', credentials: 'omit', headers: part.headers, body: bytes, signal: signal(AbortSignal.timeout(120000)) })
      .catch(() => { throw new Error('Local object PUT failed; signed URL withheld'); });
    assert.ok(put.ok, `Object PUT HTTP ${put.status}`); await put.body?.cancel();
  }
  const { data: ready } = await api('/api/v1/attachments/uploads/complete', { uploadId: id });
  assert.equal(ready.attachment.id, id); assert.equal(ready.attachment.size, blob.size);
  const replay = (await api('/api/v1/attachments/uploads/complete', { uploadId: id })).data;
  assert.equal(replay.attachment.id, id); assert.equal(replay.attachment.size, blob.size);
  return id;
}
async function importBundle(bundle) {
  validateTransfer(bundle.manifest); serializeTransfer(bundle.manifest);
  const files = {};
  for (const file of bundle.manifest.files) files[file.id] = await upload(bundle.files.get(file.id), file.name);
  const { data } = await api('/api/v1/things/import', { manifest: bundle.manifest, files });
  assert.equal(data.ok, true); assert.equal(data.roots.length, 2);
  return data;
}
try {
  for (const port of Object.values(ports)) {
    const probe = createServer(); await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
    await new Promise(resolve => probe.close(resolve));
  }
  await writeFile(policy, `(version 1)(allow default)(deny network*)\n(allow network-bind (local unix-socket))\n(allow network-inbound ${Object.values(ports).map(port => `(local ip "localhost:${port}")`).join(' ')})\n(allow network-outbound ${Object.values(ports).map(port => `(remote ip "localhost:${port}")`).join(' ')})`);
  phase = 'network boundary';
  const boundary = start(process.execPath, ['--input-type=module', '-e', `for(const url of ['http://1.1.1.1:80/','http://127.0.0.1:19863/']){try{await fetch(url,{signal:AbortSignal.timeout(1500)});process.exit(2)}catch(error){if(error.cause?.code!=='EPERM')process.exit(3)}}`]);
  assert.equal((await once(boundary, 'exit', { signal: run.signal }))[0], 0, 'Direct external IP and disallowed loopback must both be denied');
  phase = 'replica setup'; await mkdir(join(dir, 'db')); await mkdir(join(dir, 'objects'));
  start('/opt/homebrew/bin/mongod', ['--dbpath', join(dir, 'db'), '--port', String(ports.db), '--bind_ip', '127.0.0.1', '--replSet', 'transfer-capacity', '--nounixsocket']);
  const client = new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`, { serverSelectionTimeoutMS: 500 });
  try {
    for (let i = 0; ; i++) { try { await client.connect(); break; } catch (error) { if (i >= 50) throw error; await delay(200); } }
    await client.db('admin').command({ replSetInitiate: { _id: 'transfer-capacity', members: [{ _id: 0, host: `127.0.0.1:${ports.db}` }] } });
    for (let i = 0; ; i++) { if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) break; if (i >= 100) throw new Error('Replica readiness timeout'); await delay(200); }
  } finally { await client.close(); }
  owner = start(process.execPath, ['.output/server/index.mjs']); await ready(owner);
  phase = 'capabilities';
  const { data: manifest } = await api('/.well-known/thingtime-capabilities.json'); assert.equal(manifest.origin, origin);
  for (const [feature, version] of Object.entries({ 'api.things-export': '1.18.0', 'api.things-import': '1.15.0', 'api.attachment-content': '1.18.0',
    'api.admin-subscriptions': '1.1.1', 'api.attachment-uploads': '1.3.0', 'api.attachment-upload-parts': '1.1.0', 'api.attachment-upload-complete': '1.3.0', 'api.attachment-delete': '1.1.0' }))
    assert.ok(capabilitySatisfies(manifest.features[feature]?.version, version), `Missing ${feature} ${version}`);
  phase = 'disposable account provisioning';
  const adminName = 'capacity-admin-' + randomUUID().slice(0, 8);
  const register = async username => api('/api/v1/auth/register', { username, email: `${username}@example.invalid`, password: randomBytes(32).toString('hex') }, { cookie: '' });
  adminCookie = (await register(adminName)).cookie;
  const account = await register('capacity-user-' + randomUUID().slice(0, 8)); cookie = account.cookie;
  assert.ok(cookie && adminCookie && account.data.user.id);
  // Canonical first-admin bootstrap explicitly requires signup before adding
  // ADMIN_USERNAMES. Restart the sole owner; no fixture DB privilege writes.
  await stop(owner); owner = start(process.execPath, ['.output/server/index.mjs'], { ADMIN_USERNAMES: adminName }); await ready(owner);
  await api('/api/v1/admin/users/public-uploads', { userId: account.data.user.id, enabled: true, scope: 'private' }, { cookie: adminCookie });
  const { data: me } = await api('/api/v1/auth/me'); assert.equal(me.user.privateUploadsEnabled, true); assert.equal(me.user.publicUploadsEnabled, false);
  phase = 'disposable account quota refusal';
  // Exact account-scoped admin assignment, discovered through the supported
  // subscription endpoint. Never change the tier catalog or disable admission.
  const subscriptionPath = '/api/v1/admin/subscriptions?subjectType=user&subjectId=' + encodeURIComponent(account.data.user.id);
  const { data: subscriptionState } = await api(subscriptionPath, undefined, { cookie: adminCookie });
  const tier = subscriptionState.catalog.find(value => value.versionId === subscriptionState.subscription.tierVersionId);
  assert.ok(tier, 'Resolve the exact live assigned tier revision');
  const setFixtureAllowance = async userStorageBytes => {
    const { data } = await api('/api/v1/admin/subscriptions', { subjectType: 'user', subjectId: account.data.user.id,
      tier: tier.id, tierVersionId: tier.versionId, overrides: { userStorageBytes }, note: 'Disposable transfer-capacity acceptance only' }, { cookie: adminCookie });
    assert.equal(data.subscription.subjectId, account.data.user.id);
    assert.equal(data.subscription.effective.userStorageBytes, userStorageBytes);
    const readback = (await api(subscriptionPath, undefined, { cookie: adminCookie })).data.subscription;
    assert.equal(readback.effective.userStorageBytes, userStorageBytes);
  };
  const size = 257 * 1024 * 1024, fixtures = [];
  await setFixtureAllowance(2 * 1024 * 1024);
  const refused = await api('/api/v1/attachments/uploads', { requestId: randomUUID(), filename: 'quota-refusal.txt',
    contentType: 'text/plain', sizeBytes: size, purpose: 'file-import' }, { status: 507 });
  assert.equal(refused.data.code, 'quota_exceeded', 'Ordinary quota admission must refuse before signed parts');
  assert.equal(refused.data.upload, undefined);
  phase = 'disposable account quota approval';
  await setFixtureAllowance(4 * 1024 * 1024 * 1024);
  phase = 'large fixture';
  // Distinct deterministic text bytes; only a 1MiB block is allocated eagerly.
  for (let i = 0; i < 2; i++) {
    const block = Buffer.alloc(1024 * 1024, i ? 0x62 : 0x61); block[0] = 0x0a;
    const blob = new Blob(Array.from({ length: 257 }, () => block), { type: 'text/plain' });
    fixtures.push({ blob, ...(await digest(blob)), id: `fixture-${i}`, targetId: `file-${i}`, name: `capacity-${i}.txt` });
  }
  const bundle = { manifest: { format: 'thingtime.transfer', version: 1, roots: fixtures.map(file => file.targetId),
    things: fixtures.map(file => ({ id: file.targetId, thingtime: ['attachment'], crystal: { recordingFileId: file.id, filePurpose: 'file' } })),
    files: fixtures.map((file, index) => ({ id: file.id, targetId: file.targetId, path: `files/${String(index).padStart(6, '0')}`, name: file.name, mime: 'text/plain', bytes: size, sha256: file.sha256 })) },
    files: new Map(fixtures.map(file => [file.id, file.blob])) };
  const body = { manifest: bundle.manifest, files: {} };
  await api('/api/v1/things/import', body, { cookie: '', status: 401 });
  await api('/api/v1/things/import', body, { crossSite: true, status: 403 });
  await api('/api/v1/things/export', { ids: [] }, { crossSite: true, status: 403 });
  phase = 'source upload and import'; const first = await importBundle(bundle);
  // Anonymous exports remain available for public Things; private stored-file
  // roots must instead be concealed through the real authorization reader.
  await api('/api/v1/things/export', { ids: first.roots }, { cookie: '', status: 404 });
  const concealed = await request('/api/v1/attachments/content?id=' + encodeURIComponent(first.roots[0]) + '&cache=validate', { cookie: '' });
  assert.ok([401, 403, 404].includes(concealed.status)); await concealed.body?.cancel();
  async function exportAndVerify(roots) {
    const { data } = await api('/api/v1/things/export', { ids: roots }); assert.equal(data.ok, true);
    assert.equal(data.plan.files.reduce((sum, file) => sum + file.bytes, 0), 2 * size);
    const exported = await bundleFromPlan(data.plan, { originalStream: true, fetch: request, signal: run.signal });
    await exported.assertCurrent(run.signal);
    const expected = new Map(fixtures.map(file => [file.name, file])); let total = 0;
    for (const file of exported.manifest.files) {
      const actual = await digest(exported.files.get(file.id)); total += actual.bytes;
      assert.equal(actual.bytes, expected.get(file.name).bytes); assert.equal(actual.sha256, expected.get(file.name).sha256); assert.equal(file.sha256, actual.sha256);
    }
    assert.equal(total, 2 * size); return exported;
  }
  phase = 'pinned original streaming'; const exported = await exportAndVerify(first.roots);
  phase = 'shipping ZIP roundtrip'; const archive = await encodeTransferArchiveBlob(exported, run.signal);
  const decoded = await decodeTransferArchiveBlob(archive, run.signal);
  for (const file of decoded.manifest.files) assert.deepEqual(await digest(decoded.files.get(file.id)), { bytes: file.bytes, sha256: file.sha256 });
  phase = 'independent copy import'; const second = await importBundle(decoded);
  assert.equal(new Set([...first.roots, ...second.roots]).size, 4, 'Copies need independent Thing/object identities');
  phase = 'source deletion';
  for (const id of first.roots) { assert.equal((await api('/api/v1/attachments/delete', { id })).data.deferred, false); uploads.delete(id); }
  phase = 'copy remains readable after source deletion'; await exportAndVerify(second.roots);
  for (const id of second.roots) { assert.equal((await api('/api/v1/attachments/delete', { id })).data.deferred, false); uploads.delete(id); }
  console.log(JSON.stringify({ ok: true, aggregateBytes: 2 * size, fileBytes: size, files: 2, copies: 2, realMultipart: true,
    independentSha256: true, pinnedOriginalStream: true, zipRoundtrip: true, copySurvivesSourceDeletion: true, networkDenyVerified: true, quotaRefusalVerified: true, fixtureAllowanceBytes: 4 * 1024 * 1024 * 1024, productionAccess: false }));
} catch (error) {
  // Never surface raw fetch errors (which may embed a signed URL), API bodies,
  // cookies or generated passwords. Phase + error class are sufficient to find
  // the failing assertion in this source without exposing private values.
  const sourceFrames = String(error?.stack || '').split('\n').filter(line => /at .*transfer-capacity-acceptance\.mjs:\d+:\d+/.test(line)).map(line => line.match(/transfer-capacity-acceptance\.mjs:(\d+:\d+)/)?.[1]);
  console.error(JSON.stringify({ ok: false, phase, error: error?.name || 'Error', code: error?.code || null, sourceFrames, ...(error.fixture ? { fixture: error.fixture } : {}) }));
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  // Attempt every owned child even after a previous cleanup failure. Never
  // delete an active replica's files to hide a process cleanup failure.
  const stops = await Promise.allSettled([...children].reverse().map(stop));
  const childrenStopped = [...children].every(child => child.exitCode !== null || child.signalCode !== null);
  let directoryGone = false;
  if (childrenStopped) {
    try { await rm(dir, { recursive: true, force: true }); await stat(dir); }
    catch (error) { directoryGone = error?.code === 'ENOENT'; }
  }
  const portChecks = await Promise.all(Object.values(ports).map(async port => {
    const probe = createServer();
    try { await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); }); await new Promise(resolve => probe.close(resolve)); return true; }
    catch { return false; }
  }));
  const portsClosed = portChecks.every(Boolean);
  const cleanupOk = childrenStopped && directoryGone && portsClosed && stops.every(result => result.status === 'fulfilled');
  console.log(JSON.stringify({ cleanup: true, ok: cleanupOk, childrenStopped, portsClosed, directoryGone, stopFailures: stops.filter(result => result.status === 'rejected').length }));
  if (!cleanupOk) process.exitCode = 1;
  process.removeListener('SIGTERM', interrupt); process.removeListener('SIGINT', interrupt);
}
