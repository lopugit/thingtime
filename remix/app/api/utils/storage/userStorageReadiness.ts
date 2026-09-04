import { getHomeThingsCollection, getUsersCollection } from '../mongodb/collections';
import { subscriptionThingMatch, userSubscriptionLedgerEnvelopeIsTrusted } from '../subscriptions/subscriptionIdentity';
import { USER_STORAGE_ACCOUNTING_VERSION, USER_STORAGE_STATUS } from './storageCore';
import { userStorageAllowanceIsValid } from './userStorage';

export const USER_STORAGE_ACCOUNTING_MIGRATION_ID = 'backfill-user-storage-accounting';

export type UserStorageAccountingReadiness = {
	state: 'ready' | 'migration-required';
	expectedVersion: number;
	migrationId: typeof USER_STORAGE_ACCOUNTING_MIGRATION_ID;
};

const CACHE_MS = 30_000;
let cachedReadiness: { expiresAt: number; promise: Promise<UserStorageAccountingReadiness> } | null = null;

export const userStorageLedgersAreReady = (ownerIds: readonly string[], ledgers: readonly any[]): boolean => {
	const ids = [...new Set(ownerIds.map(String).filter(Boolean))];
	if (!ids.length) return true;
	const ledgerByShareId = new Map(ledgers.map((doc) => [String(doc?.shareId || ''), doc]));

	return ids.every((ownerId) => {
		const doc = ledgerByShareId.get(subscriptionThingMatch('user', ownerId).shareId);
		return (
			userSubscriptionLedgerEnvelopeIsTrusted(doc, ownerId) &&
			doc.crystal?.storageAccountingVersion === USER_STORAGE_ACCOUNTING_VERSION &&
			doc.crystal?.storageLedgerStatus === USER_STORAGE_STATUS.ready &&
			Number.isSafeInteger(doc.crystal?.storageUsedBytes) &&
			Number(doc.crystal.storageUsedBytes) >= 0 &&
			userStorageAllowanceIsValid(doc.crystal)
		);
	});
};

const readUserStorageAccountingReadiness = async (): Promise<UserStorageAccountingReadiness> => {
	const [things, users] = await Promise.all([getHomeThingsCollection(), getUsersCollection()]);
	const [thingUsers, legacyUsers] = await Promise.all([
		things.find({ thingtime: 'user' }).project({ shareId: 1 }).toArray(),
		users.find({}).project({ _id: 1 }).toArray()
	]);
	const ownerIds = [
		...new Set([
			...thingUsers.map((doc: any) => String(doc.shareId || '')).filter(Boolean),
			...legacyUsers.map((doc: any) => String(doc._id || '')).filter(Boolean)
		])
	];
	let ready = true;
	for (let offset = 0; offset < ownerIds.length && ready; offset += 500) {
		const batch = ownerIds.slice(offset, offset + 500);
		const ledgers = await things.find({ shareId: { $in: batch.map((ownerId) => subscriptionThingMatch('user', ownerId).shareId) } }).toArray();
		ready = userStorageLedgersAreReady(batch, ledgers);
	}

	return {
		state: ready ? 'ready' : 'migration-required',
		expectedVersion: USER_STORAGE_ACCOUNTING_VERSION,
		migrationId: USER_STORAGE_ACCOUNTING_MIGRATION_ID
	};
};

export const getUserStorageAccountingReadiness = (): Promise<UserStorageAccountingReadiness> => {
	const now = Date.now();
	if (cachedReadiness && cachedReadiness.expiresAt > now) return cachedReadiness.promise;

	const promise = readUserStorageAccountingReadiness();
	cachedReadiness = { expiresAt: now + CACHE_MS, promise };
	promise.catch(() => {
		if (cachedReadiness?.promise === promise) cachedReadiness = null;
	});
	return promise;
};
