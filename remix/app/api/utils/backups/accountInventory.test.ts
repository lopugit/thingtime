import { backupDraftFixture } from './draftRecords.fixtures';
import { accountContentSnapshot, accountContentValue } from '../../../timeline/accountContent';
import { backupAccountSnapshotFromDoc, openBackupAccountSnapshot, readBackupAccountContent } from './accountSnapshots';
import { buildUserSecure, packRecentReactions } from '../auth/users';
import { backupThemeFixtures } from './themeSnapshots.fixtures';
import { backupThemeSnapshotFromDoc, openBackupThemeSnapshot, BACKUP_THEME_CONTENT_ADAPTER } from './themeSnapshots';
import { backupDraftFromDoc, openBackupDraft } from './draftRecords';
import { openBackupThingSnapshot } from './thingSnapshots';
import { openAccountBackupFile, openAccountBackupFileVersion } from './accountFileRecovery';
import { timelineEventThingId } from '../timeline/repository';
import { backupAttachmentFixture, backupFileHistoryFixture } from './attachmentRecords.fixtures';
import { resumeAccountBackup } from './cloudFolderBackup';
import { backupAttachmentItemContent } from './attachmentRecords';
import { timelineBackupFixture } from './timelineRecords.fixtures';
import { timelineBackupRecordFromDoc, openBackupTimelineRecord } from './timelineRecords';
import { joinTimelineEvent } from '../../../timeline/records';
import { copySealedBackup } from './portableBackup';
import assert from 'node:assert/strict';
import { BSON } from 'mongodb';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createAccountInventoryProducer } from './accountInventory';
import { captureBackup, sealBackup, openBackupItem, type BackupObjectStore } from './portableBackup';

function fixture(count = 300) {
	const source: any[] = Array.from({ length: count }, (_, n) => ({
		shareId: `thing-${String(n).padStart(4, '0')}`,
		ownerId: 'owner',
		thingtime: ['data'],
		crystal: { text: `original-${n}` },
		secure: 'NEVER_EXPORT',
		linkKey: 'NEVER_EXPORT',
		tokenAcl: 'NEVER_EXPORT'
	}));
	const heads = new Map<string, any>();
	const headReads: string[] = [];
	const objects = new Map<string, Uint8Array>();
	const store: BackupObjectStore = {
		read: async (key, max) => {
			const value = objects.get(key);
			if (value) assert.ok(value.length <= max);
			return value ?? null;
		},
		put: async (key, value) => {
			state.beforePut(key);
			if (objects.has(key)) assert.deepEqual(objects.get(key), value);
			else objects.set(key, value.slice());
		}
	};
	const scope = { apiOrigin: 'https://backup.test', ownerId: 'owner', dataPlane: 'home' };
	const access = { scope, authorize: async () => {}, signal: undefined as AbortSignal | undefined };
	const state = {
		beforeHead: async () => {},
		beforePut: (_key: string) => {},
		ordinaryYields: [] as string[],
		queries: 0,
		closed: 0,
		ended: 0,
		beforeQuery: (_n: number) => {},
		alterRows: (_n: number, rows: any[]) => rows
	};
	let frozen: any[];
	const session = { snapshotEnabled: true, inTransaction: () => false, snapshotTime: undefined as any };
	const projections: Record<string, number>[] = [];
	const collection = {
		find(filter: any, options: any) {
			state.beforeQuery(++state.queries);
			assert.equal(options.session, session);
			assert.equal(filter.ownerId, 'owner');
			assert.equal(options.collation.locale, 'simple');
			assert.equal(options.readPreference, 'primary');
			assert.deepEqual(
				options.hint,
				options.projection.secure && options.projection['crystal.username'] ? { shareId: 1 } : { ownerId: 1, shareId: 1 }
			);
			projections.push(options.projection);
			if (!frozen) {
				frozen = source.map((row) => BSON.deserialize(BSON.serialize(row)));
				session.snapshotTime = { getHighBitsUnsigned: () => 1792195200, getLowBitsUnsigned: () => 7 };
			}
			let limit = 0;
			const cursor = {
				sort(value: any) {
					assert.deepEqual(value, { shareId: 1 });
					return cursor;
				},
				limit(n: number) {
					assert.ok(n === 128 || n === 8 || n === 2);
					limit = n;
					return cursor;
				},
				batchSize(n: number) {
					assert.ok(n === 128 || n === 8 || n === 2);
					return cursor;
				},
				async close() {
					state.closed++;
				},
				async *[Symbol.asyncIterator]() {
					const selected = frozen
						.filter(
							(row) =>
								row.ownerId === filter.ownerId &&
								(!filter.shareId?.$gt || row.shareId > filter.shareId.$gt) &&
								(!filter.shareId?.$in || filter.shareId.$in.includes(row.shareId))
						)
						.sort((a, b) => (a.shareId < b.shareId ? -1 : a.shareId > b.shareId ? 1 : 0))
						.slice(0, limit);
					const projected = selected.map((row) => {
						const result: any = {};
						for (const [path, included] of Object.entries(options.projection)) {
							if (!included) continue;
							const [root, child] = path.split('.');
							if (child && row[root]?.[child] !== undefined) (result[root] ??= {})[child] = row[root][child];
							else if (!child && row[root] !== undefined) result[root] = row[root];
						}
						return result;
					});
					for (const row of state.alterRows(state.queries, projected)) {
						if (options.projection.crystal && options.projection.timelineHeadId) state.ordinaryYields.push(row.shareId);
						yield row;
					}
				}
			};
			return cursor;
		}
	};
	const producer = createAccountInventoryProducer({
		collection: async () => collection,
		attachmentHead: async (input) => {
			headReads.push(input.objectKey);
			await state.beforeHead();
			const head = heads.get(input.objectKey);
			assert.ok(head, 'No unexpected attachment HEAD');
			assert.equal(input.versionId, head.versionId);
			return head;
		},
		customPlane: () => false,
		snapshot: async (work) => {
			try {
				return await work(session);
			} finally {
				state.ended++;
			}
		}
	});
	const id = randomUUID();
	const json = (key: string) => JSON.parse(Buffer.from(objects.get(`snapshots/${id}/${key}`)!).toString());
	return {
		source,
		heads,
		headReads,
		store,
		objects,
		scope,
		access,
		state,
		session,
		projections,
		id,
		json,
		readAccount: () => readBackupAccountContent(access, session, async () => collection),
		run: () => producer(store, id, access)
	};
}

