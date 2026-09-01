import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';

// feed-algorithm is a PROTECTED system kind: algorithm things stay on the home
// deployment DB even while a data-plane endpoint override is active.
import { getFeedAlgorithmsCollection, getHomeThingsCollection as getThingsCollection, getUsersCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { clearUserActiveFeedAlgorithm, setUserActiveFeedAlgorithm } from '../auth/users';
import { applyEventsToWeights, emptyWeights, topInterests, type AlgorithmWeights, type EngagementEvent } from '../things/feedRanking';
import { getPostFeatures } from '../things/things';
import { StorageMutationError, USER_STORAGE_ACCOUNTING_VERSION, currentContentStorageSizeBytes, thingStorageSizeBytes } from '../storage/storageCore';
import { applyUserStorageDelta, markUserStorageNeedsReconcile, readyUserStorageMatch } from '../storage/userStorage';

// Personal feed algorithms: named, branchable interest-weight profiles trained
// by doomscroll engagement. A user can keep many and switch the active one
// (users.meta.activeFeedAlgorithmId).
//
// Feed algorithms are THINGS now (thingtime ['feed-algorithm'], see
// TODO/claude-todo/22-everything-is-a-thing-collections.md): the trained
// profile lives in crystal, ALWAYS private (acl ['tt:user']) because the
// weight maps encode the owner's reading habits.
// This module keeps the legacy FeedAlgorithmDoc shape as its interchange
// format — every things-era read adapts back to it, so projectAlgorithm and
// the /api/v1/algorithms* routes are untouched. Reads are dual-era (things
// first, legacy feedAlgorithms collection fallback) until the
// feed-algorithms-to-things admin migration converts old docs; writes create
// things for new algorithms, and updates target whichever store holds the doc.

export type FeedAlgorithmDoc = {
  _id?: any;
  shareId: string;
  ownerId: string;
  name: string;
  emoji: string;
  parentId: string | null;
  weights: AlgorithmWeights;
  eventCount: number;
  lastTrainedAt: Date | null;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicAlgorithm = {
  id: string;
  name: string;
  emoji: string;
  parentId: string | null;
  eventCount: number;
  lastTrainedAt: string | null;
  createdAt: string;
  updatedAt: string;
  topInterests: Array<{ kind: 'type' | 'tag' | 'author'; key: string; label?: string; weight: number }>;
};

const MAX_ALGORITHMS_PER_USER = 50;
const MAX_NAME_CHARS = 60;
const MAX_EVENTS_PER_BATCH = 100;
const DEFAULT_EMOJI = '🧠';

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

const storageFail = (error: unknown): Fail | null => (error instanceof StorageMutationError ? fail(error.status, error.message) : null);

const storedAlgorithmSizeBytes = (thing: any): number => {
	const canonical = currentContentStorageSizeBytes(thing || {});
	if (canonical === null) {
		throw new StorageMutationError(409, 'storage_conflict', 'This feed algorithm requires the current storage migration before it can be changed');
	}
	return canonical;
};

const algorithmStorageCas = (thing: any): Record<string, unknown> => ({
	updatedAt: thing.updatedAt,
	storageClass: 'content',
	storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
	sizeBytes: thing.sizeBytes
});

const assertLegacyAlgorithmMutationAllowed = async (ownerId: string, things: any, session: any): Promise<void> => {
	const ready = await things.findOne(readyUserStorageMatch(ownerId), { projection: { _id: 1 }, session });
	if (ready) {
		throw new StorageMutationError(
			409,
			'storage_conflict',
			'This feed algorithm is still in legacy storage and must be migrated before it can be changed'
		);
	}
};

// thing → legacy FeedAlgorithmDoc view (same move as users.ts userThingToDoc):
// shareId/ownerId stay at the root, the trained profile comes out of crystal.
const algorithmThingToDoc = (thing: any): FeedAlgorithmDoc => ({
  _id: thing._id,
  shareId: thing.shareId,
  ownerId: thing.ownerId,
  name: thing.crystal?.name || '',
  emoji: thing.crystal?.emoji || DEFAULT_EMOJI,
  parentId: thing.crystal?.parentId ?? null,
  weights: thing.crystal?.weights || emptyWeights(),
  eventCount: thing.crystal?.eventCount || 0,
  lastTrainedAt: thing.crystal?.lastTrainedAt ?? null,
  schemaVersion: thing.schemaVersion,
  createdAt: thing.createdAt,
  updatedAt: thing.updatedAt
});

// Resolve author-interest userIds to usernames (one batched pass across any
// number of algorithms) so the UI can show "@rick" instead of a Mongo id.
// Dual-era like resolveProfiles in things/things.ts: user things first
// (shareId = the id weight keys carry), legacy users collection for the rest.
const resolveAuthorUsernames = async (ids: string[]): Promise<Map<string, string>> => {
  const wanted = [...new Set(ids)].filter((id) => typeof id === 'string' && id.trim());
  if (!wanted.length) return new Map();
  const usernames = new Map<string, string>();

  const things = await getThingsCollection();
  const userThings = await things
    .find({ thingtime: 'user', shareId: { $in: wanted } } as any)
    .project({ shareId: 1, 'crystal.username': 1 })
    .toArray();
  for (const doc of userThings as any[]) {
    if (doc.crystal?.username) usernames.set(String(doc.shareId), doc.crystal.username);
  }

  const remaining = wanted.filter((id) => !usernames.has(id) && ObjectId.isValid(id));
  if (remaining.length) {
    const users = await getUsersCollection();
    const docs = await users
      .find({ _id: { $in: remaining.map((id) => new ObjectId(id)) } })
      .project({ username: 1 })
      .toArray();
    for (const doc of docs as any[]) usernames.set(String(doc._id), doc.username);
  }
  return usernames;
};

const projectAlgorithm = (doc: FeedAlgorithmDoc, usernames: Map<string, string>): PublicAlgorithm => ({
  id: doc.shareId,
  name: doc.name,
  emoji: doc.emoji || DEFAULT_EMOJI,
  parentId: doc.parentId || null,
  eventCount: doc.eventCount || 0,
  lastTrainedAt: doc.lastTrainedAt ? new Date(doc.lastTrainedAt).toISOString() : null,
  createdAt: new Date(doc.createdAt).toISOString(),
  updatedAt: new Date(doc.updatedAt).toISOString(),
  topInterests: topInterests(doc.weights || emptyWeights()).map((entry) =>
		entry.kind === 'author' && usernames.has(entry.key) ? { ...entry, label: `@${usernames.get(entry.key)}` } : entry
  )
});

export const toPublicAlgorithm = async (doc: FeedAlgorithmDoc): Promise<PublicAlgorithm> => {
  const interests = topInterests(doc.weights || emptyWeights());
	const usernames = await resolveAuthorUsernames(interests.filter((entry) => entry.kind === 'author').map((entry) => entry.key));
  return projectAlgorithm(doc, usernames);
};

// Client-supplied event batches: keep only well-formed entries so a [null]
// payload can never throw past the { ok, error } envelope.
const sanitizeEvents = (value: unknown): EngagementEvent[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is EngagementEvent =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as { thingId?: unknown }).thingId === 'string' &&
        typeof (entry as { signal?: unknown }).signal === 'string'
    )
    .slice(0, MAX_EVENTS_PER_BATCH);
};

