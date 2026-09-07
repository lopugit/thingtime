import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { hardenThingsQuery, normalizeMongoQueryRequest, redactMongoValue } from './querySafety.ts';

const normalized = async (body: Record<string, unknown>) => {
  const result = await normalizeMongoQueryRequest(body);
  assert.equal('status' in result, false, `expected normalize to pass: ${JSON.stringify((result as any).error)}`);
  return result as Exclude<Awaited<ReturnType<typeof normalizeMongoQueryRequest>>, { status: number }>;
};

test('rejects writes and server-side JavaScript at any depth', async () => {
  const merge = await normalizeMongoQueryRequest({
    operation: 'aggregate',
    collection: 'things',
    pipeline: [{ $facet: { unsafe: [{ $merge: 'things' }] } }]
  });
  assert.equal('status' in merge, true);
  if ('status' in merge) assert.match(merge.error, /\$merge/);

  // `themes` has no protected-field pre-checks, so the rejection below is the
  // structural $function block, not the protected-$expr guard `things` now has
  const javascript = await normalizeMongoQueryRequest({
    collection: 'themes',
    filter: { $expr: { $function: { body: 'x' } } }
  });
  assert.equal('status' in javascript, true);
  if ('status' in javascript) assert.match(javascript.error, /\$function/);
});

test('protects things-era secure fields from probing and aliasing', async () => {
  const probe = await normalizeMongoQueryRequest({
    collection: 'things',
    operation: 'countDocuments',
    filter: { 'secure.email': { $exists: true } }
  });
  assert.equal('status' in probe, true);

  const aliased = await normalizeMongoQueryRequest({
    collection: 'things',
    operation: 'find',
    projection: { harmless: '$secure' }
  });
  assert.equal('status' in aliased, true);

  const lookupAlias = await normalizeMongoQueryRequest({
    operation: 'aggregate',
    collection: 'themes',
    pipeline: [{ $project: { leaked: '$owner.uniqueKeys' } }]
  });
  assert.equal('status' in lookupAlias, true);

  // hidden-link bearer secret: whoever reads it can view the unlisted thing,
  // so it is guarded exactly like the credential fields — no filter probe, no
  // alias out of the redactor, and masked in any response it reaches
  const linkKeyProbe = await normalizeMongoQueryRequest({
    collection: 'things',
    operation: 'find',
    filter: { linkKey: { $exists: true } }
  });
  assert.equal('status' in linkKeyProbe, true);

  const linkKeyAlias = await normalizeMongoQueryRequest({
    collection: 'things',
    operation: 'find',
    projection: { harmless: '$linkKey' }
  });
  assert.equal('status' in linkKeyAlias, true);

  const redacted = redactMongoValue({ secure: { email: 'x' }, uniqueKeys: ['y'], linkKey: 'z', crystal: { name: 'ok' } });
  assert.deepEqual(redacted.value, {
    secure: '[redacted]',
    uniqueKeys: '[redacted]',
    linkKey: '[redacted]',
    crystal: { name: 'ok' }
  });
});

