import assert from 'node:assert/strict';
import test from 'node:test';

import { fromBin } from '../auth/users';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, MIGRATION_DIAGNOSTIC_THINGTIME } from '../../../schemas/registry';
import { buildMigrationDiagnosticThing, formatMigrationDiagnosticDetail, isMigrationDiagnosticId } from './migrationDiagnostics';

const id = 'migration-diagnostic-89c5d4f2-b478-4aa1-b37d-755171dc3d90';

test('migration diagnostics are private, expiring, non-billable control Things', () => {
	const now = new Date('2026-08-08T00:00:00.000Z');
	const doc = buildMigrationDiagnosticThing(
		{
			ownerId: 'admin-user-id',
			migrationId: 'backfill-user-storage-accounting',
			status: 500,
			outcome: 'unknown',
			summary: 'Migration stopped before completion.',
			diagnostic: { detail: '{\n  "stack": "redacted stack"\n}', redactions: 2, truncated: false }
		},
		{ now, id }
	);

	assert.equal(doc.shareId, id);
	assert.equal(doc.schemaVersion, COLLECTION_SCHEMA_VERSIONS.things);
	assert.deepEqual(doc.thingtime, [MIGRATION_DIAGNOSTIC_THINGTIME]);
	assert.equal(doc.storageClass, 'control');
	assert.equal(doc.ownerId, 'admin-user-id');
	assert.deepEqual(doc.acl, [ACL_OWNER]);
	assert.equal(doc.expiresAt.toISOString(), '2026-09-07T00:00:00.000Z');
	assert.equal('detail' in doc.crystal, false, 'full detail must stay outside wildcard-indexed crystal');
	assert.deepEqual(JSON.parse(fromBin(doc.secure)), {
		diagnosticVersion: 1,
		detail: '{\n  "stack": "redacted stack"\n}',
		redactions: 2,
		truncated: false
	});
});

test('migration diagnostic ids and inline fallback detail are bounded and normalized', () => {
	assert.equal(isMigrationDiagnosticId(id), true);
	assert.equal(isMigrationDiagnosticId('migration-diagnostic-javascript:alert(1)'), false);
	assert.equal(isMigrationDiagnosticId('migration-diagnostic-00000000-0000-0000-0000-000000000000'), false);

	const detail = formatMigrationDiagnosticDetail({
		migrationId: 'invalid migration id',
		mode: 'dry run',
		status: 999,
		outcome: 'rejected',
		summary: 'Operator summary',
		diagnostic: { detail: 'full redacted detail', redactions: 1, truncated: false }
	});
	assert.match(detail, /Migration: requested-migration/);
	assert.match(detail, /Mode: dry run/);
	assert.match(detail, /HTTP status: 500/);
	assert.match(detail, /full redacted detail/);

	assert.throws(
		() =>
			buildMigrationDiagnosticThing({
				ownerId: ' ',
				migrationId: 'migration',
				status: 500,
				outcome: 'unknown',
				summary: 'summary',
				diagnostic: { detail: 'detail', redactions: 0, truncated: false }
			}),
		/Invalid migration diagnostic owner/
	);
});
