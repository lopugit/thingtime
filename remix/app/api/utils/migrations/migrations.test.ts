import assert from 'node:assert/strict';
import test from 'node:test';

import {
	USER_STORAGE_ACCOUNTING_MIGRATION_PROJECTION,
	collectionStorage,
	conversionReceiptCovers,
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

// --------------------------------------------------------------------------
// Conversion receipts are the only proof that lets the consume phase delete a
// legacy source it did not itself verify byte-for-byte, so the predicate has to
// fail closed on every shape that is not a positive certification. It is pure
// and takes the receipt as data specifically so the per-doc lookup and the
// page-batched one cannot drift apart in what they accept.

test('an absent conversion receipt never certifies a source', () => {
	const source = { _id: 'legacy-1', updatedAt: '2026-01-01T00:00:00.000Z' };
	// findOne yields null for a miss; the batched Map yields undefined. Both are
	// "no receipt" and must refuse to license a delete.
	assert.equal(conversionReceiptCovers(null, source), false);
	assert.equal(conversionReceiptCovers(undefined, source), false);
	// present but not a completed receipt — no destination was ever recorded
	assert.equal(conversionReceiptCovers({ sourceUpdatedAtMs: Date.parse(source.updatedAt) }, source), false);
	assert.equal(conversionReceiptCovers({ destinationShareId: 42, sourceUpdatedAtMs: Date.parse(source.updatedAt) }, source), false);
});

test('a conversion receipt certifies a source only up to the state it recorded', () => {
	const converted = Date.parse('2026-01-01T00:00:00.000Z');
	const receipt = { destinationShareId: 'user-1', sourceUpdatedAtMs: converted, sourceDigest: 'digest-of-recorded-state' };
	assert.equal(conversionReceiptCovers(receipt, { _id: 'legacy-1', updatedAt: new Date(converted) }), true);
	assert.equal(conversionReceiptCovers(receipt, { _id: 'legacy-1', updatedAt: new Date(converted - 1000) }), true);
	// the source has been edited since it was converted: the receipt covers an
	// older state, so it must not license deleting the newer one
	assert.equal(
		conversionReceiptCovers(receipt, { _id: 'legacy-1', updatedAt: new Date(converted + 1000) }),
		false,
		'a receipt for an older source state must not certify a source edited after conversion'
	);
});

test('a receipt falls back to the source digest only when a timestamp cannot decide', () => {
	const source = { _id: 'legacy-1' }; // historical row, never had an updatedAt
	// no usable time on either side → the digest decides, and a wrong one fails
	assert.equal(conversionReceiptCovers({ destinationShareId: 'user-1', sourceDigest: 'not-this-source' }, source), false);
	// an unusable receipt timestamp also routes to the digest rather than being
	// read as a satisfied comparison
	assert.equal(
		conversionReceiptCovers(
			{ destinationShareId: 'user-1', sourceUpdatedAtMs: null, sourceDigest: 'not-this-source' },
			{ _id: 'legacy-1', updatedAt: '2026-01-01T00:00:00.000Z' }
		),
		false
	);
	// a source whose updatedAt is present but unparseable has no comparable
	// time either, so it must not ride the numeric branch
	assert.equal(
		conversionReceiptCovers(
			{ destinationShareId: 'user-1', sourceUpdatedAtMs: 0, sourceDigest: 'not-this-source' },
			{ _id: 'legacy-1', updatedAt: 'soon' }
		),
		false
	);
});

// The storage census is advisory: /api/v1/admin/migrations is the only in-app
// way to run relocate-ci-control-telemetry and rebuild-things-indexes, so a
// $collStats that cannot run must cost the numbers, not the endpoint.
const censusDb = (result: { stats?: Record<string, unknown>; error?: Record<string, unknown> }) => ({
	collection: () => ({
		aggregate: () => ({
			toArray: async () => {
				if (result.error) throw Object.assign(new Error('collStats unavailable'), result.error);
				return [{ storageStats: result.stats }];
			}
		})
	})
});

test('the storage census reads $collStats and degrades to no census instead of failing the endpoint', async () => {
	const taken = await collectionStorage(
		censusDb({ stats: { count: 42, size: 118_784, storageSize: 61_440, totalIndexSize: 1_310_720, indexSizes: { _id_: 36_864, shareId_1: 1_273_856 } } }),
		'things_v2'
	);
	assert.deepEqual(taken, {
		docs: 42,
		dataBytes: 118_784,
		storageBytes: 61_440,
		indexBytes: 1_310_720,
		indexSizes: { _id_: 36_864, shareId_1: 1_273_856 }
	});
	// every way the stage can be refused, not just the dropped-namespace race:
	// a view (166), a managed tier that withholds the stage, and a generation
	// that vanished between listCollections and the census (26)
	for (const error of [{ code: 166, codeName: 'CommandNotSupportedOnView' }, { code: 59, codeName: 'CommandNotFound' }, { code: 26, codeName: 'NamespaceNotFound' }]) {
		assert.equal(await collectionStorage(censusDb({ error }), 'things_v2'), null, String(error.codeName));
	}
	// a server that answers without storageStats reports no census either
	assert.equal(await collectionStorage(censusDb({ stats: undefined }), 'things_v2'), null);
});
