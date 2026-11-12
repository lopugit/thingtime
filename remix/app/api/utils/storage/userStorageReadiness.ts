import { getHomeThingsCollection, getUsersCollection } from '../mongodb/collections';
import { subscriptionThingMatch, userSubscriptionLedgerEnvelopeIsTrusted } from '../subscriptions/subscriptionIdentity';
import {
	USER_STORAGE_ACCOUNTING_VERSION,
	USER_STORAGE_STATUS,
	billableStorageCandidateExpression,
	currentStorageSourceMatch
} from './storageCore';
import { userStorageAllowanceIsValid } from './userStorage';
import { userStoragePendingStateIsTrusted } from './storagePending';
import { userStorageRecoveryId, userStorageRecoveryJobIsTrusted } from './userStorageRecovery';

export const USER_STORAGE_ACCOUNTING_MIGRATION_ID = 'backfill-user-storage-accounting';

export type UserStorageAccountingReadiness = {
	state: 'ready' | 'recovering' | 'migration-required';
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
			!Object.prototype.hasOwnProperty.call(doc.crystal, 'storagePendingCount') &&
			Number.isSafeInteger(doc.crystal?.storageUsedBytes) &&
			Number(doc.crystal.storageUsedBytes) >= 0 &&
			userStorageAllowanceIsValid(doc.crystal)
		);
	});
};

// Recovering means durable pending work, never a claim of exact accounting or
// worker success. Invalid/blocked state takes precedence and remains explicit.
export const userStorageLedgersState = (ownerIds: readonly string[], ledgers: readonly any[], jobs: readonly any[], now = new Date()): UserStorageAccountingReadiness['state'] => {
	if (userStorageLedgersAreReady(ownerIds, ledgers)) return 'ready';
	const byShareId = new Map(ledgers.map(doc => [String(doc?.shareId || ''), doc]));
	const byJobId = new Map(jobs.map(doc => [String(doc?.shareId || ''), doc]));
	for (const ownerId of [...new Set(ownerIds)]) {
		const ledger = byShareId.get(subscriptionThingMatch('user', ownerId).shareId);
		if (userStorageLedgersAreReady([ownerId], ledger ? [ledger] : [])) continue;
		const job = byJobId.get(userStorageRecoveryId(ownerId));
		if (!userSubscriptionLedgerEnvelopeIsTrusted(ledger, ownerId) ||
			ledger.crystal.storageAccountingVersion !== USER_STORAGE_ACCOUNTING_VERSION ||
			ledger.crystal.storageLedgerStatus !== USER_STORAGE_STATUS.needsReconcile ||
			!userStorageAllowanceIsValid(ledger.crystal) || !userStoragePendingStateIsTrusted(ledger.crystal) ||
			!Number.isSafeInteger(ledger.crystal.storageUsedBytes) || ledger.crystal.storageUsedBytes < 0 ||
			!userStorageRecoveryJobIsTrusted(job) || !['queued', 'running', 'retry'].includes(job.crystal.status) ||
			(job.crystal.status === 'running' && job.crystal.leaseUntil <= now)) return 'migration-required';
	}
	return 'recovering';
};

export const userStorageSourcesAreReady = async (things: { findOne: (filter: any, options: any) => Promise<any> }): Promise<boolean> => {
	// Find a single counterexample without returning private content or loading
	// the corpus into memory. Sandbox owners have their own ephemeral ledgers.
	const invalid = await things.findOne({
		ownerId: { $type: 'string', $ne: '', $not: /^sandbox:/ },
		$expr: billableStorageCandidateExpression,
		$nor: [currentStorageSourceMatch]
	}, { projection: { _id: 1 }, maxTimeMS: 5_000 });
	return invalid === null;
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
	let state: UserStorageAccountingReadiness['state'] = 'ready';
	for (let offset = 0; offset < ownerIds.length; offset += 500) {
		const batch = ownerIds.slice(offset, offset + 500);
		const ledgers = await things.find({ shareId: { $in: batch.map((ownerId) => subscriptionThingMatch('user', ownerId).shareId) } }).toArray();
		const jobs = userStorageLedgersAreReady(batch, ledgers) ? [] : await things.find({ shareId: { $in: batch.map(userStorageRecoveryId) } }).toArray();
		const batchState = userStorageLedgersState(batch, ledgers, jobs);
		if (batchState === 'migration-required') { state = batchState; break; }
		if (batchState === 'recovering') state = batchState;
	}

	if (!(await userStorageSourcesAreReady(things))) state = 'migration-required';

	return {
		state,
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