test('strips protected thing fields at every pipeline ingress', async () => {
  // primary collection: strip prepended
  const primary = hardenThingsQuery(await normalized({ collection: 'things', operation: 'aggregate', pipeline: [{ $sort: { createdAt: -1 } }] }));
  assert.equal('status' in primary, false);
  if (!('status' in primary)) assert.deepEqual(primary.pipeline[0], { $project: { secure: 0, uniqueKeys: 0, linkKey: 0 } });

  // $unionWith from things (string and object forms) gains a stripped sub-pipeline
  const union = hardenThingsQuery(
    await normalized({
      collection: 'themes',
      operation: 'aggregate',
      pipeline: [{ $unionWith: { coll: 'things', pipeline: [{ $project: { kv: { $objectToArray: '$$ROOT' } } }] } }]
    })
  );
  assert.equal('status' in union, false);
  if (!('status' in union)) {
    const unionStage = (union.pipeline[0] as any).$unionWith;
    assert.deepEqual(unionStage.pipeline[0], { $project: { secure: 0, uniqueKeys: 0, linkKey: 0 } });
  }

  // $lookup from things gains a stripped pipeline even in localField form
  const lookup = hardenThingsQuery(
    await normalized({
      collection: 'themes',
      operation: 'aggregate',
      pipeline: [{ $lookup: { from: 'things', localField: 'ownerId', foreignField: 'shareId', as: 'owner' } }]
    })
  );
  assert.equal('status' in lookup, false);
  if (!('status' in lookup)) {
    const lookupStage = (lookup.pipeline[0] as any).$lookup;
    assert.deepEqual(lookupStage.pipeline[0], { $project: { secure: 0, uniqueKeys: 0, linkKey: 0 } });
  }

  // $graphLookup cannot be stripped — reading things through it is rejected
  const graph = hardenThingsQuery(
    await normalized({
      collection: 'themes',
      operation: 'aggregate',
      pipeline: [
        { $graphLookup: { from: 'things', startWith: '$ownerId', connectFromField: 'ownerId', connectToField: 'shareId', as: 'chain' } }
      ]
    })
  );
  assert.equal('status' in graph, true);

  // Mongo's _id exception: { crystal: 0, _id: 1 } is an EXCLUSION projection,
  // so the strip must still be merged in; a bare { _id: 1 } stays inclusion
  // (EJSON canonical mode wraps numbers as Int32 — compare via Number())
  const plain = (projection: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(projection).map(([key, value]) => [key, Number(value)]));
  const exclusion = hardenThingsQuery(await normalized({ collection: 'things', operation: 'find', projection: { crystal: 0, _id: 1 } }));
  assert.equal('status' in exclusion, false);
  if (!('status' in exclusion)) assert.deepEqual(plain(exclusion.projection), { crystal: 0, _id: 1, secure: 0, uniqueKeys: 0, linkKey: 0 });
  const idOnly = hardenThingsQuery(await normalized({ collection: 'things', operation: 'find', projection: { _id: 1 } }));
  assert.equal('status' in idOnly, false);
  if (!('status' in idOnly)) assert.deepEqual(plain(idOnly.projection), { _id: 1 });
});

