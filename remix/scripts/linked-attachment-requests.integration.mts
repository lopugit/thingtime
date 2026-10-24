// Disposable replica fixture: all content, account and quota access uses the real API.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = process.env.TT_DRAFT_TEST_BASE, session = process.env.TT_DRAFT_TEST_SESSION, artifacts = process.env.TT_DRAFT_ARTIFACT_DIR;
assert.ok(base && new URL(base).hostname === '127.0.0.1' && new URL(base).origin === base);
assert.match(session || '', /^[a-f0-9-]{36}$/); assert.ok(artifacts);
const request = async (path: string, body?: unknown, cookie = '', method = body === undefined ? 'GET' : 'POST', origin = base!) => {
  const response = await fetch(base + path, { method, redirect: 'error', headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  return { status: response.status, data: await response.json(), headers: response.headers };
};
const health = await request('/api/v1/health/nitro');
assert.equal(health.data.ok, true); assert.equal(health.data.testEnvironment?.mode, 'isolated-agent-test'); assert.equal(health.data.testEnvironment?.sessionId, session);
const mongo = (await request('/api/v1/mongodb/status')).data;
assert.equal(mongo.host, '127.0.0.1:27017'); assert.equal(mongo.replicaSet, `tt-agent-${session}`); assert.equal(mongo.custom, false);
for (const path of ['/api/v1/capabilities', '/.well-known/thingtime-capabilities.json']) {
  const manifest = (await request(path)).data;
  for (const [key, version] of [['api.attachment-link', '1.1.0'], ['api.attachment-delete', '1.8.0']])
    assert.equal(typeof manifest.features[key] === 'string' ? manifest.features[key] : manifest.features[key].version, version);
}
const register = async () => {
  const username = 'link-qa-' + randomUUID().slice(0, 8);
  const response = await request('/api/v1/auth/register', { username, email: username + '@example.invalid', password: randomUUID() + randomUUID() });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return { cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '), id: response.data.user.id };
};
const owner = await register(), other = await register();
const usage = async () => {
  const data = (await request('/api/v1/auth/me', undefined, owner.cookie)).data;
  assert.equal(data.user.storage.status, 'ready'); assert.equal(typeof data.user.storage.usedBytes, 'number'); return data.user.storage.usedBytes as number;
};
const link = (body: unknown, cookie = owner.cookie) => request('/api/v1/attachments/link', body, cookie);
const remove = (body: unknown) => request('/api/v1/attachments/delete', body, owner.cookie);
const read = (id: string, cookie = owner.cookie) => request('/api/v1/things?id=' + encodeURIComponent(id), undefined, cookie);
const input = { requestId: 'links-' + randomUUID(), url: 'https://example.invalid/image.png', purpose: 'post' };
const parents = new Set<string>(), drafts = new Set<string>();
let cleanupVerified = false;
try {
  assert.equal((await link(input, '')).status, 401);
  assert.equal((await request('/api/v1/attachments/link', input, owner.cookie, 'POST', 'https://attacker.invalid')).status, 403);
  const before = await usage();
  const initial = await link(input); assert.equal(initial.status, 200, JSON.stringify(initial.data));
  assert.match(initial.data.attachment.id, /^att_[a-f0-9]{64}$/); assert.equal(initial.data.attachment.size, 0);
  const id = initial.data.attachment.id; drafts.add(id);
  assert.equal(initial.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  const createdUsage = await usage(); assert.ok(createdUsage > before);
  const results = await Promise.all(Array.from({ length: 4 }, () => link(input)));
  for (const response of results) { assert.equal(response.status, 200, JSON.stringify(response.data)); assert.deepEqual(response.data, initial.data); }
  assert.equal(await usage(), createdUsage, 'Exact replay must not charge quota again');
  const concurrentInput = { ...input, requestId: 'first-race-' + randomUUID() };
  const beforeConcurrent = await usage();
  const concurrent = await Promise.all(Array.from({ length: 4 }, () => link(concurrentInput)));
  for (const response of concurrent) { assert.equal(response.status, 200, JSON.stringify(response.data)); assert.deepEqual(response.data, concurrent[0].data); }
  drafts.add(concurrent[0].data.attachment.id);
  assert.equal(await usage() - beforeConcurrent, createdUsage - before, 'Concurrent first creates must charge exactly one same-sized metadata document');
  for (const patch of [{ url: 'https://example.invalid/other.png' }, { purpose: 'comment' }, { mediaKind: 'file' }])
    assert.equal((await link({ ...input, ...patch })).status, 409);
  assert.equal((await read(id, '')).status, 404); assert.equal((await read(id, other.cookie)).status, 404);
  const draft = await read(id); assert.equal(draft.status, 200, JSON.stringify(draft.data)); assert.deepEqual(draft.data.thing.acl, ['tt:user']);
  const parentId = 'linked-parent-' + randomUUID();
  const parent = await request('/api/v1/things', { shareId: parentId, thingtime: ['post'], crystal: { type: 'text', text: 'Private linked gallery fixture' }, acl: ['tt:user'], attachmentIds: [id] }, owner.cookie);
  assert.equal(parent.status, 200, JSON.stringify(parent.data)); parents.add(parentId); drafts.delete(id);
  const bound = await link(input); assert.equal(bound.status, 200, JSON.stringify(bound.data)); assert.equal(bound.data.attachment.id, id);
  assert.equal((await read(parentId, '')).status, 404); assert.equal((await read(id, other.cookie)).status, 404);
  const annotated = await request('/api/v1/attachments/annotate', { id, title: 'Edited linked title', expectedUpdatedAt: bound.data.updatedAt }, owner.cookie);
  assert.equal(annotated.status, 200, JSON.stringify(annotated.data));
  const replay = await link(input); assert.equal(replay.status, 200); assert.equal(replay.data.attachment.title, 'Edited linked title'); assert.equal(replay.data.updatedAt, annotated.data.updatedAt);
  const deletion = { id, requestId: input.requestId, targetId: parentId, expectedUpdatedAt: replay.data.updatedAt };
  assert.equal((await remove({ ...deletion, expectedUpdatedAt: new Date(0).toISOString() })).status, 409);
  assert.equal((await remove({ ...deletion, targetId: 'wrong-target' })).status, 409);
  assert.equal((await request('/api/v1/attachments/delete', deletion, other.cookie)).status, 400);
  for (let retry = 0; retry < 2; retry++) { const removed = await remove(deletion); assert.equal(removed.status, 200, JSON.stringify(removed.data)); assert.equal(removed.data.deleted, true); }
  const deleted = await link(input); assert.equal(deleted.status, 409); assert.equal(deleted.data.code, 'upload_cancelled');
  const ordinary = await remove({ id: concurrent[0].data.attachment.id }); assert.equal(ordinary.status, 200); drafts.delete(concurrent[0].data.attachment.id);
  const ordinaryReplay = await link(concurrentInput); assert.equal(ordinaryReplay.status, 409); assert.equal(ordinaryReplay.data.code, 'upload_cancelled');
  const cancelledInput = { ...input, requestId: 'cancel-before-link-' + randomUUID() };
  const cancellation = await request('/api/v1/attachments/uploads/abort', { requestId: cancelledInput.requestId }, owner.cookie); assert.equal(cancellation.status, 200);
  const cancelled = await link(cancelledInput); assert.equal(cancelled.status, 409); assert.equal(cancelled.data.code, 'upload_cancelled');
  // Parent cascade also retains the link request receipt, independent of the explicit durable delete mode.
  const cascadeInput = { ...input, requestId: 'cascade-link-' + randomUUID() };
  const cascade = await link(cascadeInput); assert.equal(cascade.status, 200); drafts.add(cascade.data.attachment.id);
  const cascadeParentId = 'cascade-parent-' + randomUUID();
  const cascadeParent = await request('/api/v1/things', { shareId: cascadeParentId, thingtime: ['post'], crystal: { type: 'text', text: 'Private cascade fixture' }, acl: ['tt:user'], attachmentIds: [cascade.data.attachment.id] }, owner.cookie);
  assert.equal(cascadeParent.status, 200, JSON.stringify(cascadeParent.data)); parents.add(cascadeParentId); drafts.delete(cascade.data.attachment.id);
  assert.equal((await request('/api/v1/things', { id: cascadeParentId }, owner.cookie, 'DELETE')).status, 200); parents.delete(cascadeParentId);
  const cascadeReplay = await link(cascadeInput); assert.equal(cascadeReplay.status, 409); assert.equal(cascadeReplay.data.code, 'upload_cancelled');
} finally {
  for (const id of drafts) assert.equal((await remove({ id })).status, 200);
  for (const id of parents) assert.equal((await request('/api/v1/things', { id }, owner.cookie, 'DELETE')).status, 200);
  for (const account of [owner, other]) assert.equal((await request('/api/v1/auth/logout', {}, account.cookie)).status, 200);
  cleanupVerified = true;
}
const report = { ok: true, fixture: 'isolated-agent-test replica', session, builtManifests: true, concurrentFirstCreates: 4, concurrentExactReplays: 4,
  replayQuotaStable: true, concurrentDuplicateQuotaRolledBack: true, immutableTupleConflicts: true, privateAcl: true, guestAndForeignReadsDenied: true, replayAfterBindAndAnnotation: true,
  exactVersionAndTargetDeletion: true, cancelledBeforeCreation: true, ordinaryDeleteReplayFenced: true, parentCascadeReplayFenced: true,
  externalUrl: 'https://example.invalid/image.png', cleanupVerified, retainedCancellationReceipts: 'private accounted records in disposable database' };
await writeFile(resolve(artifacts!, 'linked-request-api-verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