function accountFixture(ownerId = 'owner') {
	const { secure } = buildUserSecure({
		email: 'NEVER_EXPORT@example.test',
		passwordHash: 'NEVER_EXPORT',
		emailVerified: true,
		meta: {
			birthday: '2000-02-29',
			hideEmailOnProfile: false,
			readReceiptsEnabled: false,
			activeThemeId: null,
			activeFeedAlgorithmId: 'algorithm-old',
			notificationPrefs: { 'action-run': false, email: { 'weekly-summary': false }, masters: { push: false } },
			lopuInstructions: { revision: 'prompt-old', instructions: [{ id: 'quiet', text: 'Keep replies brief', enabled: false }] },
			mongoEndpoints: 'NEVER_EXPORT',
			deploymentLinks: 'NEVER_EXPORT',
			privateUploads: true,
			admin: true,
			customSecret: 'NEVER_EXPORT'
		}
	});
	return {
		shareId: ownerId,
		ownerId,
		thingtime: ['user'],
		secure,
		secureAdmin: true,
		secureRecentReactions: packRecentReactions(['❤️', 'custom:older', '❤️']),
		crystal: {
			username: 'snapshot-user',
			ttid: 'snapshot-user',
			displayName: null,
			bio: 'Exact saved bio',
			avatarUrl: null,
			bannerUrl: 'data:image/png;base64,' + 'x'.repeat(64000),
			privateKey: 'NEVER_EXPORT'
		}
	} as any;
}

test('account reader refuses revoked, switched, missing, duplicate and foreign source identities', async () => {
	for (const mode of ['revoked', 'switched', 'missing', 'duplicate', 'foreign', 'wrong-family', 'not-snapshot', 'transaction']) {
		const f = fixture(0);
		f.source.push(accountFixture());
		if (mode === 'revoked')
			f.access.authorize = async () => {
				throw Error('revoked');
			};
		if (mode === 'switched')
			f.access.authorize = async () => {
				f.scope.ownerId = 'another';
			};
		if (mode === 'missing') f.source.length = 0;
		if (mode === 'duplicate') f.state.alterRows = (_n, rows) => [...rows, ...rows];
		if (mode === 'foreign') f.state.alterRows = (_n, rows) => rows.map((row) => ({ ...row, ownerId: 'foreign' }));
		if (mode === 'wrong-family') f.state.alterRows = (_n, rows) => rows.map((row) => ({ ...row, thingtime: ['user', 'data'] }));
		if (mode === 'not-snapshot') f.session.snapshotEnabled = false;
		if (mode === 'transaction') f.session.inTransaction = () => true;
		await assert.rejects(f.readAccount(), /revoked|unchanged|missing|ambiguous|family|read-only/);
		assert.equal(f.state.closed, f.state.queries);
		if (['revoked', 'switched', 'not-snapshot', 'transaction'].includes(mode)) assert.equal(f.state.queries, 0);
	}
});

test('account content and private preferences survive source edits and independent vault copy without credentials or defaults', async () => {
	const f = fixture(0),
		account = accountFixture(),
		expected = backupAccountSnapshotFromDoc(account);
	f.source.push(account);
	f.state.beforeQuery = (n) => {
		if (n === 2) {
			account.crystal.bio = 'new biography';
			account.secure = Buffer.from('{}');
		}
	};
	await f.run();
	assert.equal(f.state.queries, 3);
	assert.ok(f.json('header.json').coverage.description.includes('credentials and security state'));
	assert.ok(![...f.objects.values()].some((bytes) => Buffer.from(bytes).includes('NEVER_EXPORT')));
	await captureBackup(
		f.store,
		f.id,
		{
			read: async () => {
				throw Error('Account content is already retained');
			}
		},
		f.access
	);
	await sealBackup(f.store, f.id, f.access);
	const second = fixture(0);
	await copySealedBackup(f.store, second.store, f.id, f.access);
	f.source.length = 0;
	f.objects.clear();
	const restored = await openBackupAccountSnapshot(second.store, f.id, 'owner', f.access);
	assert.deepEqual(restored, expected);
	const value = accountContentValue(restored);
	assert.deepEqual(value.preferences.notificationPrefs, { 'action-run': false, email: { 'weekly-summary': false }, masters: { push: false } });
	assert.equal(Object.prototype.hasOwnProperty.call(value.preferences, 'twoFactorEmailEnabled'), false);
	assert.deepEqual(value.recentReactions, ['❤️', 'custom:older', '❤️']);
	await assert.rejects(
		openBackupAccountSnapshot(second.store, f.id, 'owner', { ...f.access, scope: { ...f.scope, ownerId: 'foreign' } }),
		/account or origin/
	);
	const key = [...second.objects.keys()].find((key) => key.startsWith('chunks/'))!;
	second.objects.get(key)![0] ^= 1;
	await assert.rejects(openBackupAccountSnapshot(second.store, f.id, 'owner', f.access));
});