test('keeps ordinary field names and $expr usable outside protected scopes', async () => {
  // $expr in a non-protected collection's pipeline is legitimate again
  const expr = await normalizeMongoQueryRequest({
    collection: 'themes',
    operation: 'aggregate',
    pipeline: [{ $match: { $expr: { $gt: ['$likes', '$reposts'] } } }]
  });
  assert.equal('status' in expr, false);

  // an ordinary crystal field (no sensitive name) is freely queryable on things
  const ordinary = await normalizeMongoQueryRequest({
    collection: 'things',
    operation: 'find',
    filter: { 'crystal.legs': { $gt: 3 } }
  });
  assert.equal('status' in ordinary, false);

  // the query guard mirrors the response redactor: a crystal field whose name
  // the redactor would mask (…token…/…apiKey…) can't be filtered/aliased out
  // from under it, so those queries are rejected on things too
  const redactorConsistent = await normalizeMongoQueryRequest({
    collection: 'things',
    operation: 'find',
    filter: { 'crystal.apiKey': { $gt: '' } }
  });
  assert.equal('status' in redactorConsistent, true);
  const aliasedCrystalSecret = await normalizeMongoQueryRequest({
    collection: 'things',
    operation: 'aggregate',
    pipeline: [{ $project: { leaked: '$crystal.apiKey' } }]
  });
  assert.equal('status' in aliasedCrystalSecret, true);

  // $text stays available on things (secure is BinData the text index never tokenizes)
  const text = await normalizeMongoQueryRequest({
    collection: 'things',
    operation: 'find',
    filter: { $text: { $search: 'kettle' } }
  });
  assert.equal('status' in text, false);

  // …but $expr on things itself is still a whole-document probe → rejected
  const thingsExpr = await normalizeMongoQueryRequest({
    collection: 'things',
    operation: 'find',
    filter: { $expr: { $eq: ['$a', 1] } }
  });
  assert.equal('status' in thingsExpr, true);

  // and naming a protected path in ANY pipeline is still rejected
  const aliased = await normalizeMongoQueryRequest({
    collection: 'themes',
    operation: 'aggregate',
    pipeline: [{ $project: { leaked: '$owner.secure' } }]
  });
  assert.equal('status' in aliased, true);

  // $getField naming a protected field (both shorthand + object forms) is caught
  const getFieldShorthand = await normalizeMongoQueryRequest({
    collection: 'things',
    operation: 'aggregate',
    pipeline: [{ $addFields: { leaked: { $getField: 'secure' } } }]
  });
  assert.equal('status' in getFieldShorthand, true);
  const getFieldObject = await normalizeMongoQueryRequest({
    collection: 'things',
    operation: 'aggregate',
    pipeline: [{ $addFields: { leaked: { $getField: { field: 'uniqueKeys', input: '$$ROOT' } } } }]
  });
  assert.equal('status' in getFieldObject, true);

  // a COMPUTED $getField field arg can't be verified statically → rejected
  const getFieldComputed = await normalizeMongoQueryRequest({
    collection: 'things',
    operation: 'aggregate',
    pipeline: [{ $addFields: { leaked: { $getField: { field: { $literal: 'apiKey' }, input: '$crystal' } } } }]
  });
  assert.equal('status' in getFieldComputed, true);
});

test('redacts $objectToArray-materialized sensitive values by sibling key', () => {
  // $objectToArray output shape: sensitive field name becomes a `k` value, the
  // secret a `v` value under non-sensitive keys — masked by the sibling-k rule
  const materialized = redactMongoValue({
    kv: [
      { k: 'label', v: 'coffee' },
      { k: 'apiKey', v: 'sk-live-secret' },
      { k: 'password', v: 'hunter2' }
    ]
  });
  assert.deepEqual(materialized.value, {
    kv: [
      { k: 'label', v: 'coffee' },
      { k: 'apiKey', v: '[redacted]' },
      { k: 'password', v: '[redacted]' }
    ]
  });
  assert.equal(materialized.redactedFields, 2);
});

test('enforces the read-only stage allowlist inside nested sub-pipelines', async () => {
  // a non-allowlisted stage nested in a $lookup pipeline is rejected
  const nestedLookup = await normalizeMongoQueryRequest({
    collection: 'themes',
    operation: 'aggregate',
    pipeline: [{ $lookup: { from: 'things', pipeline: [{ $notARealStage: {} }], as: 'x' } }]
  });
  assert.equal('status' in nestedLookup, true);

  // …inside a $unionWith pipeline
  const nestedUnion = await normalizeMongoQueryRequest({
    collection: 'themes',
    operation: 'aggregate',
    pipeline: [{ $unionWith: { coll: 'things', pipeline: [{ $notARealStage: {} }] } }]
  });
  assert.equal('status' in nestedUnion, true);

  // …inside a $facet branch
  const nestedFacet = await normalizeMongoQueryRequest({
    collection: 'things',
    operation: 'aggregate',
    pipeline: [{ $facet: { branch: [{ $notARealStage: {} }] } }]
  });
  assert.equal('status' in nestedFacet, true);

  // a legitimate nested read-only pipeline still passes
  const okNested = await normalizeMongoQueryRequest({
    collection: 'themes',
    operation: 'aggregate',
    pipeline: [{ $lookup: { from: 'things', pipeline: [{ $match: { thingtime: 'user' } }, { $limit: 1 }], as: 'x' } }]
  });
  assert.equal('status' in okNested, false);
});