const sanitizeEmoji = (value: unknown): string => {
  if (typeof value !== 'string') return DEFAULT_EMOJI;
  const trimmed = value.trim();
  // an emoji (or short grapheme cluster), not arbitrary text
  return trimmed && [...trimmed].length <= 3 ? trimmed : DEFAULT_EMOJI;
};

// Ownership-scoped lookup, dual-era with the era kept so writes can target the
// store the doc actually lives in. HOT PATH: getOwnedAlgorithmWeights rides
// this on every ranked feed load — at most two indexed findOnes (things via
// the unique shareId index first, legacy feedAlgorithms shareId index second).
type OwnedAlgorithm = { doc: FeedAlgorithmDoc; era: 'things' | 'legacy' };

const findOwnedAlgorithmWithEra = async (ownerId: string, shareId: unknown): Promise<OwnedAlgorithm | null> => {
  if (typeof shareId !== 'string' || !shareId.trim()) return null;
  const id = shareId.trim();
  const things = await getThingsCollection();
  const thing = await things.findOne({ shareId: id, ownerId, thingtime: 'feed-algorithm' } as any);
  if (thing) return { doc: algorithmThingToDoc(thing), era: 'things' };
  const algorithms = await getFeedAlgorithmsCollection();
  const legacy = (await algorithms.findOne({ shareId: id, ownerId } as any)) as any as FeedAlgorithmDoc | null;
  return legacy ? { doc: legacy, era: 'legacy' } : null;
};

