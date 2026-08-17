import assert from 'node:assert/strict';
import test from 'node:test';

import { createUpdateUserProfile, profileAttachmentRefsForUserRoot, toPublicProfile, toPublicUser } from './users';

const now = new Date('2026-08-09T05:00:00.000Z');
const canonicalUser = (overrides: Record<string, unknown> = {}) => ({
	_id: 'mongo-user-1',
	shareId: 'user-1',
	thingtime: ['user'],
	ownerId: 'user-1',
	targetId: null,
	acl: ['tt:all'],
	crystal: {
		username: 'lopu',
		displayName: 'Lopu',
		bio: null,
		avatarUrl: 'https://images.example/avatar-fallback.jpg',
		bannerUrl: null
	},
	avatarAttachmentId: 'avatar-old',
	createdAt: new Date('2026-01-01T00:00:00.000Z'),
	updatedAt: new Date('2026-08-08T00:00:00.000Z'),
	...overrides
});

const createHarness = (options: { thing?: any; legacy?: any; matchedCount?: number } = {}) => {
	const session = { id: 'home-session' };
	const updates: Array<{ store: 'thing' | 'legacy'; filter: any; update: any; options: any }> = [];
	const reconciliations: any[] = [];
	let transactions = 0;
	const thingCollection = {
		findOne: async (_filter: any, readOptions: any) => {
			assert.equal(readOptions?.session, session);
			return options.thing === undefined ? canonicalUser() : options.thing;
		},
		updateOne: async (filter: any, update: any, writeOptions: any) => {
			updates.push({ store: 'thing' as const, filter, update, options: writeOptions });
			return { matchedCount: options.matchedCount ?? 1 };
		}
	};
	const legacyCollection = {
		findOne: async (_filter: any, readOptions: any) => {
			assert.equal(readOptions?.session, session);
			return options.legacy ?? null;
		},
		updateOne: async (filter: any, update: any, writeOptions: any) => {
			updates.push({ store: 'legacy' as const, filter, update, options: writeOptions });
			return { matchedCount: options.matchedCount ?? 1 };
		}
	};
	const update = createUpdateUserProfile({
		withTransaction: async (operation: any) => {
			transactions += 1;
			return operation(session);
		},
		getThings: async () => thingCollection as any,
		getUsers: async () => legacyCollection as any,
		reconcileAttachments: async (input: any) => {
			reconciliations.push(input);
		},
		findUser: async (id: string) => ({ _id: id }),
		projectUser: async (user: any) => ({ id: String(user._id) } as any),
		now: () => now
	});
	return { update, session, updates, reconciliations, transactions: () => transactions };
};

test('new and migrated user Things preserve only nonempty server-owned profile attachment refs at the root', () => {
	assert.deepEqual(profileAttachmentRefsForUserRoot({ avatarAttachmentId: 'avatar-1', bannerAttachmentId: 'banner-1' }), {
		avatarAttachmentId: 'avatar-1',
		bannerAttachmentId: 'banner-1'
	});
	assert.deepEqual(profileAttachmentRefsForUserRoot({ avatarAttachmentId: '', bannerAttachmentId: 42 }), {});
});

test('managed profile replacement binds in the same session and never persists a content path over the linked fallback', async () => {
	const harness = createHarness();
	const result = await harness.update('user-1', { displayName: '  New Lopu  ', avatarAttachmentId: 'avatar-next' });
	assert.equal(result.ok, true);
	assert.equal(harness.reconciliations.length, 1);
	assert.deepEqual(
		{
			ownerId: harness.reconciliations[0].ownerId,
			targetId: harness.reconciliations[0].targetId,
			current: harness.reconciliations[0].current,
			desired: harness.reconciliations[0].desired,
			now: harness.reconciliations[0].now,
			session: harness.reconciliations[0].session
		},
		{
			ownerId: 'user-1',
			targetId: 'user-1',
			current: { avatar: 'avatar-old', banner: null },
			desired: { avatar: 'avatar-next', banner: null },
			now,
			session: harness.session
		}
	);
	assert.equal(harness.updates.length, 1);
	const write = harness.updates[0];
	assert.equal(write.options.session, harness.session);
	assert.equal(write.update.$set.avatarAttachmentId, 'avatar-next');
	assert.equal(write.update.$set['crystal.displayName'], 'New Lopu');
	assert.equal(Object.prototype.hasOwnProperty.call(write.update.$set, 'crystal.avatarUrl'), false);
	assert.equal(JSON.stringify(write.update).includes('/api/v1/attachments/content'), false);
});