test('profile image closure verifies owner, slot, purpose, durable binding and exact retained bytes', async () => {
	for (const mode of ['valid', 'missing', 'foreign', 'wrong-slot', 'wrong-purpose', 'wrong-target', 'expiring'] as const) {
		const f = fixture(0),
			account = accountFixture(),
			attachment = await backupAttachmentFixture('owner', 'profile-image', Buffer.from('exact profile image'), 'profile', 'owner');
		account.avatarAttachmentId = attachment.doc.shareId;
		if (mode === 'foreign') attachment.doc.ownerId = 'foreign';
		if (mode === 'wrong-slot') attachment.doc.attachmentProfileSlot = 'banner';
		if (mode === 'wrong-purpose') attachment.doc.attachmentPurpose = 'post';
		if (mode === 'wrong-target') attachment.doc.targetId = 'another-account';
		if (mode === 'expiring') (attachment.doc as any).attachmentExpiresAt = new Date('2099-01-01');
		f.source.push(account);
		if (mode !== 'missing') f.source.push(attachment.doc);
		f.heads.set(attachment.doc.objectKey, attachment.head);
		if (mode !== 'valid') {
			await assert.rejects(f.run());
			assert.equal(f.objects.has(`snapshots/${f.id}/plan.json`), false);
			continue;
		}
		await f.run();
		await captureBackup(
			f.store,
			f.id,
			{
				read: async (item, offset, length) => {
					assert.equal(item.thingId, attachment.doc.shareId);
					return attachment.bytes.subarray(offset, offset + length);
				}
			},
			f.access
		);
		await sealBackup(f.store, f.id, f.access);
		f.source.length = 0;
		assert.equal(accountContentValue(await openBackupAccountSnapshot(f.store, f.id, 'owner', f.access)).profile.avatarAttachmentId, 'profile-image');
		const retained = await openBackupItem(f.store, f.id, 'profile-image', f.access),
			chunks = [];
		for await (const bytes of retained.ranges) chunks.push(bytes);
		assert.deepEqual(Buffer.concat(chunks), attachment.bytes);
	}
});

test('corrupt or ambiguous accounts fail the whole inventory before a complete plan exists', async () => {
	for (const mode of [
		'mixed',
		'wrong-identity',
		'plaintext',
		'bad-json',
		'bad-utf8',
		'bad-meta',
		'oversized-profile',
		'bad-reaction',
		'bad-preference'
	] as const) {
		const f = fixture(0),
			doc = accountFixture();
		if (mode === 'mixed') doc.thingtime.push('data');
		if (mode === 'wrong-identity') doc.shareId = 'different';
		if (mode === 'plaintext') doc.secure = '{}';
		if (mode === 'bad-json') doc.secure = Buffer.from('{"passwordHash":"NEVER_EXPORT", invalid json');
		if (mode === 'bad-utf8') doc.secure = Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]);
		if (mode === 'bad-meta') doc.secure = Buffer.from('{"meta":[]}');
		if (mode === 'oversized-profile') doc.crystal.bio = 'x'.repeat(501);
		if (mode === 'bad-reaction') doc.secureRecentReactions = ['plaintext'];
		if (mode === 'bad-preference') doc.secure = Buffer.from('{"meta":{"readReceiptsEnabled":"false"}}');
		f.source.push(doc);
		await assert.rejects(f.run(), (error: Error) => {
			assert.ok(!error.message.includes('NEVER_EXPORT'));
			return true;
		});
		assert.equal(f.objects.has(`snapshots/${f.id}/plan.json`), false);
	}
});

test('account snapshot contract rejects additional archived fields and preserves absent preferences', () => {
	const doc = accountFixture();
	doc.secure = Buffer.from('{}');
	const snapshot = backupAccountSnapshotFromDoc(doc),
		value = accountContentValue(snapshot);
	assert.deepEqual(value.preferences, {});
	assert.deepEqual(accountContentSnapshot(value), snapshot);
	assert.throws(() => accountContentValue({ ...snapshot, value: { ...value, passwordHash: 'forged' } }));
	assert.throws(() => accountContentValue({ ...snapshot, value: { ...value, preferences: { admin: true } } }));
	assert.throws(() => accountContentValue({ ...snapshot, version: 2 }));
});

test('saved themes retain canonical partial tokens and large content after independent copy and source loss', async () => {
	const f = fixture(0),
		themes = backupThemeFixtures('owner');
	const expected = new Map(themes.map((doc) => [doc.shareId, backupThemeSnapshotFromDoc(doc)]));
	f.source.push(...themes);
	f.state.beforeQuery = (n) => {
		if (n === 2) themes[0].crystal.name = 'changed after snapshot';
	};
	await f.run();
	const items = f.json('plan/0.json').items;
	assert.equal(items.find((item: any) => item.thingId === 'theme-large').snapshot.adapter, BACKUP_THEME_CONTENT_ADAPTER);
	assert.equal(items.find((item: any) => item.thingId === 'theme-partial').snapshot.adapter, 'theme-content');
	assert.equal(items.find((item: any) => item.thingId === 'theme-partial').revision, 'theme-revision-1');
	assert.equal(f.state.queries, 3, 'one family batch, no per-theme queries');
	for (const projection of f.projections) {
		for (const field of ['secure', 'linkKey', 'tokenAcl', 'crystal']) assert.equal(projection[field], undefined);
	}
	assert.ok(![...f.objects.values()].some((bytes) => Buffer.from(bytes).includes('NEVER_EXPORT')));
	await captureBackup(
		f.store,
		f.id,
		{
			read: async () => {
				throw Error('Themes are already frozen');
			}
		},
		f.access
	);
	await sealBackup(f.store, f.id, f.access);
	const second = fixture(0);
	await copySealedBackup(f.store, second.store, f.id, f.access);
	f.source.length = 0;
	f.objects.clear();
	for (const [id, snapshot] of expected) assert.deepEqual(await openBackupThemeSnapshot(second.store, f.id, id, f.access), snapshot);
	assert.deepEqual((expected.get('theme-partial')!.value as any).crystal.theme, {
		colors: { accent: '#eaeaea' },
		general: { motion: false, radiusScale: 0 }
	});
	const foreign = { ...f.access, scope: { ...f.scope, ownerId: 'foreign' } };
	await assert.rejects(openBackupThemeSnapshot(second.store, f.id, 'theme-partial', foreign), /account or origin/);
	const key = [...second.objects.keys()].find((key) => key.startsWith('chunks/'))!;
	assert.ok(key);
	second.objects.get(key)![0] ^= 1;
	await assert.rejects(openBackupThemeSnapshot(second.store, f.id, 'theme-large', f.access));
});