const findOwnedAlgorithm = async (ownerId: string, shareId: unknown): Promise<FeedAlgorithmDoc | null> =>
  (await findOwnedAlgorithmWithEra(ownerId, shareId))?.doc ?? null;

export const listAlgorithmsForUser = async (ownerId: string): Promise<PublicAlgorithm[]> => {
  // things era rides {thingtime, ownerId, createdAt, shareId}; legacy rides
  // {ownerId}. Merge both (dedup by shareId), keep the picker's stable
  // createdAt-ascending order across the pair.
  const things = await getThingsCollection();
  const thingDocs = (
    await things
      .find({ thingtime: 'feed-algorithm', ownerId } as any)
      .sort({ createdAt: 1 })
      .limit(MAX_ALGORITHMS_PER_USER)
      .toArray()
  ).map(algorithmThingToDoc);

  const algorithms = await getFeedAlgorithmsCollection();
  const legacyDocs = (await algorithms
    .find({ ownerId })
    .sort({ createdAt: 1 })
    .limit(MAX_ALGORITHMS_PER_USER)
    .toArray()) as any as FeedAlgorithmDoc[];

  const seen = new Set<string>();
  const docs: FeedAlgorithmDoc[] = [];
  for (const doc of [...thingDocs, ...legacyDocs]) {
    if (seen.has(doc.shareId)) continue;
    seen.add(doc.shareId);
    docs.push(doc);
  }
  docs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const page = docs.slice(0, MAX_ALGORITHMS_PER_USER);

  const interestsByDoc = page.map((doc) => topInterests(doc.weights || emptyWeights()));
  const usernames = await resolveAuthorUsernames(
		interestsByDoc
			.flat()
			.filter((entry) => entry.kind === 'author')
			.map((entry) => entry.key)
  );
  return page.map((doc) => projectAlgorithm(doc, usernames));
};

export const getOwnedAlgorithmWeights = async (ownerId: string, shareId: string): Promise<AlgorithmWeights | null> => {
  const doc = await findOwnedAlgorithm(ownerId, shareId);
  return doc ? doc.weights || emptyWeights() : null;
};

export type CreateAlgorithmInput = {
  name?: unknown;
  emoji?: unknown;
  branchFrom?: unknown;
  events?: unknown;
};

// Create a fresh algorithm, optionally branched from an existing one (weights
// copied, lineage kept in parentId) and optionally seed-trained from a batch
// of session events ("save this doomscroll session as an algorithm").
export const createAlgorithm = async (ownerId: string, input: CreateAlgorithmInput): Promise<Fail | { ok: true; algorithm: PublicAlgorithm }> => {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, MAX_NAME_CHARS) : '';
  if (!name) return fail(400, 'Algorithm name is required');

  const things = await getThingsCollection();
  const algorithms = await getFeedAlgorithmsCollection();
  // the per-user cap spans both eras, or it would silently double mid-migration
  const [thingCount, legacyCount] = await Promise.all([
    things.countDocuments({ thingtime: 'feed-algorithm', ownerId } as any),
    algorithms.countDocuments({ ownerId })
  ]);
  if (thingCount + legacyCount >= MAX_ALGORITHMS_PER_USER) {
    return fail(400, `Algorithm limit reached (${MAX_ALGORITHMS_PER_USER})`);
  }

  let weights = emptyWeights();
  let parentId: string | null = null;
  if (input.branchFrom !== undefined && input.branchFrom !== null) {
    const parent = await findOwnedAlgorithm(ownerId, input.branchFrom);
    if (!parent) return fail(404, 'Algorithm to branch from was not found');
    weights = {
      types: { ...(parent.weights?.types || {}) },
      tags: { ...(parent.weights?.tags || {}) },
      authors: { ...(parent.weights?.authors || {}) }
    };
    parentId = parent.shareId;
  }

  const now = new Date();
  let eventCount = 0;
  let lastTrainedAt: Date | null = null;

  const seedEvents = sanitizeEvents(input.events);
  if (seedEvents.length) {
		const features = await getPostFeatures(
			ownerId,
			seedEvents.map((event) => event.thingId)
		);
    const trained = applyEventsToWeights(weights, seedEvents, features);
    weights = trained.weights;
    eventCount = trained.applied;
    lastTrainedAt = trained.applied ? now : null;
  }

  const doc: FeedAlgorithmDoc = {
    shareId: randomUUID(),
    ownerId,
    name,
    emoji: sanitizeEmoji(input.emoji),
    parentId,
    weights,
    eventCount,
    lastTrainedAt,
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
    createdAt: now,
    updatedAt: now
  };
  // New algorithms are things. ALWAYS private (acl [ACL_OWNER]) — the weight
  // maps are a behavioral profile of the owner and must never be discoverable.
  // targetId stays null (branch lineage lives ONLY in crystal.parentId) so the
  // things_reaction_unique partial index (string targetId + crystal.emoji) can
  // never collide two same-emoji branches of one parent.
	const thing = {
    shareId: doc.shareId,
    schemaVersion: doc.schemaVersion,
    thingtime: ['feed-algorithm'],
    crystal: {
      name: doc.name,
      emoji: doc.emoji,
      parentId: doc.parentId,
      weights: doc.weights,
      eventCount: doc.eventCount,
      lastTrainedAt: doc.lastTrainedAt
    },
		extended: null,
    ownerId,
    acl: [ACL_OWNER],
    targetId: null,
    tags: [],
    createdAt: now,
    updatedAt: now
	};
	const sizeBytes = thingStorageSizeBytes(thing);
	Object.assign(thing, {
		storageClass: 'content',
		sizeBytes,
		storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION
	});
	try {
		await withHomeMongoTransaction(async (session) => {
			await applyUserStorageDelta(ownerId, sizeBytes, session);
			await things.insertOne(thing as any, { session });
		});
	} catch (error) {
		const projected = storageFail(error);
		if (projected) return projected;
		throw error;
	}
  return { ok: true, algorithm: await toPublicAlgorithm(doc) };
};

