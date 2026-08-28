import assert from 'node:assert/strict';
import test from 'node:test';

import { actionableAdoptionIssues } from './migrationUiCore';

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
