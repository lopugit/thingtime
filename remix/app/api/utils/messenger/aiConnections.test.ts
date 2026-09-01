import assert from 'node:assert/strict';
import test from 'node:test';

import { splitImportedMessage, staleImportedSegmentIndexes } from './aiConnections';

test('splitImportedMessage keeps every imported code point within the native chat cap', () => {
  const source = `${'🌈'.repeat(2_500)}\n${'word '.repeat(1_000)}`;
  const chunks = splitImportedMessage(source, 4_000);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => Array.from(chunk).length <= 4_000));
  assert.equal(chunks.join('').replace(/\s/g, ''), source.replace(/\s/g, ''));
});

test('splitImportedMessage prefers a readable boundary', () => {
  assert.deepEqual(splitImportedMessage('one two three four', 10), ['one two', 'three four']);
});

test('shorter external message revisions identify every stale trailing segment', () => {
	assert.deepEqual(staleImportedSegmentIndexes(2, 5), [2, 3, 4]);
	assert.deepEqual(staleImportedSegmentIndexes(5, 5), []);
});
