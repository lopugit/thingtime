import { backupDraftFixture } from '../app/api/utils/backups/draftRecords.fixtures';
import { backupThemeFixtures } from '../app/api/utils/backups/themeSnapshots.fixtures';
import { backupThemeSnapshotFromDoc, openBackupThemeSnapshot } from '../app/api/utils/backups/themeSnapshots';
import { backupDraftFromDoc, openBackupDraft } from '../app/api/utils/backups/draftRecords';
import { openBackupThingSnapshot } from '../app/api/utils/backups/thingSnapshots';
import { backupFileHistoryFixture } from '../app/api/utils/backups/attachmentRecords.fixtures';
import { backupAttachmentItemContent } from '../app/api/utils/backups/attachmentRecords';
import { openAccountBackupFile, openAccountBackupFileVersion } from '../app/api/utils/backups/accountFileRecovery';
import { timelineEventThingId } from '../app/api/utils/timeline/repository';
/** Opt-in storage consistency proof. Uses only a fresh, randomly named database
 * on an explicitly supplied loopback replica set; never loads application env. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, mkdir, writeFile, open } from 'node:fs/promises';
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
const fileHistory = await backupFileHistoryFixture(access.scope.ownerId);
const drafts = await backupDraftFixture(access.scope.ownerId);
const themes = backupThemeFixtures(access.scope.ownerId);
const expectedThemes = new Map(themes.map((doc) => [doc.shareId, backupThemeSnapshotFromDoc(doc)]));
const attachments = [...fileHistory.attachments, ...drafts.attachments];
const largeText = 'large ordinary snapshot '.repeat(420_000);
const largeDoc = { shareId: 'large-thing', ownerId: access.scope.ownerId, thingtime: ['data'], crystal: { text: largeText } };
const expectedHistory = new Map(
	[...history.docs, ...fileHistory.docs.filter((doc) => doc.thingtime[0].startsWith('timeline-'))].map((doc) => [
		doc.shareId,
		timelineBackupRecordFromDoc(doc)
	])
);
const originals = join(directory, 'originals');
await mkdir(originals);
for (const a of attachments) await writeFile(join(originals, a.doc.shareId), a.bytes, { mode: 0o600 });
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
	await collection.insertMany([...history.docs, ...fileHistory.docs, ...drafts.docs, ...drafts.attachments.map((a) => a.doc), ...themes, largeDoc], {
		writeConcern: { w: 'majority' }
	});
	const producer = createAccountInventoryProducer({
		customPlane: () => false,
		attachmentHead: async (input) => {
			const a = attachments.find((a) => a.doc.objectKey === input.objectKey)!;
			assert.ok(a);
			assert.equal(input.versionId, a.doc.objectVersionId);
			return a.head;
		},
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
						await collection.deleteOne({ shareId: fileHistory.attachments[0].doc.shareId }, { writeConcern: { w: 'majority' } });
						await collection.deleteOne({ shareId: drafts.attachments[0].doc.shareId }, { writeConcern: { w: 'majority' } });
						await collection.updateOne(
							{ shareId: 'draft-working' },
							{ $set: { crystal: {}, draftDeleted: true, draftRevision: 4 } },
							{ writeConcern: { w: 'majority' } }
						);
						await collection.updateOne({ shareId: 'large-thing' }, { $set: { crystal: { text: 'later' } } }, { writeConcern: { w: 'majority' } });
						await collection.updateOne(
							{ shareId: 'theme-partial' },
							{ $set: { 'crystal.name': 'later theme' } },
							{ writeConcern: { w: 'majority' } }
						);
						await collection.deleteOne({ shareId: 'theme-large' }, { writeConcern: { w: 'majority' } });
						yield* iterate();
					};
				}
				return cursor;
			}
		})
	});
	const snapshotId = randomUUID(),
		plan = await producer(store, snapshotId, access);
	assert.equal(plan.items, 301 + history.docs.length + fileHistory.docs.length + drafts.docs.length + drafts.attachments.length + themes.length);
	assert.ok(BigInt(plan.bytes) > BigInt(2_400_000));
	assert.equal(plan.pages, 3);
	assert.ok(queries <= 25, `Unexpected per-record database reads: ${queries}`);
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
			read: async (item, offset, length) => {
				const content = backupAttachmentItemContent(item);
				assert.ok(content);
				const a = attachments.find((a) => a.doc.shareId === content.attachmentId)!;
				assert.deepEqual(content, a.content);
				const handle = await open(join(originals, a.doc.shareId), 'r');
				try {
					const bytes = Buffer.alloc(length),
						result = await handle.read(bytes, 0, length, offset);
					assert.equal(result.bytesRead, length);
					return bytes;
				} finally {
					await handle.close();
				}
			}
		},
		access
	);
	await sealBackup(store, snapshotId, access);
	await rm(originals, { recursive: true });
	await copySealedBackup(store, independent, snapshotId, access);
	await rm(join(directory, 'first'), { recursive: true });
	for (const [thingId, record] of expectedHistory) {
		assert.deepEqual(await openBackupTimelineRecord(independent, snapshotId, thingId, access), record);
	}
	for (const doc of drafts.docs) assert.deepEqual(await openBackupDraft(independent, snapshotId, doc.shareId, access), backupDraftFromDoc(doc));
	for (const [id, snapshot] of expectedThemes) assert.deepEqual(await openBackupThemeSnapshot(independent, snapshotId, id, access), snapshot);
	assert.equal(((await openBackupThingSnapshot(independent, snapshotId, 'large-thing', access)).value as any).crystal.text, largeText);
	for (const a of drafts.attachments) {
		const result = await openBackupItem(independent, snapshotId, a.doc.shareId, access),
			chunks = [];
		for await (const bytes of result.ranges) chunks.push(bytes);
		assert.deepEqual(Buffer.concat(chunks), a.bytes);
	}
	const savedFiles = [
		await openAccountBackupFile(independent, snapshotId, 'file-one', access),
		await openAccountBackupFileVersion(
			independent,
			snapshotId,
			timelineEventThingId(access.scope.ownerId, fileHistory.files[1].revision),
			'before',
			access
		),
		await openAccountBackupFileVersion(
			independent,
			snapshotId,
			timelineEventThingId(access.scope.ownerId, fileHistory.files[2].revision),
			'after',
			access
		)
	];
	for (const result of savedFiles) {
		const chunks = [];
		for await (const bytes of result.ranges) chunks.push(bytes);
		assert.deepEqual(Buffer.concat(chunks), fileHistory.attachments.find((a) => a.doc.shareId === result.file.content.attachmentId)!.bytes);
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
				offlineMetadata: 'verified after database, source files and first vault removal',
				fileVersionRecovery: 'current, earlier and retained conflict exact bytes',
				timelineRecords: expectedHistory.size,
				draftRecovery: 'working editor state, reusable template, deletion tombstone and exact owned media',
				themeRecovery: 'exact partial and large canonical themes after concurrent edit/deletion and source removal',
				largeThingBytes: Buffer.byteLength(largeText),
				totalPayloadBytes: plan.bytes,
				timelineCoverage: 'canonical events, links, branches, heads, large parts, notes, active and cleared version names',
				emptyInventory: 'server timestamp verified',
				missingIndex: 'refused without scan fallback',
				indexExperiment: { shareIdOnlyKeys: before.executionStats.totalKeysExamined, ownerShareIdKeys: after.executionStats.totalKeysExamined },
				coverage:
					'synthetic ordinary Things, themes, drafts, Timeline and attachment bytes; not remaining managed families, real S3 loss or full account restore'
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
