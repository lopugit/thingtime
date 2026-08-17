// Storage-accounted Mongo mutations for the protected Messenger Thing family.
//
// Messenger routes cannot use generic Thing CRUD, but their rows are still
// ordinary user-owned content for account quota purposes. Every home-plane
// insert/update/delete therefore carries the same versioned byte stamp and
// touches the same subscription ledger, in the same transaction, as generic
// posts and Things. Attachment object bytes remain on their own protected
// attachment Things; message/emoji rows account only for their JSON payload.
import { withHomeMongoTransaction, withMongoTransaction } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import {
	StorageMutationError,
	USER_STORAGE_ACCOUNTING_VERSION,
	currentContentStorageSizeBytes,
	isBillableStorageThing,
	thingStorageSizeBytes
} from '../storage/storageCore';
import { applyUserStorageDelta, markUserStorageNeedsReconcile } from '../storage/userStorage';

type MessengerPlane = 'active' | 'home';
type MutationOptions = Record<string, any> & {
	session?: any;
	messengerPlane?: MessengerPlane;
	allowUncertainStorageRewrite?: boolean;
};

const optionsWithoutPlane = (options: MutationOptions): Record<string, any> => {
	const {
		messengerPlane: _messengerPlane,
		allowUncertainStorageRewrite: _allowUncertainStorageRewrite,
		...mongoOptions
	} = options;
	return mongoOptions;
};

const accountPlaneApplies = (plane: MessengerPlane): boolean => plane === 'home' || !isCustomMongoEndpointActive();

const runMutation = async <T>(options: MutationOptions, work: (session: any) => Promise<T>): Promise<T> => {
	if (options.session) return work(options.session);
	const plane = options.messengerPlane ?? 'active';
	return (plane === 'home' ? withHomeMongoTransaction : withMongoTransaction)(work);
};

const canonicalSize = (doc: any): number => thingStorageSizeBytes(doc);

const stampFor = (doc: any): Record<string, unknown> => ({
	storageClass: 'content',
	sizeBytes: canonicalSize(doc),
	storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION
});

const billableOnPlane = (doc: any, plane: MessengerPlane): boolean =>
	accountPlaneApplies(plane) && isBillableStorageThing(doc);

const addDelta = (deltas: Map<string, number>, ownerId: unknown, delta: number) => {
	if (!delta) return;
	const owner = typeof ownerId === 'string' ? ownerId : '';
	if (!owner) {
		throw new StorageMutationError(500, 'storage_invariant', 'Messenger content has no storage owner');
	}
	const next = (deltas.get(owner) ?? 0) + delta;
	if (!Number.isSafeInteger(next)) {
		throw new StorageMutationError(500, 'storage_invariant', 'Messenger storage delta exceeds the exact counter range');
	}
	deltas.set(owner, next);
};

const applyDeltas = async (deltas: Map<string, number>, session: any) => {
	for (const ownerId of [...deltas.keys()].sort()) {
		await applyUserStorageDelta(ownerId, deltas.get(ownerId)!, session);
	}
};

export const insertMessengerThing = async (
	things: any,
	doc: any,
	options: MutationOptions = {}
): Promise<any> => {
	const plane = options.messengerPlane ?? 'active';
	if (!billableOnPlane(doc, plane)) return things.insertOne(doc, optionsWithoutPlane(options));
	Object.assign(doc, stampFor(doc));
	return runMutation(options, async (session) => {
		await applyUserStorageDelta(String(doc.ownerId), Number(doc.sizeBytes), session);
		return things.insertOne(doc, { ...optionsWithoutPlane(options), session });
	});
};

const updateMessenger = async (
	multi: boolean,
	things: any,
	filter: any,
	update: any,
	options: MutationOptions = {}
): Promise<any> => {
	const plane = options.messengerPlane ?? 'active';
	if (!accountPlaneApplies(plane)) {
		return multi
			? things.updateMany(filter, update, optionsWithoutPlane(options))
			: things.updateOne(filter, update, optionsWithoutPlane(options));
	}
	return runMutation(options, async (session) => {
		const before = multi
			? await things.find(filter, { session }).toArray()
			: [await things.findOne(filter, { session })].filter(Boolean);
		const beforeById = new Map(before.map((doc: any) => [String(doc._id), doc]));

		const mongoOptions = { ...optionsWithoutPlane(options), session };
		const result = multi
			? await things.updateMany(filter, update, mongoOptions)
			: await things.updateOne(filter, update, mongoOptions);
		const ids = before.map((doc: any) => doc._id);
		if (!before.length && result.upsertedId) ids.push(result.upsertedId);
		if (!ids.length) return result;

		const after = await things.find({ _id: { $in: ids } }, { session }).toArray();
		if (after.length !== ids.length) {
			throw new StorageMutationError(409, 'storage_conflict', 'Messenger content changed while it was being updated — try again');
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
							'Messenger content requires the current storage migration before it can grow'
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
				await things.updateOne(
					{ _id: doc._id },
					{ $unset: { storageClass: '', sizeBytes: '', storageAccountingVersion: '' } },
					{ session }
				);
			}
		}
		for (const ownerId of uncertainOwners) deltas.delete(ownerId);
		await applyDeltas(deltas, session);
		for (const ownerId of [...uncertainOwners].sort()) await markUserStorageNeedsReconcile(ownerId, session);
		return result;
	});
};

export const updateMessengerThing = (
	things: any,
	filter: any,
	update: any,
	options: MutationOptions = {}
): Promise<any> => updateMessenger(false, things, filter, update, options);

export const updateMessengerThings = (
	things: any,
	filter: any,
	update: any,
	options: MutationOptions = {}
): Promise<any> => updateMessenger(true, things, filter, update, options);

const deleteMessenger = async (
	multi: boolean,
	things: any,
	filter: any,
	options: MutationOptions = {}
): Promise<any> => {
	const plane = options.messengerPlane ?? 'active';
	if (!accountPlaneApplies(plane)) {
		return multi ? things.deleteMany(filter, optionsWithoutPlane(options)) : things.deleteOne(filter, optionsWithoutPlane(options));
	}
	return runMutation(options, async (session) => {
		const docs = multi
			? await things.find(filter, { session }).toArray()
			: [await things.findOne(filter, { session })].filter(Boolean);
		const result = multi
			? await things.deleteMany(filter, { ...optionsWithoutPlane(options), session })
			: await things.deleteOne(filter, { ...optionsWithoutPlane(options), session });
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

export const deleteMessengerThing = (things: any, filter: any, options: MutationOptions = {}): Promise<any> =>
	deleteMessenger(false, things, filter, options);

export const deleteMessengerThings = (things: any, filter: any, options: MutationOptions = {}): Promise<any> =>
	deleteMessenger(true, things, filter, options);

// Test/documentation seam for the exact root fields every new Messenger row
// receives. Production inserts call the same function through stampFor above.
export const stampMessengerStorageDocument = (doc: any): any => ({ ...doc, ...stampFor(doc) });

// Home-pinned identity edges (currently follows) pass this option even while a
// custom content Mongo endpoint is active, matching their existing data plane.
export const HOME_MESSENGER_STORAGE_OPTIONS = { messengerPlane: 'home' as const };

export const withMessengerStorageTransaction = <T>(
	work: (session: any) => Promise<T>,
	plane: MessengerPlane = 'active'
): Promise<T> => (plane === 'home' ? withHomeMongoTransaction : withMongoTransaction)(work);
