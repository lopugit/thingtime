import assert from 'node:assert/strict';
import test from 'node:test';
import { USER_STORAGE_PENDING_LIMIT_BYTES, userStoragePendingStateIsTrusted } from './storagePending.ts';

test('pending accounting admits exactly100MiB gross positive budget with complete protected state', () => {
  const state = { storagePendingBytes: USER_STORAGE_PENDING_LIMIT_BYTES, storagePendingCount: 4, storagePendingSince: new Date() };
  assert.equal(userStoragePendingStateIsTrusted({}), true);
  assert.equal(userStoragePendingStateIsTrusted(state), true);
  for (const bytes of [-1, 1.5, '1', USER_STORAGE_PENDING_LIMIT_BYTES + 1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(userStoragePendingStateIsTrusted({ ...state, storagePendingBytes: bytes }), false);
  }
  for (const count of [0, -1, 0.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(userStoragePendingStateIsTrusted({ ...state, storagePendingCount: count }), false);
  }
  assert.equal(userStoragePendingStateIsTrusted({ storagePendingBytes: 0 }), false);
  assert.equal(userStoragePendingStateIsTrusted({ ...state, storagePendingSince: new Date('invalid') }), false);
  assert.equal(userStoragePendingStateIsTrusted({ ...state, storagePendingSince: new Date().toISOString() }), false);
});
