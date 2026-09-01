// Exact account-quota mutations for protected Thing families that cannot use
// the generic /things writer. Persistent device mirrors and Messenger rows
// both use this module so protected content cannot silently bypass the same
// subscription ledger as posts. Object bytes remain accounted only by their
// protected attachment Thing.
import { withHomeMongoTransaction, withMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import {
	StorageMutationError,
	USER_STORAGE_ACCOUNTING_VERSION,
	currentContentStorageSizeBytes,
	isBillableStorageThing,
	thingStorageSizeBytes
} from './storageCore';
import { applyUserStorageDelta, markUserStorageNeedsReconcile } from './userStorage';

export type AccountedThingPlane = 'active' | 'home';
export type AccountedThingMutationOptions = Record<string, any> & {
	session?: any;
	accountedPlane?: AccountedThingPlane;
	allowUncertainStorageRewrite?: boolean;
};

const optionsWithoutAccounting = (options: AccountedThingMutationOptions): Record<string, any> => {
	const { accountedPlane: _accountedPlane, allowUncertainStorageRewrite: _allowUncertainStorageRewrite, ...mongoOptions } = options;
	return mongoOptions;
};

const accountPlaneApplies = (plane: AccountedThingPlane): boolean => plane === 'home' || !isCustomMongoEndpointActive();

const runMutation = async <T>(options: AccountedThingMutationOptions, work: (session: any) => Promise<T>): Promise<T> => {
	if (options.session) return work(options.session);
	const plane = options.accountedPlane ?? 'active';
	return (plane === 'home' ? withHomeMongoTransaction : withMongoTransaction)(work);
};

const canonicalSize = (doc: any): number => thingStorageSizeBytes(doc);

const stampFor = (doc: any): Record<string, unknown> => ({
	storageClass: 'content',
	sizeBytes: canonicalSize(doc),
	storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION
});

const billableOnPlane = (doc: any, plane: AccountedThingPlane): boolean => accountPlaneApplies(plane) && isBillableStorageThing(doc);

const addDelta = (deltas: Map<string, number>, ownerId: unknown, delta: number) => {
	if (!delta) return;
	const owner = typeof ownerId === 'string' ? ownerId : '';
	if (!owner) {
		throw new StorageMutationError(500, 'storage_invariant', 'Accounted content has no storage owner');
	}
	const next = (deltas.get(owner) ?? 0) + delta;
	if (!Number.isSafeInteger(next)) {
		throw new StorageMutationError(500, 'storage_invariant', 'Accounted storage delta exceeds the exact counter range');
	}
	deltas.set(owner, next);
};

const applyDeltas = async (deltas: Map<string, number>, session: any) => {
	for (const ownerId of [...deltas.keys()].sort()) {
		await applyUserStorageDelta(ownerId, deltas.get(ownerId)!, session);
	}
};

export const insertAccountedThing = async (things: any, doc: any, options: AccountedThingMutationOptions = {}): Promise<any> => {
	const plane = options.accountedPlane ?? 'active';
	if (!billableOnPlane(doc, plane)) return things.insertOne(doc, optionsWithoutAccounting(options));
	Object.assign(doc, stampFor(doc));
	return runMutation(options, async (session) => {
		await applyUserStorageDelta(String(doc.ownerId), Number(doc.sizeBytes), session);
		return things.insertOne(doc, { ...optionsWithoutAccounting(options), session });
	});
};

const updateAccounted = async (multi: boolean, things: any, filter: any, update: any, options: AccountedThingMutationOptions = {}): Promise<any> => {
	const plane = options.accountedPlane ?? 'active';
	if (!accountPlaneApplies(plane)) {
		return multi
			? things.updateMany(filter, update, optionsWithoutAccounting(options))
			: things.updateOne(filter, update, optionsWithoutAccounting(options));
	}
	return runMutation(options, async (session) => {
		const before = multi ? await things.find(filter, { session }).toArray() : [await things.findOne(filter, { session })].filter(Boolean);
		const beforeById = new Map(before.map((doc: any) => [String(doc._id), doc]));

		const mongoOptions = { ...optionsWithoutAccounting(options), session };
		const result = multi ? await things.updateMany(filter, update, mongoOptions) : await things.updateOne(filter, update, mongoOptions);
		const ids = before.map((doc: any) => doc._id);
		if (!before.length && result.upsertedId) ids.push(result.upsertedId);
		if (!ids.length) return result;

		const after = await things.find({ _id: { $in: ids } }, { session }).toArray();
		if (after.length !== ids.length) {
			throw new StorageMutationError(409, 'storage_conflict', 'Accounted content changed while it was being updated — try again');
		}
		const deltas = new Map<string, number>();
		const uncertainOwners = new Set<string>();
		for (const doc of after) {
			const old = beforeById.get(String(doc._id)) as any;
			const oldBillable = !!old && billableOnPlane(old, plane);
			const nextBillable = billableOnPlane(doc, plane);
			if (oldBillable) {
				const currentBytes = currentContentStorageSizeBytes(old);
				if (currentBytes === null) {
					const oldCanonical = canonicalSize(old);
					const nextCanonical = nextBillable ? canonicalSize(doc) : 0;
					if (
						!nextBillable ||
						String(old.ownerId) !== String(doc.ownerId) ||
						(nextCanonical > oldCanonical && options.allowUncertainStorageRewrite !== true)
					) {
						throw new StorageMutationError(
							503,
							'accounting_unavailable',
							'Accounted content requires the current storage migration before it can grow'
						);
					}
					uncertainOwners.add(String(old.ownerId));
				} else {
					addDelta(deltas, old.ownerId, -currentBytes);
				}
			}
			if (nextBillable) {
				const stamp = stampFor(doc);
				await things.updateOne({ _id: doc._id }, { $set: stamp }, { session });
				addDelta(deltas, doc.ownerId, Number(stamp.sizeBytes));
			} else if (oldBillable) {
				await things.updateOne({ _id: doc._id }, { $unset: { storageClass: '', sizeBytes: '', storageAccountingVersion: '' } }, { session });
			}
		}
		for (const ownerId of uncertainOwners) deltas.delete(ownerId);
		await applyDeltas(deltas, session);
		for (const ownerId of [...uncertainOwners].sort()) await markUserStorageNeedsReconcile(ownerId, session);
		return result;
	});
};

export const updateAccountedThing = (things: any, filter: any, update: any, options: AccountedThingMutationOptions = {}): Promise<any> =>
	updateAccounted(false, things, filter, update, options);

export const updateAccountedThings = (things: any, filter: any, update: any, options: AccountedThingMutationOptions = {}): Promise<any> =>
	updateAccounted(true, things, filter, update, options);

const deleteAccounted = async (multi: boolean, things: any, filter: any, options: AccountedThingMutationOptions = {}): Promise<any> => {
	const plane = options.accountedPlane ?? 'active';
	if (!accountPlaneApplies(plane)) {
		return multi ? things.deleteMany(filter, optionsWithoutAccounting(options)) : things.deleteOne(filter, optionsWithoutAccounting(options));
	}
	return runMutation(options, async (session) => {
		const docs = multi ? await things.find(filter, { session }).toArray() : [await things.findOne(filter, { session })].filter(Boolean);
		const result = multi
			? await things.deleteMany(filter, { ...optionsWithoutAccounting(options), session })
			: await things.deleteOne(filter, { ...optionsWithoutAccounting(options), session });
		const deltas = new Map<string, number>();
		const uncertainOwners = new Set<string>();
		for (const doc of docs) {
			if (!billableOnPlane(doc, plane)) continue;
			const ownerId = typeof doc.ownerId === 'string' ? doc.ownerId : '';
			if (!ownerId) continue;
			const bytes = currentContentStorageSizeBytes(doc);
			if (bytes === null) uncertainOwners.add(ownerId);
			else addDelta(deltas, ownerId, -bytes);
		}
		for (const ownerId of uncertainOwners) deltas.delete(ownerId);
		await applyDeltas(deltas, session);
		for (const ownerId of [...uncertainOwners].sort()) await markUserStorageNeedsReconcile(ownerId, session);
		return result;
	});
};

export const deleteAccountedThing = (things: any, filter: any, options: AccountedThingMutationOptions = {}): Promise<any> =>
	deleteAccounted(false, things, filter, options);

export const deleteAccountedThings = (things: any, filter: any, options: AccountedThingMutationOptions = {}): Promise<any> =>
	deleteAccounted(true, things, filter, options);

export const stampAccountedStorageDocument = (doc: any): any => ({ ...doc, ...stampFor(doc) });

export const HOME_ACCOUNTED_STORAGE_OPTIONS = { accountedPlane: 'home' as const };

export const withAccountedThingsTransaction = <T>(work: (session: any) => Promise<T>, plane: AccountedThingPlane = 'active'): Promise<T> =>
	(plane === 'home' ? withHomeMongoTransaction : withMongoTransaction)(work);
