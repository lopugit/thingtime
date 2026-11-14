// Mixed-runtime HTTP regression. Business fixtures and mutations use only APIs;
// Mongo is read-only here, for physical fence/validator evidence.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';

export async function runMixedLegacyAclAcceptance({ request, owner, stranger, checks, evidenceDir, dir, env, start, port, waitFor, MongoClient }) {
  const entry = process.env.AGENT_REPORTING_LEGACY_SERVER;
  assert(entry, 'Mixed legacy ACL acceptance requires an explicitly built old server');
  assert(!resolve(entry).startsWith(resolve(new URL('..', import.meta.url).pathname)), 'Old server fixture must be external');
  const fixtureDir = resolve(dirname(entry), '../..');
  const provenance = JSON.parse(await readFile(join(fixtureDir, '.legacy-acl-fixture.json'), 'utf8'));
  assert.match(provenance.revision, /^451e79e[0-9a-f]{33}$/);
  assert.equal(provenance.ignoredEnvironmentCopied, false);
  assert.equal(createHash('sha256').update(await readFile(join(fixtureDir, 'app/api/utils/things/things.ts'))).digest('hex'), provenance.instrumentedWriterSha256);
  const gateDir = join(dir, 'legacy-gate'); await mkdir(gateDir);
  const legacyPort = await port(); const legacyOrigin = `http://127.0.0.1:${legacyPort}`;
  const server = start(process.execPath, [entry], { PORT: String(legacyPort), THINGTIME_LEGACY_ACL_BARRIER_DIR: gateDir });
  await waitFor(async () => {
    assert.equal(server.exitCode, null, 'Old server remains running');
    try { return (await fetch(legacyOrigin + '/.well-known/thingtime-capabilities.json', { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
  }, 'immutable legacy server');
  const old = (path, options = {}) => request(path, { ...options, targetOrigin: legacyOrigin, requestOrigin: legacyOrigin });
  const mongo = new MongoClient(env.MONGODB_CONNECTION_STRING);
  await mongo.connect();
  const db = mongo.db('thingtime');
  const collectionInfo = (await db.listCollections().toArray()).find(info => info.name === 'things_v2');
  assert(collectionInfo, 'Versioned business collection exists');
  const roots = db.collection(collectionInfo.name);
  const root = id => roots.findOne({ shareId: id });
  const details = [];
  const assertFenced = async (id, before) => {
    const doc = await root(id);
    assert(doc.aclGeneration, 'Audience migration persisted generation');
    assert(doc.aclWriteFenceAfter instanceof Date && doc.updatedAt instanceof Date);
    assert(doc.aclWriteFenceAfter.getTime() > before.updatedAt.getTime(), 'First migration timestamp is strictly greater than pre-migration timestamp');
    assert(doc.updatedAt >= doc.aclWriteFenceAfter);
    assert.deepEqual(doc.acl, ['tt:user', ...[...new Set(doc.aclBaseline.map(entry => '-' + entry.replace(/^-/, '')))]]);
    const info = (await db.listCollections({ name: collectionInfo.name }).toArray())[0];
    assert.equal(info.options.validationLevel, 'strict'); assert.equal(info.options.validationAction, 'error');
    assert.match(JSON.stringify(info.options.validator), /aclWriteFenceAfter/);
    assert.match(JSON.stringify(info.options.validator), /aclBaselineVersion/);
    return doc;
  };
  const arm = async id => {
    await rm(join(gateDir, 'entered.json'), { force: true }); await rm(join(gateDir, 'release'), { force: true });
    await writeFile(join(gateDir, 'arm.json'), JSON.stringify({ id }));
  };
  const entered = async id => {
    let state;
    await waitFor(async () => { state = await readFile(join(gateDir, 'entered.json'), 'utf8').then(JSON.parse).catch(() => null); return state?.id === id; }, 'old request pre-update timing barrier');
    return state;
  };
  const release = async () => { await writeFile(join(gateDir, 'release'), 'release'); await rm(join(gateDir, 'arm.json'), { force: true }); };
  try {
    // Ordinary legacy request was authorized against an inline public ACL.
    const ordinary = (await old('/api/v1/things', { cookie: owner.cookie, body: { thingtime: ['data'], acl: ['tt:all'], crystal: { name: 'mixed ordinary' } } })).data.thing;
    assert(ordinary?.id); const ordinaryBefore = await root(ordinary.id);
    assert.equal(ordinaryBefore.aclGeneration, undefined);
    await arm(ordinary.id);
    const staleOrdinary = old('/api/v1/things/update', { cookie: owner.cookie, status: null, body: { id: ordinary.id, crystal: { name: 'stale ordinary must refuse' } } });
    assert.equal((await entered(ordinary.id)).ordinaryCas, true);
    const excluded = `-tt:user/${stranger.data.user.username}`;
    await request('/api/v1/things/acl', { cookie: owner.cookie, body: { id: ordinary.id, operation: 'add', entries: [excluded] } });
    const ordinaryMigrated = await assertFenced(ordinary.id, ordinaryBefore);
    await release(); const ordinaryResult = await staleOrdinary;
    assert.equal(ordinaryResult.response.status, 409, 'Pre-admitted ordinary legacy CAS refuses after migration');
    assert.deepEqual((await root(ordinary.id)).acl, ordinaryMigrated.acl);
    await request('/api/v1/things?id=' + ordinary.id, { cookie: stranger.cookie, status: 404 });
    await old('/api/v1/things/update', { cookie: owner.cookie, body: { id: ordinary.id, crystal: { name: 'fresh ordinary content survives' } } });
    assert.deepEqual((await root(ordinary.id)).acl, ordinaryMigrated.acl);
    assert.equal((await root(ordinary.id)).crystal.name, 'fresh ordinary content survives');
    const rawOrdinary = await old('/api/v1/things/update', { cookie: owner.cookie, status: null, body: { id: ordinary.id, acl: ['tt:all'] } });
    assert(rawOrdinary.response.status >= 400, 'Old raw audience replacement is rejected by Mongo fence');
    const exact = (await request('/api/v1/things?id=' + ordinary.id, { cookie: owner.cookie })).data.thing;
    assert(exact.acl.includes(excluded)); await request('/api/v1/things?id=' + ordinary.id, { cookie: stranger.cookie, status: 404 });
    details.push({ path: 'ordinary', staleStatus: ordinaryResult.response.status, rawReplacementStatus: rawOrdinary.response.status, freshContentEdit: true, exclusionReadback: true, monotonicMigration: true });

    // App sandbox skips the ordinary updatedAt CAS. Its captured positive ACL
    // must therefore be stopped by the persisted strict Mongo validator.
    const sandbox = (await old('/api/v1/oauth/sandbox', { body: { clientId: 'mixed-legacy-acl', origin: legacyOrigin, scope: 'profile.username app-data app-data.shared' } })).data;
    assert(sandbox.token);
    const scoped = (path, options = {}, current = false) => request(path, { ...options, token: sandbox.token, targetOrigin: current ? undefined : legacyOrigin, requestOrigin: legacyOrigin });
    const sandboxThing = (await scoped('/api/v1/things', { body: { thingtime: ['data'], visibility: 'private', crystal: { name: 'mixed sandbox' } } })).data.thing;
    assert(sandboxThing?.id); const sandboxBefore = await root(sandboxThing.id); assert.equal(sandboxBefore.aclGeneration, undefined);
    await arm(sandboxThing.id);
    const staleSandbox = scoped('/api/v1/things/update', { status: null, body: { id: sandboxThing.id, crystal: { name: 'stale sandbox must refuse' } } });
    assert.equal((await entered(sandboxThing.id)).ordinaryCas, false);
    await scoped('/api/v1/things/update', { body: { id: sandboxThing.id, visibility: 'private' } }, true);
    const sandboxMigrated = await assertFenced(sandboxThing.id, sandboxBefore);
    assert.equal(sandboxMigrated.sizeBytes, sandboxBefore.sizeBytes, 'Migration leaves the legacy size CAS unchanged so the persisted validator is exercised');
    await release(); const sandboxResult = await staleSandbox;
    assert(sandboxResult.response.status >= 400, 'Pre-admitted sandbox without CAS is rejected');
    assert.deepEqual((await root(sandboxThing.id)).acl, sandboxMigrated.acl);
    assert.equal((await root(sandboxThing.id)).crystal.name, 'mixed sandbox');
    await scoped('/api/v1/things/update', { body: { id: sandboxThing.id, crystal: { name: 'fresh sandbox content survives' } } });
    assert.deepEqual((await root(sandboxThing.id)).acl, sandboxMigrated.acl);
    const rawSandbox = await scoped('/api/v1/things/update', { status: null, body: { id: sandboxThing.id, visibility: 'private' } });
    assert(rawSandbox.response.status >= 400, 'Old raw sandbox ACL replacement is rejected');
    assert.deepEqual((await root(sandboxThing.id)).acl, sandboxMigrated.acl);
    await scoped('/api/v1/things?id=' + sandboxThing.id, {}, true);
    details.push({ path: 'sandbox-no-CAS', staleStatus: sandboxResult.response.status, rawReplacementStatus: rawSandbox.response.status, freshContentEdit: true, negativeFenceReadback: true, monotonicMigration: true });
    checks.push('real immutable old API 451e79e and current built API share only a disposable replica/generated auth; ordinary pre-admitted stale CAS and sandbox no-CAS writes refuse after relational migration; raw old ACL replacements refuse while fresh old content edits preserve exact negative fence and exclusion');
    checks.push('read-only Mongo listCollections confirms persisted strict/error validator; physical API-written roots have exact baseline fence, strict first-migration timestamp advance and updatedAt at or above stored floor');
    await writeFile(join(evidenceDir, 'mixed-legacy-acl-acceptance.json'), JSON.stringify({ passed: true, legacySource: provenance.revision, legacyEntry: resolve(entry), provenance, instrumentation: 'timing-only wait immediately before expectedSize/updateOne after authorization and captured update payload; no authentication or business-data changes', businessWrites: 'HTTP only', mongoUse: 'read-only validator and exact root evidence', details, completedAt: new Date().toISOString() }, null, 2));
  } finally { await release().catch(() => {}); await mongo.close(); }
}
