import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_ADMIN_DIAGNOSTIC_CHARS, captureAdminErrorDiagnostic } from './adminDiagnostic';

test('admin diagnostics keep useful error context while scrubbing common secrets', () => {
	let getterReads = 0;
	const cause = Object.assign(new Error('Bearer cause-token at https://user:pass@example.invalid/path'), {
		apiKey: 'api-key-value'
	});
	const error = Object.assign(
		new Error(
			'Mongo failed at mongodb+srv://db-user:db-pass@example.invalid/thingtime ' +
				'THINGTIME_SERVICE_TOKEN=service-token JWT_SECRET=jwt-secret ' +
				'"password": "value with spaces" ownerId=507f1f77bcf86cd799439011 ' +
				'email=person@example.invalid eyJhbGciOiJIUzI1NiJ9.payload.signature ' +
				'-----BEGIN PRIVATE KEY----- private-material -----END PRIVATE KEY-----'
		),
		{
			name: 'MongoServerError',
			code: 224,
			password: 'plain-password',
			nested: { refresh_token: 'refresh-value', safeCount: 3 },
			cause
		}
	);
	Object.defineProperty(error, 'dangerousAccessor', {
		get() {
			getterReads += 1;
			return 'getter-secret';
		}
	});
	(cause as Error & { cycle?: unknown }).cycle = error;

	const diagnostic = captureAdminErrorDiagnostic(error);

	assert.equal(getterReads, 0, 'capturing an error must never invoke getters');
	assert.match(diagnostic.detail, /MongoServerError/);
	assert.match(diagnostic.detail, /"code": 224/);
	assert.match(diagnostic.detail, /\[redacted/);
	assert.doesNotMatch(
		diagnostic.detail,
		/db-user|db-pass|cause-token|user:pass|service-token|jwt-secret|value with spaces|507f1f77bcf86cd799439011|person@example\.invalid|private-material|plain-password|api-key-value|refresh-value|getter-secret/
	);
	assert.ok(diagnostic.redactions >= 5);
});

test('admin diagnostics are bounded across deep, wide, and oversized thrown values', () => {
	const root = new Error('y'.repeat(100_000));
	let cursor = root;
	for (let depth = 0; depth < 8; depth += 1) {
		const cause = new Error(`cause-${depth}`);
		(cursor as Error & { cause?: Error }).cause = cause;
		cursor = cause;
	}
	Object.assign(root, Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`field${index}`, 'x'.repeat(2_000)])));
	const diagnostic = captureAdminErrorDiagnostic(root);

	assert.equal(diagnostic.truncated, true);
	assert.ok(diagnostic.detail.length <= MAX_ADMIN_DIAGNOSTIC_CHARS);
	assert.match(diagnostic.detail, /truncated/);
	assert.doesNotMatch(diagnostic.detail, /field119/);
});