test('malformed or mixed managed themes refuse the whole plan instead of losing content', async () => {
	for (const mode of ['mixed', 'invalid-token', 'oversized', 'wrong-owner'] as const) {
		const f = fixture(0),
			theme: any = backupThemeFixtures('owner')[0];
		f.source.push(theme);
		if (mode === 'mixed') theme.thingtime.push('data');
		if (mode === 'invalid-token') theme.crystal.theme.general.motion = 'false';
		if (mode === 'oversized') theme.tags = ['x'.repeat(201)];
		if (mode === 'wrong-owner') f.state.alterRows = (n, rows) => (n === 2 ? rows.map((row) => ({ ...row, ownerId: 'foreign' })) : rows);
		await assert.rejects(f.run());
		assert.equal(f.objects.has(`snapshots/${f.id}/plan.json`), false);
	}
});

test('cancelled large-theme retention cannot publish a complete inventory', async () => {
	const f = fixture(0),
		controller = new AbortController();
	f.source.push(backupThemeFixtures('owner')[1]);
	f.access.signal = controller.signal;
	f.state.beforePut = (key) => {
		if (key.startsWith('chunks/')) controller.abort();
	};
	await assert.rejects(f.run());
	assert.equal(f.objects.has(`snapshots/${f.id}/plan.json`), false);
});

test('freezes more than two pages despite source edits, inserts and deletions; canonical metadata survives source removal', async () => {
	const f = fixture();
	f.source.push({ shareId: 'foreign', ownerId: 'someone-else', thingtime: ['data'], crystal: 'private' });
	f.state.beforeQuery = (n) => {
		if (n === 2) {
			f.source[0].crystal.text = 'changed';
			f.source.splice(128, 1);
			f.source.push({ shareId: 'new', ownerId: 'owner', thingtime: ['data'] });
		}
	};
	const plan = await f.run();
	assert.equal(plan.items, 300);
	assert.equal(plan.pages, 3);
	assert.equal(plan.bytes, '0');
	assert.equal(f.state.queries, 7);
	assert.equal(f.state.closed, 7);
	assert.equal(f.state.ended, 1);
	assert.deepEqual(f.json('header.json').boundary, {
		kind: 'point-in-time',
		token: 'mongo:1792195200:7',
		startedAt: new Date(1792195200 * 1000).toISOString(),
		completedAt: new Date(1792195200 * 1000).toISOString()
	});
	for (const projection of f.projections) for (const field of ['secure', 'linkKey', 'tokenAcl']) assert.equal(projection[field], undefined);
	assert.ok(![...f.objects.values()].some((bytes) => Buffer.from(bytes).includes('NEVER_EXPORT')));
	f.source.length = 0;
	await captureBackup(
		f.store,
		f.id,
		{
			read: async () => {
				throw Error('Metadata must not read live bytes');
			}
		},
		f.access
	);
	await sealBackup(f.store, f.id, f.access);
	const retained = await openBackupItem(f.store, f.id, 'thing-0128', f.access);
	assert.equal((retained.item.snapshot.value as any).crystal.text, 'original-128');
	assert.equal(retained.item.snapshot.adapter, 'thing-content');
	assert.match(retained.item.revision, /^snapshot-[a-f0-9]{64}$/);
});

test('file items retain canonical immutable content references and fingerprints', async () => {
	const f = fixture(0),
		bytes = Buffer.from('retained file');
	const attachment = await backupAttachmentFixture('owner', 'attachment-one', bytes);
	const fingerprint = attachment.content.fingerprint;
	f.source.push(attachment.doc);
	f.heads.set(attachment.doc.objectKey, attachment.head);
	f.source.push({
		shareId: 'file-one',
		ownerId: 'owner',
		thingtime: ['file'],
		timelineHeadId: 'revision-one',
		folderId: 'folder-one',
		crystal: {
			name: 'file.txt',
			trashed: false,
			content: attachment.content
		}
	});
	await f.run();
	const item = f.json('plan/0.json').items.find((item: any) => item.thingId === 'file-one');
	assert.equal(item.snapshot.adapter, 'file-content');
	assert.equal(item.revision, 'revision-one');
	assert.equal(item.snapshot.value.content.version, attachment.content.version);
	assert.equal(item.content, null);
	assert.deepEqual(item.snapshot.value.content.fingerprint, fingerprint);
});

test('empty inventory still needs a server timestamp and produces a valid empty plan', async () => {
	const f = fixture(0);
	const plan = await f.run();
	assert.equal(plan.items, 0);
	assert.equal(plan.pages, 0);
	assert.equal(f.state.ended, 1);
	assert.equal(f.json('header.json').boundary.token, 'mongo:1792195200:7');
});

