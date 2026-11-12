import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAlgorithmTransfer } from './algorithmTransferCore';
import { interestScore } from '../things/feedRanking';

const fixture = () => ({ name: 'My interests', emoji: '🧠', weights: {
  types: { text: 3.125 }, tags: { '庭園': 0.05 }, authors: { author: -2 }
}, eventCount: 42, lastTrainedAt: '2026-09-11T00:00:00.000Z' });

test('portable algorithms preserve every weight and ranking without sharing mutable state', () => {
  const source = fixture(); const parsed = parseAlgorithmTransfer(JSON.parse(JSON.stringify(source)));
  assert.deepEqual(parsed, source);
  const features = { type: 'text', tags: ['庭園'], ownerId: 'author', createdAt: new Date(0) };
  assert.equal(interestScore(parsed.weights, features), interestScore(source.weights, features));
  parsed.weights.types.text = 5;
  assert.equal(source.weights.types.text, 3.125);
});

test('algorithm transfers reject authority, lineage, active selection and executable training', () => {
  for (const key of ['ownerId', 'id', 'acl', 'shared', 'parentId', 'active', 'branchFrom', 'events']) {
    assert.throws(() => parseAlgorithmTransfer({ ...fixture(), [key]: 'forged' }));
  }
});

test('malformed and unbounded interest profiles fail rather than being truncated', () => {
  for (const weight of [NaN, Infinity, 50.01, -50.01, '3', null]) {
    assert.throws(() => parseAlgorithmTransfer({ ...fixture(), weights: { ...fixture().weights, tags: { tag: weight } } }));
  }
  for (const weights of [[], {}, { ...fixture().weights, extra: {} }, { ...fixture().weights, tags: [] },
    { ...fixture().weights, tags: JSON.parse('{"__proto__":1}') },
    { ...fixture().weights, tags: Object.fromEntries(Array.from({ length: 10_001 }, (_, i) => [String(i), 1])) }]) {
    assert.throws(() => parseAlgorithmTransfer({ ...fixture(), weights }));
  }
  for (const patch of [{ eventCount: -1 }, { eventCount: 1.5 }, { lastTrainedAt: 'yesterday' }, { lastTrainedAt: '2026-09-11' }, { name: ' x ' }]) {
    assert.throws(() => parseAlgorithmTransfer({ ...fixture(), ...patch }));
  }
});
