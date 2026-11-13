import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPinIntent, movePin, orderPinned, pinPathKey, thingPinPath } from './thingPathPins';

test('pin scopes distinguish pages and full parent ancestry without presentation state', () => {
  const a = thingPinPath('/things', ['one', 'shared']);
  const b = thingPinPath('/things', ['two', 'shared']);
  assert.notEqual(pinPathKey(a), pinPathKey(b));
  assert.notEqual(pinPathKey(a), pinPathKey(thingPinPath('/builder', ['one', 'shared'])));
  assert.deepEqual(thingPinPath('/things', [null, 'one']), ['/things', 'one']);
});

test('filtered reorder preserves hidden slots and pins added by another reader', () => {
  assert.deepEqual(applyPinIntent(['a', 'hidden', 'b', 'new'], { operation: 'reorder', thingIds: ['b', 'a'] }), ['b', 'hidden', 'a', 'new']);
  assert.deepEqual(applyPinIntent(['a', 'b'], { operation: 'pin', thingId: 'a' }), ['a', 'b']);
  assert.deepEqual(applyPinIntent(['a', 'b'], { operation: 'unpin', thingId: 'a' }), ['b']);
  assert.deepEqual(applyPinIntent(['a', 'b'], { operation: 'reorder', thingIds: ['missing', 'b', 'b', 'a'] }), ['b', 'a']);
});

test('moving a pin reaches both ends while ordinary items keep their normal stable sort', () => {
  assert.deepEqual(movePin(['a', 'b', 'c'], 'a', null), ['b', 'c', 'a']);
  assert.deepEqual(movePin(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
  const rows = [{ id: 'normal-first' }, { id: 'b' }, { id: 'normal-last' }, { id: 'a' }];
  assert.deepEqual(orderPinned(rows, ['a', 'b'], row => row.id).map(row => row.id), ['a', 'b', 'normal-first', 'normal-last']);
  assert.equal(rows[0].id, 'normal-first');
});
