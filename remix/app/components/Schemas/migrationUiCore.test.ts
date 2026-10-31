import assert from 'node:assert/strict';
import test from 'node:test';

import { actionableAdoptionIssues, formatGenerationBytes, generationIndexRatio } from './migrationUiCore';

const issues = ['things: legacy collection still exists beside things_v2 — run merge-legacy-collections'];

test('hides adoption warnings when the legacy merge has no pending documents', () => {
  assert.deepEqual(actionableAdoptionIssues(issues, [{ id: 'merge-legacy-collections', pending: 0 }]), []);
});

test('keeps adoption warnings while the legacy merge has actionable work', () => {
  assert.deepEqual(actionableAdoptionIssues(issues, [{ id: 'merge-legacy-collections', pending: 2 }]), issues);
});

test('keeps adoption warnings when the authoritative merge status is unavailable', () => {
  assert.deepEqual(actionableAdoptionIssues(issues, [{ id: 'things-v1-to-v2', pending: 0 }]), issues);
});

test('generation byte formatting is human-scaled and honest about an absent census', () => {
  assert.equal(formatGenerationBytes(undefined), '—');
  assert.equal(formatGenerationBytes(-1), '—');
  assert.equal(formatGenerationBytes(512), '512 B');
  assert.equal(formatGenerationBytes(1536), '1.5 KB');
  assert.equal(formatGenerationBytes(3_146_980_000), '2.9 GB');
  assert.equal(formatGenerationBytes(322 * 1024 * 1024), '322 MB');
});

test('the index-to-document ratio flags bloated generations and tolerates empty ones', () => {
  assert.equal(generationIndexRatio({ dataBytes: 1_234_000_000, indexBytes: 3_300_000_000 })?.toFixed(2), '2.67');
  assert.equal(generationIndexRatio({ dataBytes: 100, indexBytes: 4_000 }), 40);
  assert.equal(generationIndexRatio({ dataBytes: 0, indexBytes: 0 }), null);
  assert.equal(generationIndexRatio({ dataBytes: 0, indexBytes: 10 }), Infinity);
  assert.equal(generationIndexRatio({}), null);
});
