import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { normalizeMongoQueryRequest, redactMongoValue } from './querySafety.ts';

test('rejects writes and server-side JavaScript at any depth', async () => {
  const merge = await normalizeMongoQueryRequest({
    operation: 'aggregate',
    collection: 'things',
    pipeline: [{ $facet: { unsafe: [{ $merge: 'things' }] } }]
  });
  assert.equal('status' in merge, true);
  if ('status' in merge) assert.match(merge.error, /\$merge/);

  const javascript = await normalizeMongoQueryRequest({ filter: { $expr: { $function: { body: 'x' } } } });
  assert.equal('status' in javascript, true);
  if ('status' in javascript) assert.match(javascript.error, /\$function/);
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
