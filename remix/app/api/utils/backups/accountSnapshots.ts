import { createHash } from 'node:crypto';
import { binaryBytes } from '../auth/binary';
import { accountContentSnapshot, accountContentValue, ACCOUNT_CONTENT_BYTES } from '../../../timeline/accountContent';
import type { TimelineSnapshot } from '../../../timeline/contract';
import { backupJson } from '../../../backups/manifest';
import { openBackupItem, retainBackupPayload, type BackupAccess, type BackupObjectStore } from './portableBackup';
import type { BackupAttachment } from './attachmentRecords';
import { getHomeThingsCollection } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { timelineScopeKey } from '../../../timeline/contract';

export const BACKUP_ACCOUNT_ADAPTER = 'backup-account-content';
export const BACKUP_ACCOUNT_BYTES = ACCOUNT_CONTENT_BYTES + 1024;
export const backupAccountProjection = {
	_id: 0,
	shareId: 1,
	ownerId: 1,
	thingtime: 1,
	secure: 1,
	secureRecentReactions: 1,
	avatarAttachmentId: 1,
	bannerAttachmentId: 1,
	'crystal.username': 1,
	'crystal.ttid': 1,
	'crystal.displayName': 1,
	'crystal.bio': 1,
	'crystal.avatarUrl': 1,
	'crystal.bannerUrl': 1
};
const digest = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const json = (v: unknown) => backupJson(v, BACKUP_ACCOUNT_BYTES);
const own = (v: object, key: string) => Object.prototype.hasOwnProperty.call(v, key);
const decodeBinary = (value: any, max: number) => {
	const length = binaryBytes(value);
	if (length === null || length > max) throw Error('Invalid account binary envelope');
	return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.isBuffer(value) ? value : value.value());
};

/** The only user envelope decoder in inventory. Fail on corrupt/oversize
 * BinData instead of the login adapter's legacy empty-object fallback. Nothing
 * outside the explicitly approved content projection reaches the vault. */
export function backupAccountSnapshotFromDoc(doc: any): TimelineSnapshot {
	if (!doc || doc.shareId !== doc.ownerId || !Array.isArray(doc.thingtime) || doc.thingtime.length !== 1 || doc.thingtime[0] !== 'user')
		throw Error('Invalid account inventory family');
	const length = binaryBytes(doc.secure);
	if (length === null || length < 2 || length > 16 * 1024 * 1024) throw Error('Invalid account private envelope');
	let secure;
	try {
		secure = JSON.parse(decodeBinary(doc.secure, 16 * 1024 * 1024));
	} catch {
		throw Error('Invalid account private envelope');
	}
	if (
		!secure ||
		typeof secure !== 'object' ||
		Array.isArray(secure) ||
		(secure.meta != null && (typeof secure.meta !== 'object' || Array.isArray(secure.meta)))
	)
		throw Error('Invalid account private envelope');
	const profile = { ...doc.crystal };
	for (const slot of ['avatar', 'banner']) if (own(doc, `${slot}AttachmentId`)) profile[`${slot}AttachmentId`] = doc[`${slot}AttachmentId`];
	const recent = own(doc, 'secureRecentReactions') ? doc.secureRecentReactions : secure.meta?.recentReactions ?? [];
	if (!Array.isArray(recent) || recent.length > 500) throw Error('Invalid recent reactions');
	const recentReactions = recent.map((v: unknown) => {
		if (!own(doc, 'secureRecentReactions') && typeof v === 'string') return v;
		const bytes = binaryBytes(v);
		if (bytes === null || bytes > 16 * 1024) throw Error('Invalid recent reaction envelope');
		return decodeBinary(v, 16 * 1024);
	});
	return accountContentSnapshot({ ownerId: doc.ownerId, profile, preferences: secure.meta ?? {}, recentReactions });
}

/** Read the account record through the same home snapshot as the inventory.
 * Only the approved content leaves this API utility; callers never receive the
 * private user envelope. This is an internal worker read, not a public route. */