test('an account switch during authorization refuses before obtaining source data', async () => {
	const f = fixture();
	f.access.authorize = async () => {
		f.scope.ownerId = 'other';
	};
	await assert.rejects(f.run(), /account or origin changed/);
	assert.equal(f.state.queries, 0);
	assert.equal(f.objects.size, 0);
});

for (const mode of ['no-timestamp', 'invalid-timestamp', 'not-snapshot', 'transaction'] as const) {
	test(`${mode} cannot manufacture a point-in-time header`, async () => {
		const f = fixture(0);
		if (mode === 'not-snapshot') f.session.snapshotEnabled = false;
		if (mode === 'transaction') f.session.inTransaction = () => true;
		f.state.alterRows = (_n, rows) => {
			if (mode === 'no-timestamp') f.session.snapshotTime = undefined;
			if (mode === 'invalid-timestamp') f.session.snapshotTime = { getHighBitsUnsigned: () => NaN, getLowBitsUnsigned: () => 1 };
			return rows;
		};
		await assert.rejects(f.run());
		assert.equal(f.objects.size, 0);
		assert.equal(f.state.ended, 1);
	});
}

test('unsupported managed family refuses before fetching its private payload and cannot restart under the same ID', async () => {
	for (const kind of ['passkey', 'ai-connection', 'chat-message']) {
		const f = fixture(1);
		f.source[0].thingtime = [kind];
		await assert.rejects(f.run(), /dedicated adapter/);
		assert.equal(f.state.queries, 1);
		assert.equal(f.projections[0].crystal, undefined);
		assert.equal(f.objects.has(`snapshots/${f.id}/plan.json`), false);
		await assert.rejects(f.run(), /already started/);
		assert.equal(f.state.ended, 1);
	}
});

for (const mode of ['revoked', 'cancelled', 'scope', 'boundary', 'missing', 'duplicate', 'oversized', 'expired'] as const) {
	test(`${mode} enumeration never publishes a complete plan and closes its cursor/session`, async () => {
		const f = fixture(2),
			controller = new AbortController();
		f.access.signal = controller.signal;
		f.state.beforeQuery = (n) => {
			if (n !== 2) return;
			if (mode === 'revoked')
				f.access.authorize = async () => {
					throw Error('Revoked');
				};
			if (mode === 'cancelled') controller.abort();
			if (mode === 'scope') f.scope.ownerId = 'other';
			if (mode === 'boundary') f.session.snapshotTime = { getHighBitsUnsigned: () => 1792195201, getLowBitsUnsigned: () => 7 };
		};
		f.state.alterRows = (n, rows) => {
			if (n !== 2) return rows;
			if (mode === 'expired') throw Error('SnapshotTooOld');
			if (mode === 'missing') return rows.slice(1);
			if (mode === 'duplicate') return [rows[0], rows[0]];
			if (mode === 'oversized') rows[0].crystal = Array.from({ length: 90_001 }, () => null);
			return rows;
		};
		await assert.rejects(f.run());
		assert.equal(f.objects.has(`snapshots/${f.id}/plan.json`), false);
		assert.equal(f.state.closed, f.state.queries);
		assert.equal(f.state.ended, 1);
	});
}

test('canonical Timeline records and large snapshot parts survive source and first-vault loss', async () => {
	const f = fixture(1),
		history = timelineBackupFixture();
	f.source.push(...history.docs);
	const expected = new Map(history.docs.map((doc) => [doc.shareId, timelineBackupRecordFromDoc(doc)]));
	const plan = await f.run();
	assert.equal(plan.items, history.docs.length + 1);
	assert.ok(BigInt(plan.bytes) > BigInt(2_400_000));
	assert.ok(f.state.queries < history.docs.length, 'history payload reads are batched');
	for (const projection of f.projections.filter((p) => p.secure)) {
		assert.equal(projection.tokenAcl, undefined);
		assert.equal(projection.linkKey, undefined);
	}
	const sourceReads = async () => {
		throw Error('Frozen Timeline records must not reread live source');
	};
	f.source.length = 0;
	const capture = await captureBackup(f.store, f.id, { read: sourceReads }, f.access);
	assert.equal(capture.copiedBytes, '0');
	assert.equal(capture.reusedBytes, plan.bytes);
	await sealBackup(f.store, f.id, f.access);
	const second = fixture(0);
	await copySealedBackup(f.store, second.store, f.id, f.access);
	f.objects.clear();
	const records = [];
	for (const [id, record] of expected) {
		const restored = await openBackupTimelineRecord(second.store, f.id, id, f.access);
		assert.deepEqual(restored, record);
		records.push(restored);
	}
	assert.ok(![...second.objects.values()].some((bytes) => Buffer.from(bytes).includes('NEVER_EXPORT')));
	const event = records.find((r) => r.kind === 'timeline-event' && (r.value as any).event.id === 'event-two')!;
	const links = records.filter((r) => r.kind === 'timeline-link' && (r.value as any).eventId === 'event-two').map((r) => r.value as any);
	assert.deepEqual(joinTimelineEvent((event.value as any).event, links), history.events[1]);
	const parts = records
		.filter((r) => r.kind === 'timeline-snapshot-part')
		.map((r) => r.value as any)
		.sort((a, b) => a.ordinal - b.ordinal);
	assert.deepEqual(JSON.parse(parts.map((part) => part.data).join('')), history.big);
	assert.ok(records.some((r) => r.kind === 'timeline-version-name' && (r.value as any).cleared === true));
});

