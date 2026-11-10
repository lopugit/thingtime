// Explicitly disposable local fixture. Every account/content operation uses the real API.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { validateTransfer } from '../app/utils/thingTransfer/format';
const base = process.env.TT_DRAFT_TEST_BASE;
if (base !== 'http://127.0.0.1:22462') throw new Error('Requires dedicated disposable draft-preview API on 22462');
const status = await fetch(base + '/api/v1/mongodb/status').then(r => r.json());
assert.equal(status.host, '127.0.0.1:22463'); assert.equal(status.replicaSet, 'draftPreview'); assert.equal(status.custom, false);
const manifest = validateTransfer(JSON.parse(await readFile(new URL('../../artifacts/draft-preview/thingtime-draft.json', import.meta.url), 'utf8')));
let cookie = '';
const request = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', anonymous = false) => {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(!anonymous && cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
  return { status: response.status, data: await response.json(), headers: response.headers };
};
const username = `draft-qa-${randomUUID().slice(0, 8)}`;
const registration = await request('/api/v1/auth/register', { username, email: `${username}@example.invalid`, password: `Draft-${randomUUID()}-9a!` });
assert.equal(registration.data.ok, true, JSON.stringify(registration.data));
cookie = registration.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const imported = await request('/api/v1/things/import', { manifest });
assert.equal(imported.status, 200, JSON.stringify(imported.data));
const ids = imported.data.ids;
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
  const report = { ok: true, fixture: 'dedicated local draftPreview replica', imported: 2, freshIds: true, dependencyRemapped: true, privateAcl: true, anonymousReadsDenied: true, canonicalReexport: true };
  await writeFile(new URL('../../artifacts/draft-preview/import-verification.json', import.meta.url), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  for (const original of ['affirmation-page','affirmation-card']) {
    const removed = await request('/api/v1/things', { id: ids[original] }, 'DELETE');
    assert.equal(removed.status, 200);
  }
  await request('/api/v1/auth/logout', {});
}
