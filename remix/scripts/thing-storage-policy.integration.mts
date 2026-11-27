/** Invoked by the disposable replica fixture after real auth/file bootstrap. */
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { canonicalDevicePairingClaimBytes, generateDeviceCredential, generateDevicePairingNonce } from '../app/api/utils/devices/deviceAuth';
import * as pairing from '../app/routes/api/v1/devices/pairing/_pairing';
import * as claimDevice from '../app/routes/api/v1/devices/pairing/claim/_claim';
import { AUTOMATIC_STORAGE_PLACEMENT_EXCLUDED, THING_STORAGE_POLICY_PATH } from '../app/utils/thingStoragePolicy';
import { loader, action } from '../app/routes/api/v1/things/storage-policy/_storage-policy';
import * as things from '../app/routes/api/v1/things/_things';
import * as files from '../app/routes/api/v1/files/_files';
import * as links from '../app/routes/api/v1/attachments/link/_link';
import * as apps from '../app/routes/api/v1/apps/_apps';
import * as authorizeApp from '../app/routes/api/v1/oauth/authorize/_authorize';

type Handler = (input: { request: Request }) => Response | Promise<Response>;
export async function runThingStoragePolicyProof(input: { base: string; cookie: string; otherCookie: string; file: any }) {
  const { base, cookie, otherCookie, file } = input;
  const call = async (handler: Handler, path: string, options: { auth?: string; bearer?: string; body?: unknown; method?: string; origin?: string } = {}) => {
    const { auth = cookie, bearer, body, method = body === undefined ? 'GET' : 'POST', origin = base } = options;
    const response = await handler({ request: new Request(base + path, { method, headers: { Origin: origin, Cookie: auth, ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) });
    return { response, data: await response.json() };
  };
  const ok = async (...args: Parameters<typeof call>) => {
    const result = await call(...args);
    assert.equal(result.response.status, 200, `${args[1].split('?')[0]}: ${result.data.error || 'status'}`);
    assert.equal(result.data.ok, true);
    return result;
  };
  const thingsPath = '/api/v1/things';
  const create = async (crystal: unknown, thingtime = ['data']) => (await ok(things.action, thingsPath, { body: { thingtime, crystal, acl: ['tt:user'] } })).data.thing;
  const target = await create({ name: 'Placement fixture', data: 'owner data' });
  const path = (id: string) => `${THING_STORAGE_POLICY_PATH}?id=${encodeURIComponent(id)}`;
  const read = async (id: string, auth = cookie) => (await ok(loader, path(id), { auth })).data;
  const save = (body: unknown, auth = cookie) => ok(action, THING_STORAGE_POLICY_PATH, { body, auth });
  const initial = await read(target.id);
  assert.equal(initial.canEdit, true);
  assert.equal(initial.device, null);
  assert.deepEqual(initial.policy, { revision: null, cloudSync: true, defaultLocalAvailability: 'inherit', automaticDownloadDeviceId: null });
  assert.equal((await call(loader, path(target.id), { auth: otherCookie })).response.status, 404);
  assert.equal((await call(loader, `${path(target.id)}&deviceId=unpaired-device`)).response.status, 404);
  assert.equal((await call(action, THING_STORAGE_POLICY_PATH, { auth: '', body: { action: 'register-browser' } })).response.status, 401);
  assert.equal((await call(action, THING_STORAGE_POLICY_PATH, { origin: 'https://untrusted.example', body: { action: 'register-browser' } })).response.status, 403);

  async function installation(auth = cookie) {
    const registered = await save({ action: 'register-browser' }, auth);
    assert.equal(registered.data.installation.kind, 'browser');
    const setCookie = registered.response.headers.get('set-cookie');
    assert.ok(setCookie?.includes('HttpOnly') && setCookie.includes('SameSite=strict'));
    return { id: registered.data.installation.id, auth: `${cookie}; ${setCookie!.split(';')[0]}` };
  }
  const first = await installation(), second = await installation();
  assert.notEqual(first.id, second.id);
  assert.equal((await installation(first.auth)).id, first.id);
  const browser = await read(target.id, first.auth);
  assert.deepEqual(browser.device, { id: first.id, kind: 'browser', revision: null, localAvailability: 'inherit' });
  const change = { id: target.id, expectedSourceRevision: browser.source.revision, expectedPolicyRevision: null, expectedDeviceRevision: null,
    deviceId: first.id, policy: { cloudSync: true, automaticDownloadDeviceId: first.id }, localAvailability: 'keep' };
  assert.equal((await call(action, THING_STORAGE_POLICY_PATH, { auth: second.auth, body: change })).response.status, 404);
  assert.equal((await call(action, THING_STORAGE_POLICY_PATH, { auth: first.auth, body: { ...change, policy: { automaticDownloadDeviceId: second.id } } })).response.status, 400);
  const raced = await Promise.all([call(action, THING_STORAGE_POLICY_PATH, { auth: first.auth, body: change }), call(action, THING_STORAGE_POLICY_PATH, { auth: first.auth, body: change })]);
  assert.deepEqual(raced.map(result => result.response.status).sort(), [200, 409]);
  const pinned = await read(target.id, first.auth);
  assert.equal(pinned.source.revision, browser.source.revision);
  assert.equal(pinned.source.sourceHash, browser.source.sourceHash);
  assert.equal(pinned.policy.automaticDownloadDeviceId, first.id);
  assert.equal(pinned.device.localAvailability, 'keep');
  assert.equal((await read(target.id, second.auth)).device.localAvailability, 'inherit');
  assert.equal((await call(loader, `${path(target.id)}&deviceId=${first.id}`, { auth: second.auth })).response.status, 404);
  const policyCas = { id: target.id, expectedSourceRevision: pinned.source.revision, expectedPolicyRevision: pinned.policy.revision };
  const localCas = { ...policyCas, deviceId: first.id, expectedDeviceRevision: pinned.device.revision, localAvailability: 'cloud-only' };
  const evict = (await save(localCas, first.auth)).data;
  assert.equal(evict.device.localAvailability, 'cloud-only');
  assert.equal((await call(action, THING_STORAGE_POLICY_PATH, { auth: first.auth, body: localCas })).response.status, 409);
  const updated = await ok(things.action, thingsPath, { method: 'PATCH', body: { id: target.id, crystal: { data: 'new data' }, acl: ['tt:all'] } });
  assert.equal(updated.data.thing.id, target.id);
  assert.equal((await call(action, THING_STORAGE_POLICY_PATH, { auth: first.auth, body: { ...policyCas, policy: { cloudSync: false } } })).response.status, 409);
  const otherView = await read(target.id, otherCookie);
  assert.equal(otherView.canEdit, false);
  assert.equal(otherView.policy.revision, null);
  assert.equal(otherView.policy.automaticDownloadDeviceId, null);
  assert.equal(otherView.device, null);
  assert.equal((await call(loader, `${path(target.id)}&attachments=1`, { auth: otherCookie })).response.status, 404);
  assert.equal((await call(action, THING_STORAGE_POLICY_PATH, { auth: otherCookie, body: { ...policyCas, policy: { cloudSync: false } } })).response.status, 404);
  assert.equal((await ok(things.loader, `${thingsPath}?id=${target.id}`)).data.thing.crystal.data, 'new data');
  assert.ok((await call(things.action, thingsPath, { body: { thingtime: ['thing-device-storage-policy'], crystal: { localAvailability: 'keep' } } })).response.status >= 400);

  const exactFile = (await ok(loader, `${path(file.id)}&attachments=1`)).data;
  assert.equal(exactFile.source.revision, file.revision);
  assert.deepEqual(exactFile.attachments, { items: [{ id: file.content.attachmentId, version: file.content.version, size: file.content.size,
    fingerprint: file.content.fingerprint }], nextCursor: null });
  const currentFile = await read(file.id, first.auth);
  await save({ id: file.id, expectedSourceRevision: currentFile.source.revision, expectedPolicyRevision: null,
    deviceId: first.id, expectedDeviceRevision: null, localAvailability: 'cloud-only', policy: { cloudSync: false } }, first.auth);
  assert.equal((await read(file.id, second.auth)).policy.cloudSync, false);
  const root = await create({ name: 'Disposable automatic sync root' }, ['folder']);
  const blockedSync = await call(files.action, '/api/v1/files', { body: { id: file.id, operationId: randomUUID(),
    expectedRevision: file.revision, name: file.name, folderId: root.id, attachmentId: file.content.attachmentId,
    contentVersion: file.content.version, trashed: false, syncDestination: { rootId: root.id, path: file.name } } });
  assert.equal(blockedSync.response.status, 409);
  assert.equal(blockedSync.data.error, 'Cloud sync is paused for this file');
  assert.equal(blockedSync.data.code, AUTOMATIC_STORAGE_PLACEMENT_EXCLUDED);

  assert.deepEqual((await ok(files.loader, `/api/v1/files?id=${file.id}`)).data.file, file);

  const jsonThing = await create({ name: 'Conditional cloud fixture', data: 'initial' });
  const patch = (body: Record<string, unknown>) => call(things.action, thingsPath, { method: 'PATCH', body });
  const update = { id: jsonThing.id, crystal: { data: 'automatic write' }, expectedStoragePolicyRevision: null };
  assert.equal((await patch(update)).response.status, 200);
  const observed = await read(jsonThing.id);
  const pause = (await save({ id: jsonThing.id, expectedSourceRevision: observed.source.revision,
    expectedPolicyRevision: null, policy: { cloudSync: false } })).data;
  const refused = await patch({ ...update, crystal: { data: 'must stay local' } });
  assert.equal(refused.response.status, 409);
  assert.equal(refused.data.error, 'Cloud sync is paused for this Thing');
  assert.equal((await ok(things.loader, `${thingsPath}?id=${jsonThing.id}`)).data.thing.crystal.data, 'automatic write');
  assert.equal((await patch({ ...update, expectedStoragePolicyRevision: 'forged' })).response.status, 400);
  assert.equal((await patch({ id: jsonThing.id, crystal: { data: 'explicit cloud edit' } })).response.status, 200);
  const edited = await read(jsonThing.id);
  const resumed = (await save({ id: jsonThing.id, expectedSourceRevision: edited.source.revision,
    expectedPolicyRevision: pause.policy.revision, policy: { cloudSync: true } })).data;
  assert.equal((await patch(update)).response.status, 409, 'An older placement revision cannot publish after resume');
  assert.equal((await patch({ ...update, expectedStoragePolicyRevision: resumed.policy.revision })).response.status, 200);
  const concurrent = await read(jsonThing.id);
  const conflicting = await Promise.all([
    patch({ ...update, crystal: { data: 'another cloud revision' }, expectedStoragePolicyRevision: concurrent.policy.revision }),
    call(action, THING_STORAGE_POLICY_PATH, { body: { id: jsonThing.id, expectedSourceRevision: concurrent.source.revision,
      expectedPolicyRevision: concurrent.policy.revision, policy: { cloudSync: false } } })
  ]);
  assert.deepEqual(conflicting.map(result => result.response.status).sort(), [200, 409]);

  const appOrigin = 'https://storage-fixture.example.invalid';
  const registeredApp = (await ok(apps.action, '/api/v1/apps', { body: { name: 'Placement fixture app', origins: [appOrigin] } })).data.app;
  const appGrant = (await ok(authorizeApp.action, '/api/v1/oauth/authorize', { body: {
    clientId: registeredApp.clientId, origin: appOrigin, scope: 'app-data', scopes: ['app-data']
  } })).data;
  const appOptions = { auth: '', bearer: appGrant.token, origin: appOrigin };
  const namespaced = (await ok(things.action, thingsPath, { ...appOptions, body: { thingtime: ['data'], crystal: { value: 'first' } } })).data.thing;
  assert.equal((await call(loader, path(namespaced.id))).response.status, 404);
  const namespacedPatch = { id: namespaced.id, crystal: { value: 'owner edit' }, expectedStoragePolicyRevision: null };
  assert.equal((await call(things.action, thingsPath, { ...appOptions, method: 'PATCH', body: namespacedPatch })).response.status, 403);
  assert.equal((await patch(namespacedPatch)).data.thing.crystal.value, 'owner edit');

  const post = (await ok(things.action, thingsPath, { body: { thingtime: ['post'], acl: ['tt:user'],
    crystal: { type: 'text', text: 'Attachment policy fixture' } } })).data.post;
  const link = (await ok(links.action, '/api/v1/attachments/link', { body: {
    url: 'https://example.test/fixture.png', purpose: 'post'
  } })).data.attachment;
  const postPolicy = await read(post.id);
  const postPause = (await save({ id: post.id, expectedSourceRevision: postPolicy.source.revision,
    expectedPolicyRevision: null, policy: { cloudSync: false } })).data;
  const withAttachment = { id: post.id, crystal: { text: 'Guarded attachment publication' }, attachmentIds: [link.id] };
  assert.equal((await patch({ ...withAttachment, expectedStoragePolicyRevision: null })).response.status, 409);
  const postPath = `${thingsPath}?id=${post.id}`;
  const postAfterRefusal = (await ok(things.loader, postPath)).data;
  assert.equal(postAfterRefusal.post.text, 'Attachment policy fixture');
  assert.equal(postAfterRefusal.post.attachments?.length ?? 0, 0);
  const postResume = (await save({ id: post.id, expectedSourceRevision: postPause.source.revision,
    expectedPolicyRevision: postPause.policy.revision, policy: { cloudSync: true } })).data;
  const attachmentResult = await patch({ ...withAttachment, expectedStoragePolicyRevision: postResume.policy.revision });
  assert.equal(attachmentResult.response.status, 200);
  assert.equal((await ok(things.loader, postPath)).data.post.attachments[0].id, link.id);

  const pairingSecret = (await ok(pairing.action, '/api/v1/devices/pairing', { method: 'POST' })).data.pairing.pairingSecret;
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyValue = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64url');
  const nonce = generateDevicePairingNonce();
  const proof = (await ok(claimDevice.action, '/api/v1/devices/pairing/claim', { auth: '', body: {
    op: 'prepare', pairingSecret, publicKey: publicKeyValue, nonce
  } })).data.proof;
  const device = { name: 'Disposable policy device', platform: 'ios' as const, model: null, osVersion: null, appVersion: null };
  const credential = generateDeviceCredential(), capabilities: string[] = [];
  const claim = { pairingId: proof.pairingId, pairingSecret, credential, publicKey: publicKeyValue, nonce, serverNonce: proof.serverNonce, device, capabilities };
  const signature = sign(null, canonicalDevicePairingClaimBytes(claim), privateKey).toString('base64url');
  const pairedId = (await ok(claimDevice.action, '/api/v1/devices/pairing/claim', { auth: '', body: {
    op: 'complete', pairingSecret, credential, device, capabilities, proof: { pairingId: proof.pairingId, publicKey: publicKeyValue, nonce, serverNonce: proof.serverNonce, signature }
  } })).data.device.id;
  const rulesPath = `${THING_STORAGE_POLICY_PATH}?automatic=1&deviceId=${pairedId}`;
  const sparse = (await ok(loader, rulesPath)).data;
  assert.ok(sparse.revision);
  assert.equal(sparse.rules.find((rule: any) => rule.id === file.id).cloudSync, false);
  assert.equal(sparse.rules.find((rule: any) => rule.id === target.id).automaticDownloadDeviceId, first.id);
  assert.equal(sparse.rules.find((rule: any) => rule.id === target.id).localAvailability, 'inherit');
  assert.deepEqual((await ok(loader, `${rulesPath}&revision=${sparse.revision}`)).data,
    { ok: true, revision: sparse.revision, unchanged: true, rules: [], nextCursor: null });
  assert.equal((await call(loader, rulesPath, { auth: otherCookie })).response.status, 404);
  const pairedView = (await ok(loader, `${path(target.id)}&deviceId=${pairedId}`)).data;
  assert.deepEqual(pairedView.device, { id: pairedId, kind: 'paired', revision: null, localAvailability: 'inherit' });
  await save({ id: target.id, expectedSourceRevision: pairedView.source.revision, expectedPolicyRevision: pairedView.policy.revision,
    deviceId: pairedId, expectedDeviceRevision: null, localAvailability: 'cloud-only' });
  assert.equal((await call(loader, `${rulesPath}&revision=${sparse.revision}&cursor=${file.id}`)).response.status, 409);
  assert.equal((await ok(loader, rulesPath)).data.rules.find((rule: any) => rule.id === target.id).localAvailability, 'cloud-only');

  const missing = Array.from({ length: 17 }, (_, i) => `att_missingfixture${String(i).padStart(2, '0')}`);
  const page = await create({ name: 'Manifest pagination fixture', blocks: missing.map((id, index) => ({ id: `image-${index}`, type: 'media',
    src: `/api/v1/attachments/content?id=${id}` })) }, ['webpage']);
  const a = (await ok(loader, `${path(page.id)}&attachments=1`)).data;
  assert.equal(a.attachments.items.length, 16);
  assert.ok(a.attachments.nextCursor);
  const b = (await ok(loader, `${path(page.id)}&attachments=1&cursor=${a.attachments.nextCursor}`)).data;
  assert.equal(b.attachments.nextCursor, null);
  assert.deepEqual(a.source, b.source);
  assert.deepEqual([...a.attachments.items, ...b.attachments.items], missing.map(id => ({ id, version: null, size: null, fingerprint: null })));
  await ok(things.action, `${thingsPath}?id=${target.id}`, { method: 'DELETE' });
  assert.equal((await call(loader, path(target.id), { auth: first.auth })).response.status, 404);
  console.log('Thing storage policy real handlers passed with isolated browser scopes and exact attachment fingerprints.');
}
