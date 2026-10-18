/** Opt-in storage consistency proof. Uses only a fresh, randomly named database
 * on an explicitly supplied loopback replica set; never loads application env. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';
import { physicalCollectionName } from '../app/api/utils/mongodb/collectionNames';
import { THINGS_OWNER_IDENTITY_INDEX } from '../app/api/utils/mongodb/collections';
import { createAccountInventoryProducer } from '../app/api/utils/backups/accountInventory';
import { openLocalBackupStore } from '../app/api/utils/backups/localBackupStore';
import { captureBackup, sealBackup, openBackupItem, copySealedBackup } from '../app/api/utils/backups/portableBackup';

import { timelineBackupFixture } from '../app/api/utils/backups/timelineRecords.fixtures';
import { timelineBackupRecordFromDoc, openBackupTimelineRecord } from '../app/api/utils/backups/timelineRecords';

const uri = process.env.THINGTIME_ACCOUNT_SNAPSHOT_TEST_URI;
if (!uri || !/^mongodb:\/\/127\.0\.0\.1:\d+\/\?replicaSet=[A-Za-z0-9_-]+$/.test(uri))
	throw Error('Set THINGTIME_ACCOUNT_SNAPSHOT_TEST_URI to mongodb://127.0.0.1:<port>/?replicaSet=<disposable-replica>');
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
const database = client.db(`account_snapshot_test_${randomUUID().replaceAll('-', '')}`);
const collection = database.collection(physicalCollectionName('things'));
const directory = await mkdtemp(join(tmpdir(), 'account-snapshot-'));
const store = await openLocalBackupStore(join(directory, 'first'));
const independent = await openLocalBackupStore(join(directory, 'second'));
const access = { scope: { ownerId: 'snapshot-owner', apiOrigin: 'https://snapshot.test', dataPlane: 'home' }, authorize: async () => {} };
const history = timelineBackupFixture(access.scope.ownerId);
const expectedHistory = new Map(history.docs.map((doc) => [doc.shareId, timelineBackupRecordFromDoc(doc)]));
let queries = 0,
	ended = 0,
	timestamp: string | null = null;
try {
	await client.connect();
	await collection.createIndex({ shareId: 1 }, { unique: true });
	await collection.insertMany(
		Array.from({ length: 6000 }, (_, n) => ({
			shareId: `thing-${String(n).padStart(5, '0')}`,
			ownerId: n % 20 === 0 ? access.scope.ownerId : 'foreign-owner',
			thingtime: ['data'],
			crystal: { text: `original-${n}` },
			secure: 'NEVER_EXPORT',
			linkKey: 'NEVER_EXPORT'
		})),
		{ writeConcern: { w: 'majority' } }
	);
	const filter = { ownerId: access.scope.ownerId, shareId: { $gt: 'thing-01000' } };
	const before = await collection.find(filter).sort({ shareId: 1 }).limit(128).hint({ shareId: 1 }).explain('executionStats');
	await collection.createIndex(THINGS_OWNER_IDENTITY_INDEX, { collation: { locale: 'simple' } });
	const after = await collection.find(filter).sort({ shareId: 1 }).limit(128).hint({ ownerId: 1, shareId: 1 }).explain('executionStats');
	assert.equal(before.executionStats.nReturned, 128);
	assert.equal(after.executionStats.nReturned, 128);
	assert.ok(after.executionStats.totalKeysExamined < before.executionStats.totalKeysExamined);
	await collection.insertMany(history.docs, { writeConcern: { w: 'majority' } });
	const producer = createAccountInventoryProducer({
		customPlane: () => false,
		snapshot: async (work) => {
			const session = client.startSession({ snapshot: true, causalConsistency: false });
			try {
				const result = await work(session);
				timestamp = session.snapshotTime!.toString();
				return result;
			} finally {
				await session.endSession();
				ended++;
			}
		},
		collection: async () => ({
			find(query: any, options: any) {
				const cursor = collection.find(query, options);
				queries++;
				// The second query follows the first census's timestamp. Interleave a
				// majority-committed write before its payload is read by the server.
				if (queries === 2) {
					const iterate = cursor[Symbol.asyncIterator].bind(cursor);
					cursor[Symbol.asyncIterator] = async function* () {
						await collection.updateOne({ shareId: 'thing-00000' }, { $set: { crystal: { text: 'changed' } } }, { writeConcern: { w: 'majority' } });
						await collection.deleteOne({ shareId: 'thing-04000' }, { writeConcern: { w: 'majority' } });
						await collection.insertOne(
							{ shareId: 'thing-04001-new', ownerId: access.scope.ownerId, thingtime: ['data'], crystal: { text: 'new' } },
							{ writeConcern: { w: 'majority' } }
						);
						await collection.deleteOne({ shareId: history.firstPartId }, { writeConcern: { w: 'majority' } });
						await collection.updateOne(
							{ shareId: history.docs[0].shareId },
							{ $set: { secure: 'changed after snapshot' } },
							{ writeConcern: { w: 'majority' } }
						);
						yield* iterate();
					};
				}
				return cursor;
			}
		})
	});
	const snapshotId = randomUUID(),
		plan = await producer(store, snapshotId, access);
	assert.equal(plan.items, 300 + history.docs.length);
	assert.ok(BigInt(plan.bytes) > BigInt(2_400_000));
	assert.equal(plan.pages, 3);
	assert.equal(queries, 7 + Math.ceil(history.docs.length / 8));
	assert.equal(ended, 1);
	assert.ok(timestamp);
	await collection.deleteMany({}, { writeConcern: { w: 'majority' } });
	const empty = await producer(store, randomUUID(), access);
	assert.equal(empty.items, 0);
	assert.equal(empty.pages, 0);
	assert.equal(ended, 2);
	await collection.dropIndex('ownerId_1_shareId_1');
	await assert.rejects(producer(store, randomUUID(), access), /hint/);
	assert.equal(ended, 3);
	await database.dropDatabase();
	await captureBackup(
		store,
		snapshotId,
		{
			read: async () => {
				throw Error('Unexpected live-source access');
			}
		},
		access
	);
	await sealBackup(store, snapshotId, access);
	await copySealedBackup(store, independent, snapshotId, access);
	await rm(join(directory, 'first'), { recursive: true });
	for (const [thingId, record] of expectedHistory) {
		assert.deepEqual(await openBackupTimelineRecord(independent, snapshotId, thingId, access), record);
	}
	for (const n of [0, 4000]) {
		const result = await openBackupItem(independent, snapshotId, `thing-${String(n).padStart(5, '0')}`, access);
		assert.equal((result.item.snapshot.value as any).crystal.text, `original-${n}`);
		assert.ok(!JSON.stringify(result.item).includes('NEVER_EXPORT'));
	}
	await assert.rejects(openBackupItem(independent, snapshotId, 'thing-04001-new', access));
	console.log(
		JSON.stringify(
			{
				ok: true,
				items: plan.items,
				pages: plan.pages,
				queries,
				sessionsEnded: ended,
				concurrentUpdateDeleteInsert: 'original snapshot preserved',
				offlineMetadata: 'verified after database and first vault removal',
				timelineRecords: expectedHistory.size,
				timelineBytes: plan.bytes,
				timelineCoverage: 'canonical events, links, branches, heads, large parts, notes, active and cleared version names',
				emptyInventory: 'server timestamp verified',
				missingIndex: 'refused without scan fallback',
				indexExperiment: { shareIdOnlyKeys: before.executionStats.totalKeysExamined, ownerShareIdKeys: after.executionStats.totalKeysExamined },
				coverage: 'synthetic ordinary Things and Timeline records; not remaining protected families, attachment bytes or full account restore'
			},
			null,
			2
		)
	);
} finally {
	await database.dropDatabase().catch(() => {});
	await client.close();
	await rm(directory, { recursive: true, force: true });
}
