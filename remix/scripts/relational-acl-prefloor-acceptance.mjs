// Real predecessor API creates historical roots; all business mutations stay HTTP.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

export async function runPreFloorAclAcceptance({ request, owner, stranger, checks, evidenceDir, env, start, port, waitFor, MongoClient }) {
  const entry = process.env.AGENT_REPORTING_PREFLOOR_SERVER;
  const inlineEntry = process.env.AGENT_REPORTING_LEGACY_SERVER;
  assert(entry && inlineEntry, 'Pre-floor acceptance requires both explicit predecessor runtimes');
  const fixtureDir = resolve(dirname(entry), '../..');
  const provenance = JSON.parse(await readFile(join(fixtureDir, '.legacy-acl-fixture.json'), 'utf8'));
  assert.match(provenance.revision, /^b8912cec[0-9a-f]{32}$/); assert.equal(provenance.instrumentation, 'none');
  assert.equal(provenance.ignoredEnvironmentCopied, false);
  assert.equal(createHash('sha256').update(await readFile(join(fixtureDir, 'app/api/utils/things/things.ts'))).digest('hex'), provenance.originalWriterSha256);
  const boot = async source => {
    const origin = `http://127.0.0.1:${await port()}`;
    const child = start(process.execPath, [source], { PORT: new URL(origin).port });
    await waitFor(async () => { assert.equal(child.exitCode, null); try { return (await fetch(origin + '/.well-known/thingtime-capabilities.json', { signal: AbortSignal.timeout(800) })).ok; } catch { return false; } }, 'historical API startup');
    return (path, options = {}) => request(path, { ...options, targetOrigin: origin, requestOrigin: origin });
  };
  const predecessor = await boot(entry); const inline = await boot(inlineEntry);
  const mongo = new MongoClient(env.MONGODB_CONNECTION_STRING); await mongo.connect();
  const db = mongo.db('thingtime'); const things = db.collection('things_v2');
  const root = id => things.findOne({ shareId: id });
  const page = async (id, family = 'audience') => (await request('/api/v1/things/acl?' + new URLSearchParams({ id, family }), { cookie: owner.cookie })).data;
  try {
    const originalOptions = (await db.listCollections({ name: 'things_v2' }).toArray())[0].options;
    assert(!originalOptions.validator, 'Historical roots must be API-created before the new validator is installed');
    const pat = (await predecessor('/api/v1/tokens', { cookie: owner.cookie, status: 201, body: { name: 'Synthetic pre-floor scoped writer', scopes: ['things.read', 'things.update', 'things.react'], onlyCreatedThings: true, allowGet: true } })).data;
    assert(pat.token && pat.tokenInfo?.id);
    const tokenEntry = `tt:token/${pat.tokenInfo.id}`;
    const excluded = `-tt:user/${stranger.data.user.username}`;
    const audience = (await predecessor('/api/v1/things', { cookie: owner.cookie, body: { thingtime: ['data'], acl: ['tt:all', excluded], crystal: { name: 'prefloor alpha' } } })).data.thing;
    const tokenPost = (await predecessor('/api/v1/things', { cookie: owner.cookie, body: { thingtime: ['post'], acl: ['tt:user'], tokenAcl: [tokenEntry], crystal: { type: 'text', text: 'prefloor alpha', richText: null } } })).data;
    const tokenId = tokenPost.post?.id || tokenPost.thing?.id;
    assert(audience?.id && tokenId);
    const before = new Map();
    for (const [id, family] of [[audience.id, 'audience'], [tokenId, 'token']]) {
      const doc = await root(id); assert.equal(Object.hasOwn(doc, 'aclWriteFenceAfter'), false);
      assert(family === 'audience' ? doc.aclGeneration : doc.tokenAclGeneration);
      before.set(id, { doc, grants: await things.find({ targetId: id, thingtime: 'acl-entry' }).sort({ shareId: 1 }).toArray() });
      assert(before.get(id).grants.length > 0, 'Historical API persists a real relational grant row');
    }
    assert(!(await db.listCollections({ name: 'things_v2' }).toArray())[0].options.validator);
    const guard = (await request('/api/v1/things', { cookie: owner.cookie, body: { thingtime: ['data'], acl: ['tt:user'], crystal: { name: 'Synthetic validator bootstrap' } } })).data.thing;
    await request('/api/v1/things/acl', { cookie: owner.cookie, body: { id: guard.id, operation: 'add', entries: ['tt:user/synthetic-fence-reader'] } });
    const installed = (await db.listCollections({ name: 'things_v2' }).toArray())[0].options;
    assert.equal(installed.validationLevel, 'strict'); assert.equal(installed.validationAction, 'error');
    for (const id of before.keys()) assert.equal(Object.hasOwn(await root(id), 'aclWriteFenceAfter'), false);
    const beforeRawAudience = await inline('/api/v1/things/update', { cookie: owner.cookie, status: null, body: { id: audience.id, acl: ['tt:all'] } });
    const beforeRawToken = await inline('/api/v1/things/update', { cookie: owner.cookie, status: null, body: { id: tokenId, tokenAcl: ['tt:token/synthetic-forbidden'] } });
    assert(beforeRawAudience.response.status >= 400); assert(beforeRawToken.response.status >= 400);
    await request('/api/v1/things?id=' + audience.id, { cookie: stranger.cookie, status: 404 });
    const reacted = await request('/api/v1/things/react', { token: pat.token, body: { id: tokenId, emoji: '🧪' } });
    assert.equal(reacted.data.reactionCounts['🧪'], 1);
    assert((await root(tokenId)).updatedAt >= before.get(tokenId).doc.updatedAt, 'Dedicated reaction creation touches the historical root');
    await request('/api/v1/things/react', { token: pat.token, body: { id: tokenId, emoji: '🧪' } });
    const touched = await root(tokenId); assert(touched.tokenGrantFence, 'Dedicated token-authorized reaction touches the historical root');
    assert.equal(Object.hasOwn(touched, 'aclWriteFenceAfter'), false, 'Dedicated touch keeps valid legacy format until content upgrade');
    const ledgerBefore = (await request('/api/v1/auth/me', { cookie: owner.cookie })).data.user;
    assert(Number.isSafeInteger(ledgerBefore.storageUsedBytes), 'Live account storage measurement must be populated');
    const billable = () => things.find({ ownerId: owner.data.user.id, storageClass: 'content' }, { projection: { shareId: 1, thingtime: 1, sizeBytes: 1 } }).toArray();
    const sumBytes = rows => rows.reduce((total, row) => { assert(Number.isSafeInteger(row.sizeBytes) && row.sizeBytes >= 0); return total + row.sizeBytes; }, 0);
    const billedBefore = await billable(); assert.equal(sumBytes(billedBefore), ledgerBefore.storageUsedBytes);
    const details = [];
    for (const [id, family, crystal] of [[audience.id, 'audience', { name: 'prefloor bravo' }], [tokenId, 'token', { text: 'prefloor bravo' }]]) {
      const previous = await root(id);
      const entriesBefore = (await page(id, family)).entries;
      await request('/api/v1/things/update', { cookie: owner.cookie, body: { id, crystal } });
      const upgraded = await root(id);
      console.log(JSON.stringify({ event: 'prefloor-lazy-upgrade', family, previousBytes: previous.sizeBytes, upgradedBytes: upgraded.sizeBytes, previousFields: Object.keys(previous.crystal), upgradedFields: Object.keys(upgraded.crystal) }));
      assert(upgraded.aclWriteFenceAfter instanceof Date && upgraded.aclWriteFenceAfter > previous.updatedAt);
      assert(upgraded.updatedAt >= upgraded.aclWriteFenceAfter);
      for (const field of ['acl', 'aclGeneration', 'aclRevision', 'aclEntryCount', 'tokenAcl', 'tokenAclGeneration', 'tokenAclRevision', 'tokenAclEntryCount', 'sizeBytes', 'storageClass', 'storageAccountingVersion']) assert.deepEqual(upgraded[field], previous[field], `Lazy floor upgrade preserves ${field}`);
      assert.deepEqual((await page(id, family)).entries, entriesBefore);
      assert.deepEqual(await things.find({ targetId: id, thingtime: 'acl-entry' }).sort({ shareId: 1 }).toArray(), before.get(id).grants);
      details.push({ family, createdByHistoricalApi: true, floorInitiallyAbsent: true, floorUpgradedStrictly: true, grantRowsAndRevisionsPreserved: true, logicalBytesAndAccountingVersionPreserved: true });
    }
    const ledgerAfter = (await request('/api/v1/auth/me', { cookie: owner.cookie })).data.user;
    const billedAfter = await billable(); assert.equal(sumBytes(billedAfter), ledgerAfter.storageUsedBytes);
    const previousBilled = new Map(billedBefore.map(row => [row.shareId, row.sizeBytes]));
    for (const row of billedAfter) if (previousBilled.has(row.shareId)) assert.equal(row.sizeBytes, previousBilled.get(row.shareId), 'Existing billable bytes stay unchanged');
    const addedBilled = billedAfter.filter(row => !previousBilled.has(row.shareId));
    assert.equal(addedBilled.length, 2); assert(addedBilled.every(row => row.thingtime.includes('timeline-event')));
    const historyBytes = sumBytes(addedBilled);
    assert.equal(ledgerAfter.storageUsedBytes - ledgerBefore.storageUsedBytes, historyBytes, 'Only the two normal content-history events add billed storage');
    await request('/api/v1/things?id=' + audience.id, { cookie: stranger.cookie, status: 404 });
    await request('/api/v1/things/update', { token: pat.token, body: { id: tokenId, crystal: { text: 'prefloor delta' } } });
    const afterRawAudience = await inline('/api/v1/things/update', { cookie: owner.cookie, status: null, body: { id: audience.id, acl: ['tt:all'] } });
    const afterRawToken = await inline('/api/v1/things/update', { cookie: owner.cookie, status: null, body: { id: tokenId, tokenAcl: ['tt:token/synthetic-forbidden'] } });
    assert(afterRawAudience.response.status >= 400); assert(afterRawToken.response.status >= 400);
    assert((await page(audience.id)).entries.includes(excluded)); assert((await page(tokenId, 'token')).entries.includes(tokenEntry));
    checks.push('actual uninstrumented b891 predecessor creates audience/token relational roots before validator installation; dedicated scoped reaction works before lazy upgrade; ordinary equal-size edits stamp strict floors while preserving grants, revisions and logical bytes; independent billable-row totals match account ledger with only two normal history events charged; old raw ACL/token replacements refuse before and after');
    await writeFile(join(evidenceDir, 'prefloor-relational-acl-acceptance.json'), JSON.stringify({ passed: true, provenance, details, dedicatedTouchBeforeUpgrade: true, accountLedgerMatchesBillableRows: true, addedHistoryBytes: historyBytes, rawReplacementStatuses: { before: [beforeRawAudience.response.status, beforeRawToken.response.status], after: [afterRawAudience.response.status, afterRawToken.response.status] }, businessWrites: 'HTTP only', mongoUse: 'read-only exact roots/grants, billable-row totals and collection metadata', completedAt: new Date().toISOString() }, null, 2));
  } finally { await mongo.close(); }
}
