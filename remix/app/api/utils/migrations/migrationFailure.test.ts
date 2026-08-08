import assert from 'node:assert/strict';
import test from 'node:test';

import { PublicError } from '../errors/safeError';
import { StorageMutationError } from '../storage/storageCore';
import { MigrationOperatorError, migrationFailureResult } from './migrationFailure';

test('migration failures preserve explicitly authored operator guidance', () => {
  assert.deepEqual(
    migrationFailureResult(
      'backfill-app-storage-allowances',
      new StorageMutationError(503, 'accounting_unavailable', 'Storage accounting is being initialized — try again shortly')
    ),
    {
      ok: false,
      status: 503,
      error: 'Storage accounting is being initialized — try again shortly',
      outcome: 'unknown'
    }
  );

  assert.deepEqual(migrationFailureResult('backfill-app-namespace-fields', new PublicError('Repair the legacy app record first')), {
    ok: false,
    status: 500,
    error:
      'Migration backfill-app-namespace-fields stopped before completion: Repair the legacy app record first. Refresh migration status before retrying.',
    outcome: 'unknown'
  });
});

test('migration failures expose only safe exception class and code', () => {
  const error = Object.assign(new Error('mongodb://user:secret@example.invalid/thingtime'), {
    name: 'MongoServerError',
    code: 224
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const result = migrationFailureResult('backfill-user-storage-accounting', error);
    assert.equal(result.status, 500);
    assert.match(result.error, /MongoServerError \(224\)/);
    assert.doesNotMatch(result.error, /secret|example\.invalid/);
  } finally {
    console.error = originalConsoleError;
  }
});

test('operator failures keep identifiers in logs and return only authored repair guidance', () => {
  const originalConsoleError = console.error;
  const logged: unknown[] = [];
  console.error = (...args: unknown[]) => logged.push(...args);
  try {
    const result = migrationFailureResult(
      'backfill-user-storage-accounting',
      new MigrationOperatorError('invalid_sandbox_marker', {
        internalMessage: 'Billable Thing private-document-id has an invalid sandbox marker'
      })
    );
    assert.equal(result.status, 409);
    assert.match(result.error, /invalid sandbox marker/);
    assert.doesNotMatch(result.error, /private-document-id/);
    assert.match(logged.map(String).join(' '), /private-document-id/);
  } finally {
    console.error = originalConsoleError;
  }
});

test('operator taxonomy validates dynamic prerequisite context', () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const result = migrationFailureResult(
      'backfill-user-storage-accounting',
      new MigrationOperatorError('prerequisite_unresolved', {
        prerequisiteId: 'backfill-app-storage-allowances',
        pending: 2
      })
    );
    assert.equal(result.status, 409);
    assert.match(result.error, /backfill-app-storage-allowances still has 2 unresolved record/);

    const sanitized = migrationFailureResult(
      'backfill-user-storage-accounting',
      new MigrationOperatorError('prerequisite_unresolved', {
        prerequisiteId: 'private id with spaces',
        pending: Number.NaN
      })
    );
    assert.match(sanitized.error, /requested-migration still has 0 unresolved record/);
    assert.doesNotMatch(sanitized.error, /private id/);
  } finally {
    console.error = originalConsoleError;
  }
});

test('dry-run failures are rejected rather than commit-unknown', () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const result = migrationFailureResult(
      'backfill-user-storage-accounting',
      new MigrationOperatorError('pending_storage_records', { pending: 1 }),
      'rejected'
    );
    assert.equal(result.outcome, 'rejected');
  } finally {
    console.error = originalConsoleError;
  }
});