export async function readBackupAccountContent(
	access: BackupAccess,
	session: any,
	collection: () => Promise<any> = getHomeThingsCollection
): Promise<TimelineSnapshot> {
	const scope = { ...access.scope },
		scopeKey = timelineScopeKey(scope);
	const check = async () => {
		access.signal?.throwIfAborted();
		if (scope.dataPlane !== 'home' || isCustomMongoEndpointActive() || timelineScopeKey(access.scope) !== scopeKey)
			throw Error('Account snapshots require an unchanged home account');
		await access.authorize();
		access.signal?.throwIfAborted();
		if (isCustomMongoEndpointActive() || timelineScopeKey(access.scope) !== scopeKey)
			throw Error('Account snapshots require an unchanged home account');
	};
	await check();
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(scope.ownerId) || !session?.snapshotEnabled || session.inTransaction())
		throw Error('Account content requires an identified read-only snapshot');
	const cursor = (await collection())
		.find(
			{ ownerId: scope.ownerId, shareId: { $in: [scope.ownerId] } },
			{
				session,
				projection: backupAccountProjection,
				readPreference: 'primary',
				collation: { locale: 'simple' },
				// One exact identity uses the existing unique ID index. The outer
				// account census still requires its bounded owner/ID paging index.
				hint: { shareId: 1 },
				maxTimeMS: 10_000,
				signal: access.signal
			}
		)
		.sort({ shareId: 1 })
		.limit(2)
		.batchSize(2);
	let snapshot: TimelineSnapshot | undefined;
	try {
		for await (const doc of cursor) {
			await check();
			if (snapshot || doc.ownerId !== scope.ownerId || doc.shareId !== scope.ownerId) throw Error('Account snapshot identity is ambiguous');
			snapshot = backupAccountSnapshotFromDoc(doc);
		}
	} finally {
		await cursor.close();
	}
	await check();
	if (!snapshot) throw Error('Account snapshot content is missing');
	return snapshot;
}

export type BackupProfileAttachmentReference = { ownerId: string; attachmentId: string; profileSlot: 'avatar' | 'banner' };
export function backupProfileAttachmentReferences(snapshot: TimelineSnapshot): BackupProfileAttachmentReference[] {
	const value = accountContentValue(snapshot),
		out: BackupProfileAttachmentReference[] = [];
	for (const profileSlot of ['avatar', 'banner'] as const) {
		const attachmentId = value.profile[`${profileSlot}AttachmentId`];
		if (typeof attachmentId === 'string') out.push({ ownerId: value.ownerId, attachmentId, profileSlot });
	}
	return out;
}
export function verifyBackupProfileAttachment(ref: BackupProfileAttachmentReference, attachment: BackupAttachment) {
	if (
		ref.attachmentId !== attachment.id ||
		ref.ownerId !== attachment.ownerId ||
		attachment.purpose !== 'profile' ||
		attachment.profileSlot !== ref.profileSlot ||
		(attachment.snapshot.value as any).targetId !== ref.ownerId
	)
		throw Error('Profile attachment is missing or changed');
}

export async function retainBackupAccountContent(
	store: BackupObjectStore,
	snapshotId: string,
	ordinal: number,
	snapshot: TimelineSnapshot,
	access: BackupAccess
) {
	const value = accountContentValue(snapshot);
	if (value.ownerId !== access.scope.ownerId) throw Error('Account backup owner changed');
	const text = json(snapshot),
		sha256 = digest(text);
	return retainBackupPayload(
		store,
		snapshotId,
		{ ordinal, thingId: value.ownerId, revision: 'snapshot-' + sha256, snapshot: { adapter: BACKUP_ACCOUNT_ADAPTER, version: 1, value: { sha256 } } },
		Buffer.from(text),
		access
	);
}

/** Read-only offline recovery. Identity, active selections and preferences are
 * historical content, never authority to sign in, grant access or overwrite a
 * live account. A live restore must use the currently authorized writers. */
export async function openBackupAccountSnapshot(
	store: BackupObjectStore,
	snapshotId: string,
	thingId: string,
	access: BackupAccess
): Promise<TimelineSnapshot> {
	const { item, ranges } = await openBackupItem(store, snapshotId, thingId, access),
		descriptor = item.snapshot.value as any;
	if (
		item.snapshot.adapter !== BACKUP_ACCOUNT_ADAPTER ||
		item.snapshot.version !== 1 ||
		!descriptor ||
		Object.keys(descriptor).length !== 1 ||
		!/^[a-f0-9]{64}$/.test(descriptor.sha256) ||
		!item.content ||
		item.content.size > BACKUP_ACCOUNT_BYTES
	)
		throw Error('Invalid retained account descriptor');
	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const bytes of ranges) {
		size += bytes.length;
		if (size > BACKUP_ACCOUNT_BYTES) throw Error('Retained account exceeds its bound');
		chunks.push(bytes);
	}
	const bytes = Buffer.concat(chunks),
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	if (digest(bytes) !== descriptor.sha256 || item.revision !== 'snapshot-' + descriptor.sha256) throw Error('Retained account digest changed');
	const snapshot = JSON.parse(text),
		value = accountContentValue(snapshot);
	if (json(accountContentSnapshot(value)) !== text || value.ownerId !== thingId || thingId !== access.scope.ownerId)
		throw Error('Retained account identity changed');
	return snapshot;
}