test('a changed Timeline envelope refuses the entire snapshot before its plan is sealed', async () => {
	for (const patch of [{ ownerId: 'foreign' }, { targetId: 'wrong' }, { timelineEnvelopeVersion: 99 }, { shareId: 'wrong' }]) {
		const f = fixture(0),
			doc = timelineBackupFixture().docs.find((d) => d.thingtime[0] === 'timeline-event');
		f.source.push({ ...doc, ...patch });
		// Keep census owner in-scope for the envelope owner mismatch case.
		if (patch.ownerId) {
			f.source[0].ownerId = 'owner';
			f.source[0].secure = BSON.deserialize(BSON.serialize(doc)).secure;
		}
		if (patch.ownerId) f.state.alterRows = (n, rows) => (n === 2 ? rows.map((row) => ({ ...row, ownerId: 'foreign' })) : rows);
		await assert.rejects(f.run());
		assert.equal(f.objects.has(`snapshots/${f.id}/plan.json`), false);
	}
});

test('revocation during frozen Timeline payload persistence cannot publish a plan or seal', async () => {
	const f = fixture(0);
	f.source.push(...timelineBackupFixture().docs);
	const put = f.store.put;
	let revoked = false;
	f.store.put = async (key, bytes) => {
		await put(key, bytes);
		if (key.startsWith('chunks/')) revoked = true;
	};
	f.access.authorize = async () => {
		if (revoked) throw Error('Revoked');
	};
	await assert.rejects(f.run(), /Revoked/);
	assert.equal(f.objects.has(`snapshots/${f.id}/plan.json`), false);
	assert.equal(f.objects.has(`snapshots/${f.id}/complete.json`), false);
});

for (const failure of ['missing-chunk', 'corrupt-chunk', 'lost-range-reply'] as const) {
	test(`${failure} cannot certify a frozen Timeline backup`, async () => {
		const f = fixture(0);
		f.source.push(...timelineBackupFixture().docs);
		if (failure === 'lost-range-reply') {
			const put = f.store.put;
			f.store.put = async (key, bytes) => {
				await put(key, bytes);
				if (key.includes('/ranges/')) throw Error('Range reply lost');
			};
			await assert.rejects(f.run(), /Range reply lost/);
			assert.equal(f.objects.has(`snapshots/${f.id}/plan.json`), false);
			await assert.rejects(f.run()); // a new database snapshot needs a fresh identity
		} else {
			await f.run();
			const key = [...f.objects.keys()].find((key) => key.startsWith('chunks/'))!;
			if (failure === 'missing-chunk') f.objects.delete(key);
			else f.objects.get(key)![0] ^= 255;
		}
		await assert.rejects(sealBackup(f.store, f.id, f.access));
		assert.equal(f.objects.has(`snapshots/${f.id}/complete.json`), false);
	});
}

test('a later unsupported managed family cannot leave a complete partial Timeline snapshot', async () => {
	const f = fixture(100);
	f.source.push(...timelineBackupFixture().docs);
	f.source.push({ shareId: 'zz-unsupported', ownerId: 'owner', thingtime: ['passkey'], secure: 'NEVER_EXPORT' });
	await assert.rejects(f.run(), /dedicated adapter/);
	assert.ok([...f.objects.keys()].some((key) => key.startsWith('chunks/')));
	assert.equal(f.objects.has(`snapshots/${f.id}/plan.json`), false);
	assert.equal(f.objects.has(`snapshots/${f.id}/complete.json`), false);
});

test('sealed Timeline reads refuse changed scope before storage and detect later byte damage', async () => {
	const f = fixture(0),
		history = timelineBackupFixture();
	f.source.push(...history.docs);
	await f.run();
	await sealBackup(f.store, f.id, f.access);
	let reads = 0;
	const read = f.store.read;
	f.store.read = async (...args) => {
		reads++;
		return read(...args);
	};
	await assert.rejects(
		openBackupTimelineRecord(f.store, f.id, history.firstPartId, {
			...f.access,
			authorize: async () => {
				throw Error('Owner session revoked');
			}
		}),
		/revoked/
	);
	assert.equal(reads, 0);
	await assert.rejects(
		openBackupTimelineRecord(f.store, f.id, history.firstPartId, {
			...f.access,
			scope: { ...f.scope, ownerId: 'someone-else' }
		}),
		/account or origin/
	);
	// Damage the exact retained part after a valid seal. The read must still hash it.
	const part = await openBackupItem(f.store, f.id, history.firstPartId, f.access);
	const range = f.json(`ranges/${part.item.ordinal}/0.json`).ranges[0];
	f.objects.get(`chunks/${range.sha256}`)![0] ^= 255;
	await assert.rejects(openBackupTimelineRecord(f.store, f.id, history.firstPartId, f.access));
});

async function fileHistoryBackup() {
	const f = fixture(0),
		history = await backupFileHistoryFixture();
	f.source.push(...history.docs);
	for (const a of history.attachments) f.heads.set(a.doc.objectKey, a.head);
	const available = new Map(history.attachments.map((a) => [a.doc.shareId, a]));
	const requests: { id: string; offset: number; length: number }[] = [];
	const state = { wrongVersion: false, revoked: false };
	const runtime = {
		scope: f.scope,
		currentScope: () => f.scope,
		requireCapability: async () => {},
		fetch: (async (input, init) => {
			const url = new URL(String(input)),
				headers = new Headers(init?.headers);
			assert.equal(url.origin, f.scope.apiOrigin);
			assert.equal(init?.redirect, 'error');
			assert.equal(headers.get('X-Thingtime-Expected-Actor'), f.scope.ownerId);
			assert.equal(headers.get('X-Thingtime-Expected-Data-Plane'), 'home');
			if (state.revoked) return new Response('', { status: 401 });
			if (url.pathname === '/api/v1/auth/me') return Response.json({ user: { id: f.scope.ownerId } });
			assert.equal(url.pathname, '/api/v1/attachments/content');
			const id = url.searchParams.get('id')!,
				a = available.get(id);
			assert.ok(a, 'No live inventory or missing-source read');
			assert.equal(url.searchParams.get('version'), a.content.version);
			const offset = Number(url.searchParams.get('offset')),
				length = Number(url.searchParams.get('length'));
			assert.ok(length > 0 && length <= 2 * 1024 * 1024);
			requests.push({ id, offset, length });
			return new Response(a.bytes.subarray(offset, offset + length), {
				status: 206,
				headers: {
					ETag: `"${state.wrongVersion ? '0'.repeat(64) : a.content.version}"`,
					'Content-Range': `bytes ${offset}-${offset + length - 1}/${a.bytes.length}`,
					'Content-Length': String(length)
				}
			});
		}) as typeof fetch
	};
	return { f, history, available, requests, runtime, state };
}

