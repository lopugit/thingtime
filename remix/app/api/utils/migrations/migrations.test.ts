import assert from 'node:assert/strict';
import test from 'node:test';

import {
	USER_STORAGE_ACCOUNTING_MIGRATION_PROJECTION,
	conversionThingSemanticallyEquals,
	userStorageAccountingSourceCursor,
	userStoragePrerequisites
} from './migrations.ts';
import { profileAttachmentRefsForUserRoot } from '../auth/users.ts';
import { ATTACHMENT_ENVELOPE_VERSION } from '../attachments/attachmentCore.ts';
import { thingStorageSizeBytes } from '../storage/storageCore.ts';

test('whole-account storage migration projects the complete attachment accounting envelope', () => {
	const attachment = {
		_id: 'mongo-id',
		shareId: 'attachment-id',
		schemaVersion: 2,
		ownerId: 'user-id',
		thingtime: ['attachment'],
		crystal: {
			name: 'photo.png',
			size: 42,
			contentType: 'image/png',
			mediaKind: 'image'
		},
		extended: null,
		tags: [],
		storageClass: 'content',
		storageAccountingVersion: 1,
		updatedAt: new Date('2026-08-23T00:00:00.000Z'),
		attachmentEnvelopeVersion: ATTACHMENT_ENVELOPE_VERSION,
		attachmentState: 'finalizing',
		objectSizeBytes: 42,
		objectKey: 'pending/user-id/attachment-id',
		objectVersionId: 'version-id',
		attachmentRequestFingerprint: 'a'.repeat(64),
		attachmentPurpose: 'post',
		attachmentFinalizationLeaseId: 'finalize:lease-1',
		attachmentPartsIssuedAt: new Date('2026-08-23T00:00:00.000Z'),
		uploadId: 'upload-id',
		attachmentExpiresAt: new Date('2026-08-24T00:00:00.000Z')
	};
	const projected = Object.fromEntries(
		Object.keys(USER_STORAGE_ACCOUNTING_MIGRATION_PROJECTION)
			.filter((key) => Object.prototype.hasOwnProperty.call(attachment, key))
			.map((key) => [key, attachment[key as keyof typeof attachment]])
	);

	assert.equal(thingStorageSizeBytes(projected), thingStorageSizeBytes(attachment));
	for (const field of ['attachmentProfileSlot', 'attachmentObjectlessDelete', 'attachmentMpuEmptyVerifiedAt']) {
		assert.equal(USER_STORAGE_ACCOUNTING_MIGRATION_PROJECTION[field as keyof typeof USER_STORAGE_ACCOUNTING_MIGRATION_PROJECTION], 1);
	}
});

test('whole-account storage accounting repairs builtin schema seeds first', () => {
	const ids = userStoragePrerequisites().map((migration) => migration.id);
	assert.equal(ids.filter((id) => id === 'seed-builtin-schemas').length, 1);
	assert.ok(ids.indexOf('seed-builtin-schemas') > ids.indexOf('things-v1-to-v2'));
	assert.ok(ids.indexOf('seed-builtin-schemas') < ids.indexOf('backfill-app-namespace-fields'));
});

test('whole-account storage accounting reads complete protected attachment envelopes', () => {
	let receivedFilter: Record<string, unknown> | undefined;
	const fullDocumentCursor = {
		project: () => assert.fail('the migration must not project away protected attachment root fields')
	};
	const cursor = userStorageAccountingSourceCursor({
		find: (filter: Record<string, unknown>) => {
			receivedFilter = filter;
			return fullDocumentCursor;
		}
	});
	assert.equal(cursor, fullDocumentCursor);
	assert.deepEqual(receivedFilter, { ownerId: { $type: 'string' } });
});

test('legacy user migration preserves managed profile attachment references and treats drift as non-equivalent', () => {
	assert.deepEqual(
		profileAttachmentRefsForUserRoot({
			avatarAttachmentId: 'avatar-attachment',
			bannerAttachmentId: 'banner-attachment'
		}),
		{
			avatarAttachmentId: 'avatar-attachment',
			bannerAttachmentId: 'banner-attachment'
		}
	);
	assert.deepEqual(profileAttachmentRefsForUserRoot({ avatarAttachmentId: '', bannerAttachmentId: 42 }), {});

	const expected = {
		shareId: 'user-1',
		thingtime: ['user'],
		avatarAttachmentId: 'avatar-attachment',
		bannerAttachmentId: 'banner-attachment'
	};
	assert.equal(conversionThingSemanticallyEquals({ ...expected }, expected, false), true);
	assert.equal(
		conversionThingSemanticallyEquals({ ...expected, avatarAttachmentId: undefined }, expected, false),
		false,
		'a migration must not delete the legacy source when its destination lost a managed-media reference'
	);
});