export const updateAlgorithm = async (
  ownerId: string,
  input: { id?: unknown; name?: unknown; emoji?: unknown }
): Promise<Fail | { ok: true; algorithm: PublicAlgorithm }> => {
  const found = await findOwnedAlgorithmWithEra(ownerId, input.id);
  if (!found) return fail(404, 'Algorithm not found');
  const { doc, era } = found;

  const set: Record<string, any> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, MAX_NAME_CHARS) : '';
    if (!name) return fail(400, 'Algorithm name is required');
    set.name = name;
  }
  if (input.emoji !== undefined) {
    set.emoji = sanitizeEmoji(input.emoji);
  }

	let updatedDoc: FeedAlgorithmDoc | null = null;
	try {
		// Write to the store the doc actually lives in. Thing-era updates read a
		// before-image, debit its exact byte delta, then CAS the document in the
		// same transaction. Legacy writes are allowed only before the account
		// ledger becomes ready; after that, migration is mandatory.
  if (era === 'things') {
			const things = await getThingsCollection();
			await withHomeMongoTransaction(async (session) => {
				const before = await things.findOne({ shareId: doc.shareId, ownerId, thingtime: 'feed-algorithm' } as any, { session });
				if (!before) {
					throw new StorageMutationError(409, 'storage_conflict', 'Algorithm changed while it was being updated — try again');
				}
				const crystal = { ...(before.crystal || {}) };
				if (set.name !== undefined) crystal.name = set.name;
				if (set.emoji !== undefined) crystal.emoji = set.emoji;
				const extended = before.extended ?? null;
				const tags = Array.isArray(before.tags) ? before.tags : [];
				const sizeBytes = thingStorageSizeBytes({ crystal, extended, tags });
				const deltaBytes = sizeBytes - storedAlgorithmSizeBytes(before);
				if (deltaBytes !== 0) await applyUserStorageDelta(ownerId, deltaBytes, session);
				const write = await things.updateOne(
					{
						_id: before._id,
						ownerId,
						thingtime: 'feed-algorithm',
						...algorithmStorageCas(before)
					} as any,
					{
						$set: {
							crystal,
							extended,
							tags,
							schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
							storageClass: 'content',
							sizeBytes,
							storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
							updatedAt: set.updatedAt
						}
					},
					{ session }
    );
				if (write.matchedCount === 0) {
					throw new StorageMutationError(409, 'storage_conflict', 'Algorithm changed while it was being updated — try again');
				}
				updatedDoc = algorithmThingToDoc({
					...before,
					crystal,
					extended,
					tags,
					schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
					storageClass: 'content',
					sizeBytes,
					storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
					updatedAt: set.updatedAt
				});
			});
  } else {
			const things = await getThingsCollection();
			const algorithms = await getFeedAlgorithmsCollection();
			await withHomeMongoTransaction(async (session) => {
				await assertLegacyAlgorithmMutationAllowed(ownerId, things, session);
				const before = (await algorithms.findOne({ shareId: doc.shareId, ownerId } as any, { session })) as any as FeedAlgorithmDoc | null;
				if (!before) {
					throw new StorageMutationError(409, 'storage_conflict', 'Algorithm changed while it was being updated — try again');
				}
				const write = await algorithms.updateOne({ _id: before._id, ownerId, updatedAt: before.updatedAt } as any, { $set: set }, { session });
				if (write.matchedCount === 0) {
					throw new StorageMutationError(409, 'storage_conflict', 'Algorithm changed while it was being updated — try again');
				}
				updatedDoc = { ...before, ...set };
			});
		}
	} catch (error) {
		const projected = storageFail(error);
		if (projected) return projected;
		throw error;
  }
	return { ok: true, algorithm: await toPublicAlgorithm(updatedDoc || { ...doc, ...set }) };
};