test('protects authentication collections from aliasing and aggregation', async () => {
  const computed = await normalizeMongoQueryRequest({
    operation: 'find',
    collection: 'users',
    projection: { harmlessName: '$passwordHash' }
  });
  assert.equal('status' in computed, true);

  const aggregate = await normalizeMongoQueryRequest({
    operation: 'aggregate',
    collection: 'sessions',
    pipeline: [{ $project: { harmlessName: '$jti' } }]
  });
  assert.equal('status' in aggregate, true);

  const joined = await normalizeMongoQueryRequest({
    operation: 'aggregate',
    collection: 'things',
    pipeline: [{ $lookup: { from: 'users', localField: 'ownerId', foreignField: '_id', as: 'owner' } }]
  });
  assert.equal('status' in joined, true);

  const directProbe = await normalizeMongoQueryRequest({
    operation: 'countDocuments',
    collection: 'users',
    filter: { passwordHash: { $regex: '^a' } }
  });
  assert.equal('status' in directProbe, true);

  const expressionProbe = await normalizeMongoQueryRequest({
    operation: 'find',
    collection: 'sessions',
    filter: { $expr: { $eq: ['$refreshToken', 'guess'] } }
  });
  assert.equal('status' in expressionProbe, true);
});

test('deserializes canonical Extended JSON values without evaluating code', async () => {
  const result = await normalizeMongoQueryRequest({
    collection: 'things',
    operation: 'find',
    filter: {
      _id: { $eq: { $oid: '664f1c2a9d3e5b0012345678' } },
      createdAt: { $gte: { $date: '2024-01-01T00:00:00.000Z' } },
      size: { $eq: { $numberLong: '9007199254740993' } }
    }
  });
  assert.equal('status' in result, false);
  if ('status' in result) return;
  assert.equal((result.filter._id as any).$eq._bsontype, 'ObjectId');
  assert.ok((result.filter.createdAt as any).$gte instanceof Date);
  assert.equal((result.filter.size as any).$eq._bsontype, 'Long');
});

test('redacts nested auth material, JWTs, and credentialed MongoDB URLs', () => {
  const result = redactMongoValue({
    passwordHash: 'hash',
    nested: { accessToken: 'token', refreshTokens: ['one'], apiKeys: ['two'], safe: 'visible' },
    jwtValue: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
    uri: 'mongodb://person:password@example.test/thingtime'
  });
  assert.deepEqual(result.value, {
    passwordHash: '[redacted]',
    nested: {
      accessToken: '[redacted]',
      refreshTokens: '[redacted]',
      apiKeys: '[redacted]',
      safe: 'visible'
    },
    jwtValue: '[redacted-jwt]',
    uri: 'mongodb://***@example.test/thingtime'
  });
  assert.equal(result.redactedFields, 6);
});

test('enforces array, regex, depth, and join complexity limits', async () => {
  const largeIn = await normalizeMongoQueryRequest({ filter: { id: { $in: Array.from({ length: 251 }, (_, i) => i) } } });
  assert.equal('status' in largeIn, true);

  const regex = await normalizeMongoQueryRequest({ filter: { text: { $regex: 'x'.repeat(257) } } });
  assert.equal('status' in regex, true);

  const joins = await normalizeMongoQueryRequest({
    operation: 'aggregate',
    collection: 'things',
    pipeline: Array.from({ length: 4 }, (_, index) => ({
      $lookup: { from: 'themes', localField: `field${index}`, foreignField: '_id', as: `joined${index}` }
    }))
  });
  assert.equal('status' in joins, true);
});

test('rejects query-only options on metadata operations', async () => {
  const result = await normalizeMongoQueryRequest({
    collection: 'things',
    operation: 'collectionStats',
    hint: 'createdAt_1'
  });
  assert.equal('status' in result, true);
  if ('status' in result) assert.match(result.error, /does not support hints or collation/);
});
