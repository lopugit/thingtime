import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILDER_THING_KIND, builderThingUpdateKinds, isBuilderThing, withBuilderThingKind } from './builderThing';
import { isFolderThing } from './folderThing';
import { validateThingtimeCrystal } from './registry';

const marker = BUILDER_THING_KIND;
test('recognizes explicit Builder identity and legacy compositional kinds without inferring arbitrary data', () => {
  for (const kind of ['webpage', 'component', 'action', 'schema']) {
    assert.equal(isBuilderThing({ thingtime: [kind] }), true);
    assert.deepEqual(withBuilderThingKind([kind]), [kind, marker]);
  }
  assert.equal(isBuilderThing({ thingtime: ['folder'], crystal: { builderApp: true } }), true);
  for (const kind of ['data', 'folder', 'post']) assert.equal(isBuilderThing({ thingtime: [kind], crystal: { name: 'Builder', blocks: [] } }), false);
  assert.equal(isBuilderThing({ thingtime: ['data', marker] }), true);
  assert.deepEqual(withBuilderThingKind(['data', marker, marker]), ['data', marker]);
});

test('registered marker composes with data/folders but cannot weaken their content exclusions', () => {
  for (const kinds of [['data', marker], [marker, 'data'], ['folder', marker]]) {
    const result = validateThingtimeCrystal(kinds, { name: 'Content', custom: 'data only' });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok) {
      assert.equal(result.thingtime.includes(marker), true);
      assert.equal(result.crystal.custom, kinds.includes('data') ? 'data only' : undefined);
    }
  }
  for (const kinds of [[marker], ['post', 'data', marker], ['folder', 'component', marker]]) assert.equal(validateThingtimeCrystal(kinds, {}).ok, false);
});

test('canonical writes automatically persist identity and preserve strict content sanitization', () => {
  for (const [kind, crystal] of [
    ['webpage', { name: 'Page', version: 1, blocks: [] }],
    ['component', { name: 'Component', render: { tag: 'p', children: ['Hello'] } }],
    ['schema', { name: 'Schema', fields: [] }],
    ['folder', { name: 'App', builderApp: true }]
  ] as const) {
    const result = validateThingtimeCrystal([kind], { ...crystal, unknownField: 'drop' });
    assert.equal(result.ok, true, JSON.stringify(result));
    if (result.ok) {
      assert.deepEqual(result.thingtime, [kind, marker]);
      assert.equal(result.crystal.unknownField, undefined);
    }
  }
  const ordinary = validateThingtimeCrystal(['data'], { name: 'Data' });
  assert.equal(ordinary.ok && ordinary.thingtime.includes(marker), false);
});

test('edits can add Builder identity without changing or removing content schemas', () => {
  assert.deepEqual(builderThingUpdateKinds(['data'], ['data', marker]), ['data', marker]);
  assert.deepEqual(builderThingUpdateKinds(['data', marker], ['data']), ['data', marker]);
  assert.deepEqual(builderThingUpdateKinds(['component', marker], ['component']), ['component', marker]);
  assert.deepEqual(builderThingUpdateKinds(['data'], undefined), ['data']);
  for (const requested of [null, [], ['schema', marker], [marker], ['data', 'post'], ['data', 12]]) assert.equal(builderThingUpdateKinds(['data'], requested), null);
});

test('legacy data folder semantics survive an additive Builder marker', () => {
  for (const kinds of [['data'], ['data', marker], [marker, 'data']]) assert.equal(isFolderThing({ thingtime: kinds, crystal: { kind: 'folder' } }), true);
  assert.equal(isFolderThing({ thingtime: ['data', 'post', marker], crystal: { kind: 'folder' } }), false);
});