export const deleteAlgorithm = async (ownerId: string, shareId: unknown): Promise<Fail | { ok: true }> => {
  if (typeof shareId !== 'string' || !shareId.trim()) return fail(400, 'Algorithm id is required');
  const id = shareId.trim();

	// Delete from BOTH stores. The Thing before-image and its account-ledger
	// refund commit together. If a ready account still has a legacy twin, stop
	// and require migration rather than mutating bytes outside the ledger.
  const things = await getThingsCollection();
	const algorithms = await getFeedAlgorithmsCollection();
	let deletedThing = false;
	let deletedLegacy = false;
	try {
		await withHomeMongoTransaction(async (session) => {
			const legacy = await algorithms.findOne({ shareId: id, ownerId } as any, { projection: { _id: 1 }, session });
			if (legacy) await assertLegacyAlgorithmMutationAllowed(ownerId, things, session);
			const before = await things.findOneAndDelete({ shareId: id, ownerId, thingtime: 'feed-algorithm' } as any, { session });
			const legacyRes = await algorithms.deleteOne({ shareId: id, ownerId } as any, { session });
			if (before) {
				const exactBytes = currentContentStorageSizeBytes(before);
				if (exactBytes === null) await markUserStorageNeedsReconcile(ownerId, session);
				else await applyUserStorageDelta(ownerId, -exactBytes, session);
			}
			deletedThing = !!before;
			deletedLegacy = legacyRes.deletedCount > 0;
		});
	} catch (error) {
		const projected = storageFail(error);
		if (projected) return projected;
		throw error;
	}
	if (!deletedThing && !deletedLegacy) return fail(404, 'Algorithm not found');

  // don't leave the owner's active algorithm dangling at a deleted id — the
  // users-store layout (secure blob, either era) is owned by auth/users
  await clearUserActiveFeedAlgorithm(String(ownerId), id);
  // orphaned branches keep working — parentId is lineage metadata, not a live link
  return { ok: true };
};

export const setActiveAlgorithm = async (ownerId: string, algorithmId: unknown): Promise<Fail | { ok: true; activeAlgorithmId: string | null }> => {
  if (algorithmId === null || algorithmId === undefined || algorithmId === '') {
    await setUserActiveFeedAlgorithm(ownerId, null);
    return { ok: true, activeAlgorithmId: null };
  }
  const doc = await findOwnedAlgorithm(ownerId, algorithmId);
  if (!doc) return fail(404, 'Algorithm not found');
  await setUserActiveFeedAlgorithm(ownerId, doc.shareId);
  return { ok: true, activeAlgorithmId: doc.shareId };
};

