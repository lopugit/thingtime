import assert from 'node:assert/strict';
import test from 'node:test';

import {
	conversionThingSemanticallyEquals,
	userStorageAccountingSourceCursor,
	userStoragePrerequisites
} from './migrations.ts';
import { profileAttachmentRefsForUserRoot } from '../auth/users.ts';

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
