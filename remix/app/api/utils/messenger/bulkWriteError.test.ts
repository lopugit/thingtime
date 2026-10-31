import assert from 'node:assert/strict';
import test from 'node:test';

import { isDuplicateOnlyBulkWriteError } from './bulkWriteError.ts';

test('accepts an unordered bulk failure made entirely of duplicate-key races', () => {
	assert.equal(isDuplicateOnlyBulkWriteError({ code: 11000 }), true);
	assert.equal(
		isDuplicateOnlyBulkWriteError({
			writeErrors: [{ code: 11000 }, { err: { code: 11000 } }],
			result: { getWriteConcernError: () => undefined }
		}),
		true
	);
});

test('rejects a concern-only MongoBulkWriteError shape', () => {
	assert.equal(
		isDuplicateOnlyBulkWriteError({
			code: 64,
			err: { code: 64, errmsg: 'waiting for replication timed out' },
			result: { getWriteConcernError: () => ({ code: 64 }) }
		}),
		false
	);
});

test('rejects duplicate write errors combined with a result-level write-concern failure', () => {
	const result = {
		concern: { code: 64, errmsg: 'waiting for replication timed out' },
		getWriteConcernError() {
			return this.concern;
		}
	};

	assert.equal(
		isDuplicateOnlyBulkWriteError({
			code: 11000,
			writeErrors: [{ code: 11000 }, { code: 11000 }],
			result
		}),
		false
	);
});

test('rejects non-duplicate and uninspectable bulk failures', () => {
	assert.equal(isDuplicateOnlyBulkWriteError({ writeErrors: [{ code: 11000 }, { code: 121 }] }), false);
	assert.equal(isDuplicateOnlyBulkWriteError({ writeErrors: [] }), false);
	assert.equal(
		isDuplicateOnlyBulkWriteError({
			writeErrors: [{ code: 11000 }],
			result: {
				getWriteConcernError() {
					throw new Error('uninspectable result');
				}
			}
		}),
		false
	);
});

test('recognizes compatible direct and raw-result write-concern shapes', () => {
	assert.equal(
		isDuplicateOnlyBulkWriteError({ writeErrors: [{ code: 11000 }], writeConcernError: { code: 64 } }),
		false
	);
	assert.equal(
		isDuplicateOnlyBulkWriteError({ writeErrors: [{ code: 11000 }], writeConcernErrors: [{ code: 64 }] }),
		false
	);
	assert.equal(
		isDuplicateOnlyBulkWriteError({
			writeErrors: [{ code: 11000 }],
			result: { result: { writeConcernErrors: [{ code: 64 }] } }
		}),
		false
	);
});
