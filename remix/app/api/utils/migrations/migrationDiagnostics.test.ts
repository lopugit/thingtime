import assert from 'node:assert/strict';
import test from 'node:test';

import { fromBin, toBin } from '../auth/users';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, MIGRATION_DIAGNOSTIC_THINGTIME } from '../../../schemas/registry';
import {
	buildMigrationDiagnosticThing,
	formatMigrationDiagnosticDetail,
	isMigrationDiagnosticId,
	migrationDiagnosticFromThing,
	migrationDiagnosticRevealFromThing
} from './migrationDiagnostics';

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
			diagnostic: {
				detail: '{\n  "stack": "Billable Thing [redacted MongoDB ObjectId #1]"\n}',
				redactions: 2,
				truncated: false,
				revealables: [
					{
						reference: 'mongodb-object-id-1',
						kind: 'mongodb-object-id',
						label: 'MongoDB ObjectId #1',
						placeholder: '[redacted MongoDB ObjectId #1]',
						value: '507f1f77bcf86cd799439011'
					}
				]
			}
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
		diagnosticVersion: 2,
		detail: '{\n  "stack": "Billable Thing [redacted MongoDB ObjectId #1]"\n}',
		redactions: 2,
		truncated: false,
		revealables: [
			{
				reference: 'mongodb-object-id-1',
				kind: 'mongodb-object-id',
				label: 'MongoDB ObjectId #1',
				placeholder: '[redacted MongoDB ObjectId #1]',
				value: '507f1f77bcf86cd799439011'
			}
		]
	});
	const projected = migrationDiagnosticFromThing(doc, new Date('2026-08-08T00:00:01.000Z'));
	assert.deepEqual(projected?.revealables, [
		{
			reference: 'mongodb-object-id-1',
			kind: 'mongodb-object-id',
			label: 'MongoDB ObjectId #1',
			placeholder: '[redacted MongoDB ObjectId #1]'
		}
	]);
	assert.doesNotMatch(JSON.stringify(projected), /507f1f77bcf86cd799439011/);
	assert.deepEqual(migrationDiagnosticRevealFromThing(doc, 'mongodb-object-id-1', new Date('2026-08-08T00:00:01.000Z')), {
		reference: 'mongodb-object-id-1',
		kind: 'mongodb-object-id',
		label: 'MongoDB ObjectId #1',
		value: '507f1f77bcf86cd799439011'
	});
	assert.equal(migrationDiagnosticRevealFromThing(doc, 'mongodb-object-id-2', new Date('2026-08-08T00:00:01.000Z')), null);
});

test('stored diagnostic detail is re-scrubbed before ordinary projection', () => {
	const now = new Date('2026-08-08T00:00:00.000Z');
	const raw = '507f1f77bcf86cd799439011';
	const doc = buildMigrationDiagnosticThing(
		{
			ownerId: 'admin-user-id',
			migrationId: 'backfill-user-storage-accounting',
			status: 500,
			outcome: 'unknown',
			summary: 'Migration stopped before completion.',
			diagnostic: {
				detail: `raw=${raw}\nBillable Thing [redacted MongoDB ObjectId #1]`,
				redactions: 1,
				truncated: false,
				revealables: [
					{
						reference: 'mongodb-object-id-1',
						kind: 'mongodb-object-id',
						label: 'MongoDB ObjectId #1',
						placeholder: '[redacted MongoDB ObjectId #1]',
						value: raw
					}
				]
			}
		},
		{ now, id }
	);

	const projected = migrationDiagnosticFromThing(doc, new Date('2026-08-08T00:00:01.000Z'));
	assert.ok(projected);
	assert.doesNotMatch(projected.detail, new RegExp(raw, 'i'));
	assert.match(projected.detail, /raw=\[redacted-object-id\]/);
	assert.equal(projected.revealables.length, 1);
	assert.equal(migrationDiagnosticRevealFromThing(doc, 'mongodb-object-id-1', new Date('2026-08-08T00:00:01.000Z'))?.value, raw);
});

test('legacy v1 diagnostics remain readable while unknown and mismatched envelopes fail closed', () => {
	const now = new Date('2026-08-08T00:00:00.000Z');
	const current = buildMigrationDiagnosticThing(
		{
			ownerId: 'admin-user-id',
			migrationId: 'backfill-user-storage-accounting',
			status: 500,
			outcome: 'unknown',
			summary: 'Migration stopped before completion.',
			diagnostic: { detail: 'legacy redacted detail', redactions: 1, truncated: false, revealables: [] }
		},
		{ now, id }
	);
	const legacy = {
		...current,
		crystal: { ...current.crystal, diagnosticVersion: 1 },
		secure: toBin(JSON.stringify({ diagnosticVersion: 1, detail: 'legacy redacted detail', redactions: 1, truncated: false }))
	};

	assert.equal(migrationDiagnosticFromThing(legacy, new Date('2026-08-08T00:00:01.000Z'))?.detail, 'legacy redacted detail');
	assert.deepEqual(migrationDiagnosticFromThing(legacy, new Date('2026-08-08T00:00:01.000Z'))?.revealables, []);
	assert.equal(
		migrationDiagnosticFromThing({ ...legacy, crystal: { ...legacy.crystal, diagnosticVersion: 2 } }, new Date('2026-08-08T00:00:01.000Z')),
		null
	);
	assert.equal(
		migrationDiagnosticFromThing(
			{ ...legacy, crystal: { ...legacy.crystal, diagnosticVersion: 99 }, secure: toBin(JSON.stringify({ diagnosticVersion: 99 })) },
			new Date('2026-08-08T00:00:01.000Z')
		),
		null
	);
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
		diagnostic: { detail: 'full redacted detail', redactions: 1, truncated: false, revealables: [] }
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
				diagnostic: { detail: 'detail', redactions: 0, truncated: false, revealables: [] }
			}),
		/Invalid migration diagnostic owner/
	);
});
