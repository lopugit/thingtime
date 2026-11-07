// Explicitly disposable local fixture. Every account/content operation uses the real API.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTransfer } from '../app/utils/thingTransfer/format';
const base = process.env.TT_DRAFT_TEST_BASE;
const testSession = process.env.TT_DRAFT_TEST_SESSION;
if (testSession) {
  assert.match(testSession, /^[a-f0-9-]{36}$/);
  assert.ok(base && new URL(base).hostname === '127.0.0.1' && new URL(base).origin === base);
  const health = await fetch(base + '/api/v1/health/nitro', { redirect: 'error', signal: AbortSignal.timeout(10000) }).then(r => r.json());
  assert.equal(health.ok, true);
  assert.equal(health.testEnvironment?.mode, 'isolated-agent-test');
  assert.equal(health.testEnvironment?.sessionId, testSession);
} else if (base !== 'http://127.0.0.1:22462') throw new Error('Requires dedicated disposable draft-preview API on 22462');
const status = await fetch(base + '/api/v1/mongodb/status', { redirect: 'error', signal: AbortSignal.timeout(10000) }).then(r => r.json());
assert.equal(status.host, testSession ? '127.0.0.1:27017' : '127.0.0.1:22463');
assert.equal(status.replicaSet, testSession ? `tt-agent-${testSession}` : 'draftPreview');
assert.equal(status.custom, false);
const artifactDir = process.env.TT_DRAFT_ARTIFACT_DIR || fileURLToPath(new URL('../../artifacts/draft-preview', import.meta.url));
const canonicalJson = await readFile(resolve(artifactDir, 'thingtime-draft.json'), 'utf8');
const manifest = validateTransfer(JSON.parse(canonicalJson));
let cookie = '';
const request = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', anonymous = false) => {
  const response = await fetch(base + path, { method, redirect: 'error', headers: { 'Content-Type': 'application/json', ...(!anonymous && cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
  return { status: response.status, data: await response.json(), headers: response.headers };
};
const username = `draft-qa-${randomUUID().slice(0, 8)}`;
const registration = await request('/api/v1/auth/register', { username, email: `${username}@example.invalid`, password: `Draft-${randomUUID()}-9a!` });
assert.equal(registration.data.ok, true, JSON.stringify(registration.data));
cookie = registration.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const imported = await request('/api/v1/things/import', { manifest });
assert.equal(imported.status, 200, JSON.stringify(imported.data));
const ids = imported.data.ids;
const report = { ok: true, fixture: testSession ? 'isolated-agent-test replica' : 'dedicated local draftPreview replica', contentHash: createHash('sha256').update(canonicalJson).digest('hex'), imported: 2, freshIds: true, dependencyRemapped: true, privateAcl: true, anonymousReadsDenied: true, canonicalReexport: true, cleanupVerified: true };
try {
  assert.equal(Object.keys(ids).length, 2);
  for (const thing of manifest.things) {
    assert.notEqual(ids[thing.id], thing.id);
    const read = await request(`/api/v1/things?id=${ids[thing.id]}`);
    assert.equal(read.status, 200);
    assert.deepEqual(read.data.thing.acl, ['tt:user']);
    assert.equal((await request(`/api/v1/things?id=${ids[thing.id]}`, undefined, 'GET', true)).status, 404);
    if (thing.thingtime[0] === 'component') assert.deepEqual(read.data.thing.crystal.render, thing.crystal.render);
    else assert.equal(read.data.thing.crystal.blocks[0].component, ids['affirmation-card']);
  }
  const exported = await request('/api/v1/things/export', { ids: [ids['affirmation-page']] });
  assert.equal(exported.status, 200, JSON.stringify(exported.data));
  const plan = exported.data.plan;
  validateTransfer({ format: 'thingtime.transfer', version: 1, roots: plan.roots, things: plan.things, files: [] });
  assert.equal(plan.things.length, 2);
  assert.deepEqual(plan.things.find((t: any) => t.thingtime.includes('component')).crystal.args, manifest.things[1].crystal.args);
} finally {
  for (const original of ['affirmation-page','affirmation-card']) {
    const removed = await request('/api/v1/things', { id: ids[original] }, 'DELETE');
    assert.equal(removed.status, 200);
  }
  assert.equal((await request('/api/v1/auth/logout', {})).status, 200);
}
await writeFile(resolve(artifactDir, 'import-verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
