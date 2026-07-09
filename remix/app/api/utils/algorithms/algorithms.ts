import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';

import { ensureIndexes, getFeedAlgorithmsCollection, getUsersCollection } from '../mongodb/collections';
import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { setUserActiveFeedAlgorithm } from '../auth/users';
import {
  applyEventsToWeights,
  emptyWeights,
  topInterests,
  type AlgorithmWeights,
  type EngagementEvent
} from '../things/feedRanking';
import { getPostFeatures } from '../things/things';

// Personal feed algorithms (thingtime.feedAlgorithms): named, branchable
// interest-weight profiles trained by doomscroll engagement. A user can keep
// many and switch the active one (users.meta.activeFeedAlgorithmId).

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

// Resolve author-interest userIds to usernames (one batched query across any
// number of algorithms) so the UI can show "@rick" instead of a Mongo id.
const resolveAuthorUsernames = async (ids: string[]): Promise<Map<string, string>> => {
  const valid = [...new Set(ids)].filter((id) => ObjectId.isValid(id));
  if (!valid.length) return new Map();
  const users = await getUsersCollection();
  const docs = await users
    .find({ _id: { $in: valid.map((id) => new ObjectId(id)) } })
    .project({ username: 1 })
    .toArray();
  return new Map(docs.map((doc: any) => [String(doc._id), doc.username]));
};

const projectAlgorithm = (
  doc: FeedAlgorithmDoc,
  usernames: Map<string, string>
): PublicAlgorithm => ({
  id: doc.shareId,
  name: doc.name,
  emoji: doc.emoji || DEFAULT_EMOJI,
  parentId: doc.parentId || null,
  eventCount: doc.eventCount || 0,
  lastTrainedAt: doc.lastTrainedAt ? new Date(doc.lastTrainedAt).toISOString() : null,
  createdAt: new Date(doc.createdAt).toISOString(),
  updatedAt: new Date(doc.updatedAt).toISOString(),
  topInterests: topInterests(doc.weights || emptyWeights()).map((entry) =>
    entry.kind === 'author' && usernames.has(entry.key)
      ? { ...entry, label: `@${usernames.get(entry.key)}` }
      : entry
  )
});

export const toPublicAlgorithm = async (doc: FeedAlgorithmDoc): Promise<PublicAlgorithm> => {
  const interests = topInterests(doc.weights || emptyWeights());
  const usernames = await resolveAuthorUsernames(
    interests.filter((entry) => entry.kind === 'author').map((entry) => entry.key)
  );
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

const findOwnedAlgorithm = async (ownerId: string, shareId: unknown): Promise<FeedAlgorithmDoc | null> => {
  if (typeof shareId !== 'string' || !shareId.trim()) return null;
  const algorithms = await getFeedAlgorithmsCollection();
  return (await algorithms.findOne({ shareId: shareId.trim(), ownerId } as any)) as any as FeedAlgorithmDoc | null;
};

export const listAlgorithmsForUser = async (ownerId: string): Promise<PublicAlgorithm[]> => {
  const algorithms = await getFeedAlgorithmsCollection();
  const docs = (await algorithms
    .find({ ownerId })
    .sort({ createdAt: 1 })
    .limit(MAX_ALGORITHMS_PER_USER)
    .toArray()) as any as FeedAlgorithmDoc[];

  const interestsByDoc = docs.map((doc) => topInterests(doc.weights || emptyWeights()));
  const usernames = await resolveAuthorUsernames(
    interestsByDoc.flat().filter((entry) => entry.kind === 'author').map((entry) => entry.key)
  );
  return docs.map((doc) => projectAlgorithm(doc, usernames));
};

export const getOwnedAlgorithmWeights = async (
  ownerId: string,
  shareId: string
): Promise<AlgorithmWeights | null> => {
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
export const createAlgorithm = async (
  ownerId: string,
  input: CreateAlgorithmInput
): Promise<Fail | { ok: true; algorithm: PublicAlgorithm }> => {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, MAX_NAME_CHARS) : '';
  if (!name) return fail(400, 'Algorithm name is required');

  await ensureIndexes();
  const algorithms = await getFeedAlgorithmsCollection();
  const count = await algorithms.countDocuments({ ownerId });
  if (count >= MAX_ALGORITHMS_PER_USER) {
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
    const features = await getPostFeatures(ownerId, seedEvents.map((event) => event.thingId));
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
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.feedAlgorithms,
    createdAt: now,
    updatedAt: now
  };
  await algorithms.insertOne(doc as any);
  return { ok: true, algorithm: await toPublicAlgorithm(doc) };
};

export const updateAlgorithm = async (
  ownerId: string,
  input: { id?: unknown; name?: unknown; emoji?: unknown }
): Promise<Fail | { ok: true; algorithm: PublicAlgorithm }> => {
  const doc = await findOwnedAlgorithm(ownerId, input.id);
  if (!doc) return fail(404, 'Algorithm not found');

  const set: Record<string, any> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, MAX_NAME_CHARS) : '';
    if (!name) return fail(400, 'Algorithm name is required');
    set.name = name;
  }
  if (input.emoji !== undefined) {
    set.emoji = sanitizeEmoji(input.emoji);
  }

  const algorithms = await getFeedAlgorithmsCollection();
  await algorithms.updateOne({ shareId: doc.shareId, ownerId } as any, { $set: set });
  return { ok: true, algorithm: await toPublicAlgorithm({ ...doc, ...set }) };
};

export const deleteAlgorithm = async (ownerId: string, shareId: unknown): Promise<Fail | { ok: true }> => {
  if (typeof shareId !== 'string' || !shareId.trim()) return fail(400, 'Algorithm id is required');
  const id = shareId.trim();
  const algorithms = await getFeedAlgorithmsCollection();
  const res = await algorithms.deleteOne({ shareId: id, ownerId } as any);
  if (!res.deletedCount) return fail(404, 'Algorithm not found');

  // don't leave the owner's active algorithm dangling at a deleted id
  await (await getUsersCollection()).updateOne(
    { _id: new ObjectId(ownerId), 'meta.activeFeedAlgorithmId': id },
    { $set: { 'meta.activeFeedAlgorithmId': null, updatedAt: new Date() } }
  );
  // orphaned branches keep working — parentId is lineage metadata, not a live link
  return { ok: true };
};

export const setActiveAlgorithm = async (
  ownerId: string,
  algorithmId: unknown
): Promise<Fail | { ok: true; activeAlgorithmId: string | null }> => {
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
): Promise<Fail | { ok: true; trained: boolean; applied: number }> => {
  const events = sanitizeEvents(input.events);
  if (!events.length) {
    return fail(400, 'events are required');
  }

  const targetId =
    typeof input.algorithmId === 'string' && input.algorithmId.trim() ? input.algorithmId.trim() : activeAlgorithmId;
  if (!targetId) return { ok: true, trained: false, applied: 0 };

  const doc = await findOwnedAlgorithm(ownerId, targetId);
  if (!doc) return fail(404, 'Algorithm not found');

  const features = await getPostFeatures(ownerId, events.map((event) => event.thingId));
  const trained = applyEventsToWeights(doc.weights || emptyWeights(), events, features);
  if (!trained.applied) return { ok: true, trained: false, applied: 0 };

  const now = new Date();
  const algorithms = await getFeedAlgorithmsCollection();
  await algorithms.updateOne(
    { shareId: doc.shareId, ownerId } as any,
    {
      $set: { weights: trained.weights, lastTrainedAt: now, updatedAt: now },
      $inc: { eventCount: trained.applied }
    } as any
  );
  return { ok: true, trained: true, applied: trained.applied };
};