test('external URL switches away from managed media, while attachmentId null alone preserves the linked fallback', async () => {
	const switched = createHarness();
	assert.equal((await switched.update('user-1', { avatarUrl: 'https://cdn.example/new-avatar.png' })).ok, true);
	assert.equal(switched.reconciliations[0].desired.avatar, null);
	assert.equal(switched.updates[0].update.$set['crystal.avatarUrl'], 'https://cdn.example/new-avatar.png');
	assert.equal(switched.updates[0].update.$unset.avatarAttachmentId, '');

	const removed = createHarness();
	assert.equal((await removed.update('user-1', { avatarAttachmentId: null })).ok, true);
	assert.equal(removed.reconciliations[0].desired.avatar, null);
	assert.equal(Object.prototype.hasOwnProperty.call(removed.updates[0].update.$set, 'crystal.avatarUrl'), false);
	assert.equal(removed.updates[0].update.$unset.avatarAttachmentId, '');
});

test('profile media input rejects ambiguity, unsafe URLs, duplicate slot ids, and malformed ids before mutation', async () => {
	const unsafe: Array<{ input: Record<string, unknown>; error: RegExp }> = [
		{
			input: { avatarAttachmentId: 'avatar-next', avatarUrl: 'https://images.example/avatar.jpg' },
			error: /cannot use both/
		},
		{ input: { avatarUrl: 'data:image/png;base64,AAAA' }, error: /http\(s\) image URL/ },
		{ input: { avatarUrl: 'https://user:secret@images.example/avatar.jpg' }, error: /http\(s\) image URL/ },
		{ input: { avatarUrl: 'https://images.example/a b.jpg' }, error: /http\(s\) image URL/ },
		{ input: { avatarUrl: `https://images.example/a\u202Eb.jpg` }, error: /http\(s\) image URL/ },
		{ input: { avatarUrl: 'https:\\images.example\\avatar.jpg' }, error: /http\(s\) image URL/ },
		{ input: { avatarAttachmentId: 'bad attachment id' }, error: /attachment id is invalid/ },
		{ input: { avatarAttachmentId: 'same', bannerAttachmentId: 'same' }, error: /different attachments/ }
	];
	for (const entry of unsafe) {
		const harness = createHarness();
		const result = await harness.update('user-1', entry.input);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.status, 400);
			assert.match(result.error, entry.error);
		}
		assert.equal(harness.transactions(), 0);
	}
});

test('legacy profile updates use the same home transaction and attachment reconciliation contract', async () => {
	const legacyId = '664f1c2a9d3e5b0012345678';
	const harness = createHarness({
		thing: null,
		legacy: {
			_id: legacyId,
			username: 'legacy',
			avatarUrl: 'https://images.example/legacy.jpg',
			avatarAttachmentId: null,
			updatedAt: new Date('2026-08-08T00:00:00.000Z')
		}
	});
	assert.equal((await harness.update(legacyId, { avatarAttachmentId: 'legacy-avatar' })).ok, true);
	assert.equal(harness.updates[0].store, 'legacy');
	assert.equal(harness.updates[0].options.session, harness.session);
	assert.equal(harness.reconciliations[0].session, harness.session);
	assert.equal(harness.reconciliations[0].ownerId, legacyId);
	assert.equal(harness.updates[0].update.$set.avatarAttachmentId, 'legacy-avatar');
});

test('a user write race returns a fixed authored conflict and transaction-safe attachment work can roll back', async () => {
	const harness = createHarness({ matchedCount: 0 });
	const result = await harness.update('user-1', { avatarAttachmentId: 'avatar-next' });
	assert.deepEqual(result, { ok: false, status: 409, error: 'Profile changed while it was being updated' });
	assert.equal(harness.reconciliations.length, 1);
});

test('self projection exposes managed ids and linked fallbacks separately; public projection exposes effective URLs only', () => {
	const doc = {
		_id: 'user-1',
		ttid: 'lopu',
		username: 'lopu',
		email: 'lopu@example.test',
		displayName: 'Lopu',
		bio: null,
		avatarUrl: 'https://images.example/fallback.jpg',
		bannerUrl: null,
		avatarAttachmentId: 'avatar-managed',
		bannerAttachmentId: null,
		emailVerified: true,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		accountKind: 'user',
		meta: {}
	};
	const self = toPublicUser(doc);
	assert.equal(self.avatarUrl, '/api/v1/attachments/content?id=avatar-managed');
	assert.equal(self.avatarAttachmentId, 'avatar-managed');
	assert.equal(self.avatarLinkedUrl, 'https://images.example/fallback.jpg');
	assert.equal(self.bannerAttachmentId, null);
	assert.equal(self.bannerLinkedUrl, null);

	const publicProfile = toPublicProfile(doc);
	assert.equal(publicProfile.avatarUrl, '/api/v1/attachments/content?id=avatar-managed');
	assert.deepEqual(Object.keys(publicProfile).sort(), ['avatarUrl', 'bannerUrl', 'bio', 'createdAt', 'displayName', 'id', 'username']);
});