test('old, current and conflict bytes survive source removal and independent account-vault copy', async () => {
	const { f, history, available, requests, runtime } = await fileHistoryBackup();
	const plan = await f.run();
	assert.equal(plan.items, history.docs.length);
	assert.equal(f.headReads.length, 3); // history references reuse immutable HEADs
	assert.equal(f.state.queries, 5 + Math.ceil(history.docs.filter((doc) => doc.thingtime[0].startsWith('timeline-')).length / 8)); // bounded family and reference batches
	const originalPut = f.store.put;
	let interrupted = false;
	f.store.put = async (key, bytes) => {
		await originalPut(key, bytes);
		if (!interrupted && key.includes('/ranges/') && bytes.length > 0) {
			interrupted = true;
			throw Error('Accepted byte receipt lost');
		}
	};
	await assert.rejects(resumeAccountBackup(f.store, f.id, runtime), /receipt lost/);
	assert.equal(f.objects.has(`snapshots/${f.id}/complete.json`), false);
	f.store.put = originalPut;
	f.source.length = 0; // metadata is now unavailable; resume only the frozen plan
	await resumeAccountBackup(f.store, f.id, runtime);
	const second = fixture(0);
	await copySealedBackup(f.store, second.store, f.id, f.access);
	f.objects.clear();
	available.clear();
	for (const a of history.attachments) {
		const entry = await openBackupItem(second.store, f.id, a.doc.shareId, f.access);
		assert.deepEqual(backupAttachmentItemContent(entry.item), a.content);
		const chunks = [];
		for await (const chunk of entry.ranges) chunks.push(chunk);
		assert.deepEqual(Buffer.concat(chunks), a.bytes);
	}
	const current = await openAccountBackupFile(second.store, f.id, 'file-one', f.access);
	const currentChunks = [];
	for await (const bytes of current.ranges) currentChunks.push(bytes);
	assert.deepEqual(Buffer.concat(currentChunks), history.attachments[1].bytes);
	for (const [index, side] of [
		[1, 'before'],
		[2, 'after']
	] as const) {
		const old = await openAccountBackupFileVersion(second.store, f.id, timelineEventThingId('owner', history.files[index].revision), side, f.access);
		const chunks = [];
		for await (const bytes of old.ranges) chunks.push(bytes);
		assert.deepEqual(Buffer.concat(chunks), history.attachments[index === 1 ? 0 : 2].bytes);
	}
	await assert.rejects(
		openAccountBackupFileVersion(second.store, f.id, timelineEventThingId('owner', history.files[0].revision), 'before', f.access),
		/no saved file bytes/
	);
	assert.equal(
		requests.reduce((sum, request) => sum + request.length, 0),
		history.attachments.reduce((sum, a) => sum + a.bytes.length, 0)
	);
	const oldReads = requests.filter((r) => r.id === 'attachment-old');
	assert.equal(
		oldReads.reduce((n, r) => n + r.length, 0),
		history.attachments[0].bytes.length
	);
	assert.ok(![...second.objects.values()].some((bytes) => /NEVER_EXPORT|objects\/attachment|private-version-/.test(Buffer.from(bytes).toString())));
});

for (const mode of ['missing', 'foreign', 'version', 'fingerprint', 'target', 'blocked', 'unfinished'] as const) {
	test(`historical attachment ${mode} refuses the complete account plan`, async () => {
		const { f, history } = await fileHistoryBackup();
		const old = history.attachments[0];
		if (mode === 'missing') f.source.splice(f.source.indexOf(old.doc), 1);
		if (mode === 'foreign') old.doc.ownerId = 'another-owner';
		if (mode === 'version') {
			old.doc.objectVersionId = 'different-version';
			old.head.versionId = 'different-version';
		}
		if (mode === 'fingerprint') old.head.checksumSha256 = Buffer.alloc(32, 1).toString('base64') + '-' + old.head.checksumSha256.split('-').at(-1);
		if (mode === 'target') old.doc.targetId = 'different-file';
		if (mode === 'blocked') (old.doc as any).moderation = { status: 'blocked' };
		if (mode === 'unfinished') old.doc.attachmentState = 'pending';
		await assert.rejects(f.run());
		assert.equal(f.objects.has(`snapshots/${f.id}/plan.json`), false);
		assert.equal(f.objects.has(`snapshots/${f.id}/complete.json`), false);
	});
}

for (const mode of ['wrongVersion', 'revoked'] as const) {
	test(`account byte capture rejects ${mode} and leaves no completion seal`, async () => {
		const { f, runtime, state } = await fileHistoryBackup();
		await f.run();
		state[mode] = true;
		await assert.rejects(resumeAccountBackup(f.store, f.id, runtime));
		assert.equal(f.objects.has(`snapshots/${f.id}/complete.json`), false);
	});
}

