#!/usr/bin/env node

// Isolated replica-set integration check for the account-storage contract.
// The caller must explicitly opt in and point MONGODB_CONNECTION_STRING at a
// disposable loopback MongoDB instance. Thingtime's home database name is
// intentionally fixed to `thingtime`, so host isolation is the safety wall.
import assert from 'node:assert/strict';

const main = async () => {
	const [{ createUserAccount }, { ensureIndexes, getThingtimeDb, getThingsCollection }] = await Promise.all([
		import('../app/api/utils/auth/registerUser.ts'),
		import('../app/api/utils/mongodb/collections.ts')
	]);
	const db = await getThingtimeDb();
	assert.equal(process.env.TT_MESSENGER_STORAGE_TEST_ALLOW_LOCAL, '1');
	assert.match(
		String(process.env.MONGODB_CONNECTION_STRING || ''),
		/^mongodb:\/\/127\.0\.0\.1:\d+\/thingtime(?:\?|$)/,
		'Refusing to run Messenger storage integration checks outside a disposable loopback MongoDB'
	);
	assert.equal(String(db.databaseName), 'thingtime');
	await ensureIndexes();

	const [{ createThing }, { createCommunity }, { listAiConnections, syncAiConnections }, storage, registry, shared, migrations] =
		await Promise.all([
			import('../app/api/utils/things/things.ts'),
			import('../app/api/utils/messenger/communities.ts'),
			import('../app/api/utils/messenger/aiConnections.ts'),
			import('../app/api/utils/storage/userStorage.ts'),
			import('../app/schemas/registry.ts'),
			import('../app/api/utils/messenger/shared.ts'),
			import('../app/api/utils/migrations/migrations.ts')
		]);

	const createAccount = async (slug: string, allowance: number) => {
		const created = await createUserAccount({
			username: `storage-${slug}`,
			password: 'integration-only-password',
			email: `storage-${slug}@example.invalid`,
			emailVerified: true,
			storageAllowanceBytes: allowance
		});
		assert.equal(created.ok, true, created.ok === false ? created.error : undefined);
		return String((created as Extract<typeof created, { ok: true }>).user._id);
	};

	const ownerId = await createAccount('owner', 4 * 1024 * 1024);
	const baseline = await storage.getUserStorageUsage(ownerId);
	assert.equal(baseline.status, 'ready');
	assert.equal(baseline.usedBytes, 0);

	const post = await createThing(
		ownerId,
		{ thingtime: ['post'], crystal: { type: 'text', text: 'Posts consume account storage too 🥰' } },
		{ id: ownerId }
	);
	assert.equal(post.ok, true, post.ok === false ? post.error : undefined);
	const afterPost = await storage.getUserStorageUsage(ownerId);
	assert.ok((afterPost.usedBytes ?? 0) > 0, 'post bytes must enter the account ledger');

	const community = await createCommunity(ownerId, { name: 'Storage Space', description: 'Count every Messenger row' });
	assert.equal(community.ok, true, community.ok === false ? community.error : undefined);
	const afterCommunity = await storage.getUserStorageUsage(ownerId);
	assert.ok((afterCommunity.usedBytes ?? 0) > (afterPost.usedBytes ?? 0), 'community and membership bytes must be billed');

	const batch = {
		source: {
			provider: 'chatgpt',
			sourceId: 'integration-chatgpt',
			label: 'ChatGPT integration',
			connector: 'desktop-local',
			mode: 'local'
		},
		groups: [{ id: 'project-1', name: 'Imported Project', kind: 'project' }],
		conversations: [
			{
				id: 'conversation-1',
				title: 'Imported conversation',
				groupId: 'project-1',
				createdAt: '2026-08-17T01:00:00.000Z',
				updatedAt: '2026-08-17T01:02:00.000Z'
			}
		],
		messages: [
			{
				id: 'message-1',
				conversationId: 'conversation-1',
				role: 'user',
				authorName: 'Integration user',
				text: 'Please count this imported history.',
				createdAt: '2026-08-17T01:01:00.000Z'
			},
			{
				id: 'message-2',
				conversationId: 'conversation-1',
				role: 'assistant',
				authorName: 'ChatGPT',
				text: 'Counted exactly once.',
				createdAt: '2026-08-17T01:02:00.000Z'
			}
		],
		final: true,
		totals: { groups: 1, conversations: 1, messages: 2 }
	};
	const firstSync = await syncAiConnections(ownerId, batch);
	assert.equal(firstSync.ok, true, firstSync.ok === false ? firstSync.error : undefined);
	const afterFirstSync = await storage.getUserStorageUsage(ownerId);
	assert.ok((afterFirstSync.usedBytes ?? 0) > (afterCommunity.usedBytes ?? 0), 'AI history must increase account usage');
	const secondSync = await syncAiConnections(ownerId, batch);
	assert.equal(secondSync.ok, true, secondSync.ok === false ? secondSync.error : undefined);
	const afterSecondSync = await storage.getUserStorageUsage(ownerId);
	assert.equal(afterSecondSync.usedBytes, afterFirstSync.usedBytes, 'idempotent re-import must not double-charge quota');
	assert.equal((await listAiConnections(ownerId)).connections.length, 1);

	const things = await getThingsCollection();
	const messengerDocs = await things
		.find({ ownerId, thingtime: { $in: [...registry.MESSENGER_THINGTIME, 'reaction'] } })
		.toArray();
	assert.ok(messengerDocs.length >= 9, 'the integration batch should persist relational Messenger rows');
	for (const doc of messengerDocs) {
		assert.equal(doc.storageClass, 'content');
		assert.equal(doc.storageAccountingVersion, registry.USER_STORAGE_ACCOUNTING_VERSION);
		assert.equal(doc.sizeBytes, storageSize(doc));
	}

	const tinyOwnerId = await createAccount('tiny', 1);
	await assert.rejects(
		() => createCommunity(tinyOwnerId, { name: 'Must not partially persist' }),
		(error: any) => error?.code === 'quota_exceeded' && error?.status === 507
	);
	assert.equal(
		await things.countDocuments({ ownerId: tinyOwnerId, thingtime: { $in: [...registry.MESSENGER_THINGTIME] } }),
		0,
		'quota failure must roll back the community and its owner membership together'
	);

	const legacyOwnerId = await createAccount('legacy', 1024 * 1024);
	const legacyMessage = shared.newThingDoc('chat-message', {
		ownerId: legacyOwnerId,
		targetId: 'legacy-chat',
		crystal: { text: 'Legacy Messenger bytes', deletedAt: null }
	});
	await things.insertOne(legacyMessage);
	await things.updateOne(
		{ thingtime: 'subscription', 'crystal.subjectType': 'user', 'crystal.subjectId': legacyOwnerId },
		{
			$set: {
				'crystal.storageUsedBytes': 0,
				'crystal.storageAccountingVersion': 1,
				'crystal.storageLedgerStatus': 'ready'
			}
		}
	);
	const migrated = await migrations.runMigration('backfill-user-storage-accounting', {});
	assert.equal(migrated.ok, true, migrated.ok === false ? migrated.error : undefined);
	const migratedMessage = await things.findOne({ shareId: legacyMessage.shareId });
	assert.equal(migratedMessage?.storageAccountingVersion, registry.USER_STORAGE_ACCOUNTING_VERSION);
	assert.equal(migratedMessage?.storageClass, 'content');
	const legacyUsage = await storage.getUserStorageUsage(legacyOwnerId);
	assert.equal(legacyUsage.status, 'ready');
	assert.equal(legacyUsage.usedBytes, storageSize(legacyMessage));

	console.log(
		JSON.stringify({
			ok: true,
			postBytes: afterPost.usedBytes,
			messengerAndAiBytes: (afterSecondSync.usedBytes ?? 0) - (afterPost.usedBytes ?? 0),
			messengerRows: messengerDocs.length,
			idempotentUsageBytes: afterSecondSync.usedBytes,
			legacyRecountBytes: legacyUsage.usedBytes
		})
	);

	function storageSize(doc: any): number {
		return Buffer.byteLength(JSON.stringify({ crystal: doc.crystal ?? null, extended: doc.extended ?? null, tags: doc.tags ?? [] }), 'utf8');
	}
};

main().then(
	() => process.exit(0),
	(error) => {
		console.error(error instanceof Error ? `${error.name}: ${error.message}` : 'Messenger storage integration failed');
		process.exit(1);
	}
);
