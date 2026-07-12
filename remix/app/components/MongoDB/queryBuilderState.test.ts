import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import {
  QueryBuilderError,
  compileBsonValue,
  compileFilterGroup,
  compileMongoQueryRequest,
  compileProjection,
  createBsonEntry,
  createBsonValue,
  createFilterGroup,
  createFilterRule,
  createInitialWorkbenchState
} from './queryBuilderState.ts';

test('compiles nested AND, OR, and NOR filter groups', () => {
  const root = createFilterGroup('and');
  const first = root.children[0];
  assert.equal(first.kind, 'rule');
  if (first.kind !== 'rule') return;
  first.field = 'kind';
  first.value.value = 'post';

  const nested = createFilterGroup('or');
  const second = nested.children[0];
  assert.equal(second.kind, 'rule');
  if (second.kind !== 'rule') return;
  second.field = 'ownerId';
  second.value.value = 'one';
  const third = createFilterRule();
  third.field = 'ownerId';
  third.value.value = 'two';
  nested.children.push(third);
  root.children.push(nested);

  assert.deepEqual(compileFilterGroup(root), {
    $and: [
      { kind: { $eq: 'post' } },
      { $or: [{ ownerId: { $eq: 'one' } }, { ownerId: { $eq: 'two' } }] }
    ]
  });

  nested.combinator = 'nor';
  assert.ok('$nor' in (compileFilterGroup(root).$and as any[])[1]);
});

test('compiles canonical Extended JSON BSON values', () => {
  assert.deepEqual(compileBsonValue(createBsonValue('objectId', '664f1c2a9d3e5b0012345678')), {
    $oid: '664f1c2a9d3e5b0012345678'
  });
  assert.deepEqual(compileBsonValue(createBsonValue('int64', '9007199254740993')), {
    $numberLong: '9007199254740993'
  });
  assert.deepEqual(compileBsonValue(createBsonValue('timestamp', '1710000000:2')), {
    $timestamp: { t: 1710000000, i: 2 }
  });
  assert.deepEqual(compileBsonValue(createBsonValue('uuid', '00112233-4455-6677-8899-aabbccddeeff')), {
    $binary: { base64: 'ABEiM0RVZneImaq7zN3u/w==', subType: '04' }
  });
});

test('recursive documents and arrays need valid, unique keys', () => {
  const doc = createBsonValue('document');
  doc.entries = [createBsonEntry('active', 'boolean', 'true'), createBsonEntry('tags', 'array')];
  doc.entries[1].value.entries = [createBsonEntry('', 'string', 'one'), createBsonEntry('', 'string', 'two')];
  assert.deepEqual(compileBsonValue(doc), { active: true, tags: ['one', 'two'] });

  doc.entries.push(createBsonEntry('active', 'string', 'duplicate'));
  assert.throws(() => compileBsonValue(doc), QueryBuilderError);
});

test('projection rejects mixed include and exclude modes except _id', () => {
  assert.deepEqual(
    compileProjection([
      { id: 'one', field: 'crystal.text', mode: 'include' },
      { id: 'two', field: '_id', mode: 'exclude' }
    ]),
    { 'crystal.text': 1, _id: 0 }
  );
  assert.throws(
    () =>
      compileProjection([
        { id: 'one', field: 'crystal.text', mode: 'include' },
        { id: 'two', field: 'ownerId', mode: 'exclude' }
      ]),
    /cannot mix/
  );
});

test('request compiler clamps resource options and omits irrelevant tools', () => {
  const state = createInitialWorkbenchState();
  state.limit = 1000;
  state.skip = -10;
  state.maxTimeMS = 999_999;
  state.hint = 'createdAt_1';
  state.collationEnabled = true;
  const request = compileMongoQueryRequest(state);
  assert.equal(request.limit, 250);
  assert.equal(request.skip, 0);
  assert.equal(request.maxTimeMS, 15_000);

  state.operation = 'estimatedDocumentCount';
  const estimate = compileMongoQueryRequest(state);
  assert.equal('limit' in estimate, false);
  assert.equal('skip' in estimate, false);
  assert.equal('filter' in estimate, false);
  assert.equal('pipeline' in estimate, false);
  assert.equal('hint' in estimate, false);
  assert.equal('collation' in estimate, false);
});

test('root-level text search compiles without a field name', () => {
  const group = createFilterGroup();
  const rule = group.children[0];
  if (rule.kind !== 'rule') throw new Error('expected rule');
  rule.operator = '$text';
  rule.value.value = 'hello world';
  assert.deepEqual(compileFilterGroup(group), { $text: { $search: 'hello world' } });
});
