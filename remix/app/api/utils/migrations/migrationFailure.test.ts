import assert from 'node:assert/strict';
import test from 'node:test';

import { PublicError } from '../errors/safeError';
import { StorageMutationError } from '../storage/storageCore';
import { MigrationOperatorError, captureMigrationFailureDiagnostic, migrationFailureResult } from './migrationFailure';

test('migration failures preserve explicitly authored operator guidance', () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(
      migrationFailureResult(
        'backfill-app-storage-allowances',
        new StorageMutationError(503, 'accounting_unavailable', 'Storage accounting is being initialized — try again shortly')
      ),
      {
        ok: false,
        status: 503,
        error:
          'Migration backfill-app-storage-allowances stopped before completion: Storage accounting is unavailable or still being initialized. Refresh status before retrying.',
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
  } finally {
    console.error = originalConsoleError;
  }
});

test('migration failures expose only safe exception class and code', () => {
  const error = Object.assign(new Error('mongodb://user:secret@example.invalid/thingtime'), {
    name: 'MongoServerError',
		code: 224,
		password: 'private-password'
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const result = migrationFailureResult('backfill-user-storage-accounting', error);
    assert.equal(result.status, 500);
    assert.match(result.error, /MongoServerError \(224\)/);
    assert.doesNotMatch(result.error, /secret|example\.invalid/);
		const diagnostic = captureMigrationFailureDiagnostic(result);
		assert.ok(diagnostic);
		assert.match(diagnostic.detail, /MongoServerError/);
		assert.doesNotMatch(diagnostic.detail, /user:secret|private-password|example\.invalid/);
		assert.equal(Object.keys(result).includes('diagnosticSource'), false);
		assert.doesNotMatch(JSON.stringify(result), /diagnosticSource|private-password/);
	} finally {
		console.error = originalConsoleError;
	}
});

test('unsafe exception names and codes cannot become public migration copy', () => {
	const error = Object.assign(new Error('private message'), {
		name: 'Mongo error\nprivate-host',
		code: '224 private-code'
	});
	const originalConsoleError = console.error;
	console.error = () => {};
	try {
		const result = migrationFailureResult('backfill-user-storage-accounting', error);
		assert.match(result.error, /Unexpected migration error/);
		assert.doesNotMatch(result.error, /private-host|private-code|private message/);
	} finally {
		console.error = originalConsoleError;
	}
});

test('migration failure diagnostics are captured lazily from a closed field set', () => {
	let stackReads = 0;
	const error = new Error('failure detail');
	Object.defineProperty(error, 'stack', {
		get() {
			stackReads += 1;
			return 'private stack';
		}
	});
	Object.assign(error, { arbitraryDocument: { email: 'private@example.invalid' } });

	const originalConsoleError = console.error;
	console.error = () => {};
	try {
		const result = migrationFailureResult('backfill-user-storage-accounting', error);
		assert.equal(stackReads, 0, 'failure normalization must not capture diagnostics while a migration lease may be held');
		const diagnostic = captureMigrationFailureDiagnostic(result);
		assert.equal(stackReads, 0, 'diagnostic capture must not invoke accessors');
		assert.ok(diagnostic);
		assert.doesNotMatch(diagnostic.detail, /arbitraryDocument|private@example\.invalid|private stack/);
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

test('only an authored operator context can retain a MongoDB ObjectId for reveal', () => {
	const objectId = '507f1f77bcf86cd799439011';
	const originalConsoleError = console.error;
	console.error = () => {};
	try {
		const authored = migrationFailureResult(
			'backfill-user-storage-accounting',
			new MigrationOperatorError('orphan_billable_thing', {
				internalMessage: `Billable Thing ${objectId} belongs to no current user`,
				diagnosticObjectIds: [objectId]
			})
		);
		const diagnostic = captureMigrationFailureDiagnostic(authored);
		assert.ok(diagnostic);
		assert.deepEqual(diagnostic.revealables.map((entry) => entry.value), [objectId]);
		assert.doesNotMatch(diagnostic.detail, new RegExp(objectId, 'i'));

		const inferred = migrationFailureResult(
			'backfill-user-storage-accounting',
			new Error(`API secret was ObjectId("${objectId}")`)
		);
		assert.deepEqual(captureMigrationFailureDiagnostic(inferred)?.revealables, []);
	} finally {
		console.error = originalConsoleError;
	}
});

test('invalid attachment envelopes fail closed with a revealable source id', () => {
	const objectId = '507f1f77bcf86cd799439011';
	const originalConsoleError = console.error;
	console.error = () => {};
	try {
		const result = migrationFailureResult(
			'backfill-user-storage-accounting',
			new MigrationOperatorError('invalid_attachment_envelope', {
				internalMessage: `Attachment Thing ${objectId} has an invalid protected storage envelope`,
				diagnosticObjectIds: [objectId]
			})
		);
		assert.equal(result.status, 409);
		assert.match(result.error, /attachment has an invalid protected storage envelope/i);
		assert.doesNotMatch(result.error, new RegExp(objectId, 'i'));
		assert.deepEqual(captureMigrationFailureDiagnostic(result)?.revealables.map((entry) => entry.value), [objectId]);
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