test('attachment fingerprint verification uses at most eight concurrent storage requests and bounded database batches', async () => {
	const f = fixture(0);
	const attachments = await Promise.all(Array.from({ length: 24 }, (_, i) => backupAttachmentFixture('owner', `attachment-${i}`)));
	for (const a of attachments) {
		f.source.push(a.doc);
		f.heads.set(a.doc.objectKey, a.head);
	}
	let active = 0,
		peak = 0;
	f.state.beforeHead = async () => {
		active++;
		peak = Math.max(peak, active);
		await new Promise((resolve) => setTimeout(resolve, 5));
		active--;
	};
	const plan = await f.run();
	assert.equal(plan.items, 24);
	assert.equal(f.state.queries, 3);
	assert.equal(f.headReads.length, 24);
	assert.equal(peak, 8);
	assert.equal(active, 0);
});

test('a failed storage check drains its bounded batch without starting another or sealing a partial plan', async () => {
	const f = fixture(0);
	const attachments = await Promise.all(Array.from({ length: 16 }, (_, i) => backupAttachmentFixture('owner', `attachment-${i}`)));
	for (const a of attachments) {
		f.source.push(a.doc);
		f.heads.set(a.doc.objectKey, a.head);
	}
	let active = 0,
		started = 0;
	f.state.beforeHead = async () => {
		const ordinal = started++;
		active++;
		try {
			await new Promise((resolve) => setTimeout(resolve, ordinal === 0 ? 1 : 10));
			if (ordinal === 0) throw Error('Storage unavailable');
		} finally {
			active--;
		}
	};
	await assert.rejects(f.run(), /Storage unavailable/);
	assert.equal(started, 8);
	assert.equal(active, 0);
	assert.equal(f.objects.has(`snapshots/${f.id}/plan.json`), false);
});

test('large ordinary content, drafts, templates and deletion tombstones survive independently with exact media', async () => {
	const f = fixture(2),
		drafts = await backupDraftFixture();
	const large = 'independent content'.repeat(500_000);
	f.source[0].crystal = { text: large };
	f.source[1].crystal = { text: 'second ordinary record' };
	f.source.push(...drafts.docs, ...drafts.attachments.map((a) => a.doc));
	for (const a of drafts.attachments) f.heads.set(a.doc.objectKey, a.head);
	let observedStreaming = false;
	f.state.beforePut = (key) => {
		if (key.startsWith('chunks/') && f.state.ordinaryYields.includes('thing-0000')) {
			assert.deepEqual(f.state.ordinaryYields, ['thing-0000'], 'retain the first large payload before pulling another ordinary row');
			observedStreaming = true;
		}
	};
	const plan = await f.run();
	assert.ok(observedStreaming);
	f.state.beforePut = () => {};
	assert.equal(plan.items, 7);
	assert.ok(BigInt(plan.bytes) > BigInt(9 * 1024 * 1024));
	assert.equal(f.state.queries, 6, 'one batched media dependency query, no per-draft payload lookup');
	assert.ok(f.projections.every((p) => !p.secure && !p.tokenAcl && !p.linkKey));
	f.source.length = 0;
	await captureBackup(
		f.store,
		f.id,
		{
			read: async (item, offset, length) => {
				const content = backupAttachmentItemContent(item);
				const a = drafts.attachments.find((a) => a.doc.shareId === content?.attachmentId);
				assert.ok(a, 'Frozen draft and ordinary content never consult live source');
				return a.bytes.subarray(offset, offset + length);
			}
		},
		f.access
	);
	await sealBackup(f.store, f.id, f.access);
	const second = fixture(0);
	await copySealedBackup(f.store, second.store, f.id, f.access);
	f.objects.clear();
	for (const doc of drafts.docs) assert.deepEqual(await openBackupDraft(second.store, f.id, doc.shareId, f.access), backupDraftFromDoc(doc));
	const snapshot = await openBackupThingSnapshot(second.store, f.id, 'thing-0000', f.access);
	assert.equal((snapshot.value as any).crystal.text, large);
	assert.equal(((await openBackupThingSnapshot(second.store, f.id, 'thing-0001', f.access)).value as any).crystal.text, 'second ordinary record');
	for (const a of drafts.attachments) {
		const result = await openBackupItem(second.store, f.id, a.doc.shareId, f.access),
			chunks = [];
		for await (const bytes of result.ranges) chunks.push(bytes);
		assert.deepEqual(Buffer.concat(chunks), a.bytes);
	}
	assert.ok(![...second.objects.values()].some((bytes) => Buffer.from(bytes).includes('NEVER_EXPORT')));
});

for (const mode of ['missing', 'foreign', 'target', 'purpose', 'profile', 'deleted', 'expiring'] as const) {
	test(`draft media ${mode} refuses the complete inventory`, async () => {
		const f = fixture(0),
			drafts = await backupDraftFixture();
		f.source.push(...drafts.docs, ...drafts.attachments.map((a) => a.doc));
		for (const a of drafts.attachments) f.heads.set(a.doc.objectKey, a.head);
		const doc: any = drafts.attachments[0].doc;
		if (mode === 'missing') f.source.splice(f.source.indexOf(doc), 1);
		if (mode === 'foreign') doc.ownerId = 'someone-else';
		if (mode === 'target') doc.targetId = 'different-draft';
		if (mode === 'purpose') doc.attachmentPurpose = 'post';
		if (mode === 'profile') {
			doc.attachmentPurpose = 'profile';
			doc.attachmentProfileSlot = 'avatar';
		}
		if (mode === 'deleted') (drafts.docs[0] as any).draftDeleted = true;
		if (mode === 'expiring') doc.attachmentExpiresAt = new Date('2026-10-19T00:00:00.000Z');
		await assert.rejects(f.run());
		assert.equal(f.objects.has(`snapshots/${f.id}/plan.json`), false);
		assert.equal(f.state.closed, f.state.queries);
	});
}
