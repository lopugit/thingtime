import assert from 'node:assert/strict';
import test from 'node:test';
import { validateThingtimeCrystal } from './registry.ts';
import { composePostThing, postThingDraft, postThingReferences } from '../components/Feed/postThingReferences.ts';
const validate = (thing: unknown) => validateThingtimeCrystal(['post'], { type: 'thingtime', thing });

test('a multi-Thing post retains modes and inline values without copying supplied source content', () => {
  const input = { kind: 'thing-collection', items: [{ id: 'data-1', mode: 'data', crystal: { secret: 'not-authority' } }, { id: 'component-1', mode: 'interactive' }], data: { zero: 0, empty: '', off: false, nothing: null } };
  const result = validate(input);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.crystal.thing, { kind: 'thing-collection', items: [{ id: 'data-1', mode: 'data' }, { id: 'component-1', mode: 'interactive' }], data: input.data });
  assert.deepEqual(composePostThing(postThingDraft(result.crystal.thing), postThingReferences(result.crystal.thing)), result.crystal.thing);
});

test('post reference validation rejects duplicates, invalid ids, modes and oversized sets', () => {
  const item = { id: 'one', mode: 'data' };
  for (const items of [[], [item, item], [{ ...item, id: '../private' }], [{ ...item, mode: 'execute' }], [null], Array.from({ length: 21 }, (_, index) => ({ ...item, id: `id-${index}` }))]) {
    assert.equal(validate({ kind: 'thing-collection', items }).ok, false);
  }
  for (const data of [null, [], 'text']) assert.equal(validate({ kind: 'thing-collection', items: [item], data }).ok, false);
  assert.equal(validate({ kind: 'thing-collection', items: Array.from({ length: 20 }, (_, index) => ({ ...item, id: `id-${index}` })) }).ok, true);
});

test('old inline Things preserve their arbitrary data and round-trip without a reference wrapper', () => {
  const data = { kind: 'poll', question: 'Hello?', options: ['One', 'Two'], extra: { value: null } };
  assert.deepEqual(postThingReferences(data), []);
  assert.deepEqual(postThingDraft(data), data);
  assert.deepEqual(composePostThing(data, []), data);
  assert.equal(validate(data).ok, true);
});

test('generic display titles survive typed sanitization without altering existing content', () => {
  const result = validateThingtimeCrystal(['folder'], { name: 'Renamed folder', title: 'Renamed folder', icon: '📁', description: 'Kept content' });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.crystal, { name: 'Renamed folder', title: 'Renamed folder', icon: '📁', description: 'Kept content' });
  assert.equal(validateThingtimeCrystal(['folder'], { name: 'Original', title: { unsafe: true } }).ok, false);
  assert.equal(validateThingtimeCrystal(['folder'], { name: 'Original', title: 'x'.repeat(301) }).ok, false);
});