// Apply a batch of engagement events to the given (or active) algorithm.
// trained:false (still ok) when there's nothing to train — no active
// algorithm, or no visible referenced posts.
export const trackEngagement = async (
  ownerId: string,
  activeAlgorithmId: string | null,
  input: { algorithmId?: unknown; events?: unknown }
): Promise<Fail | { ok: true; trained: boolean; applied: number; eventCount?: number }> => {
  const events = sanitizeEvents(input.events);
  if (!events.length) {
    return fail(400, 'events are required');
  }

	const targetId = typeof input.algorithmId === 'string' && input.algorithmId.trim() ? input.algorithmId.trim() : activeAlgorithmId;
  if (!targetId) return { ok: true, trained: false, applied: 0 };

  const found = await findOwnedAlgorithmWithEra(ownerId, targetId);
  if (!found) return fail(404, 'Algorithm not found');
  const { doc, era } = found;

	const features = await getPostFeatures(
		ownerId,
		events.map((event) => event.thingId)
	);
  const now = new Date();
	let applied = 0;
	// Captured from the in-transaction before-image, not the pre-transaction
	// read above: a concurrent flush (second tab/device) commits between them,
	// and a stale total makes the client's before/after crossing check both
	// miss milestones and re-fire ones already celebrated.
	let eventCount = 0;
	try {
		// Weights replace as one object (never dotted per-tag keys), but the
		// before-image is read inside the transaction so concurrent training is
		// composed rather than lost. Its exact size delta shares the commit with
		// the account ledger.
  if (era === 'things') {
			const things = await getThingsCollection();
			await withHomeMongoTransaction(async (session) => {
				const before = await things.findOne({ shareId: doc.shareId, ownerId, thingtime: 'feed-algorithm' } as any, { session });
				if (!before) {
					throw new StorageMutationError(409, 'storage_conflict', 'Algorithm changed while it was being trained — try again');
				}
				const trained = applyEventsToWeights(before.crystal?.weights || emptyWeights(), events, features);
				if (!trained.applied) {
					applied = 0;
					eventCount = Math.max(0, Number(before.crystal?.eventCount || 0));
					return;
				}
				const crystal = {
					...(before.crystal || {}),
					weights: trained.weights,
					eventCount: Math.max(0, Number(before.crystal?.eventCount || 0)) + trained.applied,
					lastTrainedAt: now
				};
				const extended = before.extended ?? null;
				const tags = Array.isArray(before.tags) ? before.tags : [];
				const sizeBytes = thingStorageSizeBytes({ crystal, extended, tags });
				const deltaBytes = sizeBytes - storedAlgorithmSizeBytes(before);
				if (deltaBytes !== 0) await applyUserStorageDelta(ownerId, deltaBytes, session);
				const write = await things.updateOne(
					{
						_id: before._id,
						ownerId,
						thingtime: 'feed-algorithm',
						...algorithmStorageCas(before)
					} as any,
      {
						$set: {
							crystal,
							extended,
							tags,
							schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
							storageClass: 'content',
							sizeBytes,
							storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
							updatedAt: now
						}
					},
					{ session }
    );
				if (write.matchedCount === 0) {
					throw new StorageMutationError(409, 'storage_conflict', 'Algorithm changed while it was being trained — try again');
				}
				applied = trained.applied;
				eventCount = crystal.eventCount;
			});
  } else {
			const things = await getThingsCollection();
			const algorithms = await getFeedAlgorithmsCollection();
			await withHomeMongoTransaction(async (session) => {
				await assertLegacyAlgorithmMutationAllowed(ownerId, things, session);
				const before = (await algorithms.findOne({ shareId: doc.shareId, ownerId } as any, { session })) as any as FeedAlgorithmDoc | null;
				if (!before) {
					throw new StorageMutationError(409, 'storage_conflict', 'Algorithm changed while it was being trained — try again');
				}
				const trained = applyEventsToWeights(before.weights || emptyWeights(), events, features);
				if (!trained.applied) {
					applied = 0;
					eventCount = Math.max(0, Number(before.eventCount || 0));
					return;
				}
				const write = await algorithms.updateOne(
					{ _id: before._id, ownerId, updatedAt: before.updatedAt } as any,
      {
        $set: { weights: trained.weights, lastTrainedAt: now, updatedAt: now },
        $inc: { eventCount: trained.applied }
					} as any,
					{ session }
    );
				if (write.matchedCount === 0) {
					throw new StorageMutationError(409, 'storage_conflict', 'Algorithm changed while it was being trained — try again');
				}
				applied = trained.applied;
				eventCount = Math.max(0, Number(before.eventCount || 0)) + trained.applied;
			});
		}
	} catch (error) {
		const projected = storageFail(error);
		if (projected) return projected;
		throw error;
  }
	// authoritative post-flush total so clients can detect growth-stage
	// crossings (🥚→🐣→🐥→🧠) without double-counting session events
	return { ok: true, trained: applied > 0, applied, eventCount };
};
