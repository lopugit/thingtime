import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { ensureIndexes, getAdoptionIssues, getCollection, getSettingsCollection, getThingtimeDb, withMongoTransaction } from '../mongodb/collections';
import { COLLECTIONS, classifyPhysicalCollections, collectionVersion, physicalCollectionName } from '../mongodb/collectionNames';
import { safeErrorText } from '../errors/safeError';
import {
	appStorageCounterCrystalIsReady,
	appStorageCounterEnvelopeIsTrusted,
	appStorageCounterShareId,
	appThingSizeBytes,
	convertHistoricalAppStorageCounter,
	initializeAppStorageAccounting,
	reconcileAppStorage,
	reconcileOrphanAppStorage,
	setAppStorageUsed
} from '../apps/namespace';
import type { AppNamespaceScope } from '../apps/namespace';
import { appStoragePolicyOf } from '../apps/apps';
import { reactionShareId, validateLegacyInteractionResidue } from '../things/things';
import { SERVICE_QUOTA_THINGTIME, buildConservativeLegacyServiceQuotaThing, classifyLegacyServiceQuotaThing } from '../things/quota';
import {
	buildUserSecure,
	findLegacyUserStorageFieldsByIds,
	packRecentReactions,
	profileAttachmentRefsForUserRoot,
	removeLegacyUserStorageFields,
	toBin,
	userEmailKey,
	userUsernameKey
} from '../auth/users';
import { waitlistEmailKey } from '../waitlist/waitlist';
import { RELATIONSHIP_UNIQUE_CRYSTAL_KEYS, relationshipUniqueKeys } from '../messenger/shared';
import { themeAcl } from '../themes/themes';
import { builtinSchemaSeedNeedsRefresh, exactDocumentSnapshotMatch, storageMigrationOwnership } from './migrationCore';
import { MigrationOperatorError, migrationFailureResult, type MigrationFailure } from './migrationFailure';
import { getSubscription } from '../subscriptions/subscriptions';
import {
	legacyUserSubscriptionLedgerEnvelopeCanUpgrade,
	legacyUserSubscriptionLedgerMatch,
	subscriptionThingMatch,
	userSubscriptionLedgerEnvelopeIsTrusted,
	userSubscriptionLedgerMatch
} from '../subscriptions/subscriptionIdentity';
import { USER_STORAGE_ACCOUNTING_VERSION, USER_STORAGE_STATUS, storageSandboxState, thingStorageSizeBytes } from '../storage/storageCore';
import { reconcileUserStorage, userStorageAllowanceIsValid } from '../storage/userStorage';
import {
  ACL_ALL,
  ACL_INHERIT,
  ACL_OWNER,
  APP_STORAGE_ACCOUNTING_VERSION,
	APP_STORAGE_RESERVED_ID_PREFIX,
  COLLECTION_SCHEMA_VERSIONS,
  LEGACY_SCHEMA_VERSION,
	USER_STORAGE_LEDGER_ENVELOPE_VERSION,
  aclFromVisibility,
  projectBuiltinSchemaCrystal,
  thingtimeSchemas,
  validateThingtimeCrystal
} from '~/schemas/registry';

// Admin-run database schema-version migrations. Every collection stores the
// root-level schemaVersion each doc was written at (docs without one predate
// versioning and count as version 1). Migrations are registered here, listed
// via GET /api/v1/admin/migrations, and run (or dry-run) via
// POST /api/v1/admin/migrations/run — always through the API, never ad-hoc
// scripts, so test == live == direct API (FUNDAMENTALS §2).
//
// Every migration is IDEMPOTENT: re-running after a partial failure only
// touches what's left (doc-splitting inserts use deterministic ids that the
// unique shareId index dedupes).

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

// Both the pending census and the real backfill must pass the complete stored
// attachment envelope to thingStorageSizeBytes(). Projecting only the ordinary
// Thing payload makes a legitimate attachment indistinguishable from a forged
// attachment claim and correctly trips the fail-closed envelope validator.
export const USER_STORAGE_ACCOUNTING_MIGRATION_PROJECTION = {
	_id: 1,
	schemaVersion: 1,
	ownerId: 1,
	shareId: 1,
	thingtime: 1,
	crystal: 1,
	extended: 1,
	tags: 1,
	storageClass: 1,
	sandboxExpiresAt: 1,
	sizeBytes: 1,
	storageAccountingVersion: 1,
	updatedAt: 1,
	attachmentEnvelopeVersion: 1,
	attachmentState: 1,
	objectSizeBytes: 1,
	objectKey: 1,
	objectVersionId: 1,
	attachmentRequestFingerprint: 1,
	attachmentPurpose: 1,
	attachmentProfileSlot: 1,
	attachmentFinalizationLeaseId: 1,
	attachmentPartsIssuedAt: 1,
	attachmentObjectlessDelete: 1,
	attachmentMpuEmptyVerifiedAt: 1,
	uploadId: 1,
	attachmentExpiresAt: 1,
	attachmentLinked: 1
} as const;

export type MigrationReport = {
  dryRun: boolean;
  matched: number;
  migrated: number;
  created: number;
  skipped: number;
  notes: string[];
};

export type Migration = {
  id: string;
  collection: string;
  fromVersion: number;
  toVersion: number;
  title: string;
  description: string;
  // drops data (cleanup migrations): the run endpoint requires an explicit
  // confirm flag and the panel badges it
  destructive?: boolean;
  // physical collections this migration still READS from — the cleanup
  // migration refuses to drop any collection a pending migration lists here
  sourcePhysicals?: () => string[];
  pending: () => Promise<number>;
	run: (options: { dryRun: boolean; assertLease?: () => Promise<void> }) => Promise<MigrationReport>;
};

// Every real migration shares one durable lease. Storage accounting composes
// several source-shape migrations and then publishes hot ledgers, so allowing
// either another copy of that orchestration or a directly-invoked prerequisite
// to overlap can certify a stale snapshot. The settings key is unique and the
// lease token is a fencing epoch: only its holder can renew or release it.
//
// Fifteen minutes is deliberately longer than the platform request lifetime;
// the heartbeat normally renews every 30 seconds. A crashed invocation becomes
// recoverable, while a live invocation cannot be overtaken merely because one
// batch or transaction is slow.
const MIGRATION_LEASE_KEY = 'admin-migrations:global';
const MIGRATION_LEASE_MS = 15 * 60 * 1000;
const MIGRATION_HEARTBEAT_MS = 30 * 1000;

type MigrationLease = {
	token: string;
	assert: () => Promise<void>;
	release: () => Promise<void>;
};

const acquireMigrationLease = async (migrationId: string): Promise<MigrationLease | null> => {
	await ensureIndexes();
	const settings = await getSettingsCollection();
	const token = randomUUID();
	const now = new Date();
	try {
		const lock = await settings.findOneAndUpdate(
			{
				key: MIGRATION_LEASE_KEY,
				$or: [{ lockExpiresAt: { $exists: false } }, { lockExpiresAt: { $lte: now } }]
			},
			{
				$set: {
					lockToken: token,
					lockMigrationId: migrationId,
					lockExpiresAt: new Date(now.getTime() + MIGRATION_LEASE_MS),
					updatedAt: now
				},
				$setOnInsert: {
					key: MIGRATION_LEASE_KEY,
					schemaVersion: COLLECTION_SCHEMA_VERSIONS.settings,
					createdAt: now
				}
			},
			{ upsert: true, returnDocument: 'after' }
		);
		if (lock?.lockToken !== token) return null;
	} catch (error: any) {
		if (error?.code === 11000) return null;
		throw error;
	}

	let lost = false;
	let renewal = Promise.resolve();
	const renew = async (): Promise<void> => {
		if (lost) throw new MigrationOperatorError('lease_lost');
		const at = new Date();
		const result = await settings.updateOne(
			{
				key: MIGRATION_LEASE_KEY,
				lockToken: token,
				lockExpiresAt: { $gt: at }
			},
			{
				$set: {
					lockExpiresAt: new Date(at.getTime() + MIGRATION_LEASE_MS),
					updatedAt: at
				}
			}
		);
		if (result.matchedCount !== 1) {
			lost = true;
			throw new MigrationOperatorError('lease_lost');
		}
	};
	const heartbeat = setInterval(() => {
		renewal = renewal.then(renew).catch(() => {
			lost = true;
		});
	}, MIGRATION_HEARTBEAT_MS);
	heartbeat.unref?.();

	return {
		token,
		assert: async () => {
			await renewal;
			await renew();
		},
		release: async () => {
			clearInterval(heartbeat);
			await renewal.catch(() => {});
			try {
				await settings.updateOne(
					{ key: MIGRATION_LEASE_KEY, lockToken: token },
					{
						$unset: { lockToken: '', lockMigrationId: '', lockExpiresAt: '' },
						$set: { updatedAt: new Date() }
					}
				);
			} catch {
				// Token matching prevents releasing a successor. Expiry is the durable
				// fallback, so successful migration work is not turned into a 500 by
				// best-effort lock cleanup.
			}
		}
	};
};

const versionFilter = (fromVersion: number) =>
  fromVersion === LEGACY_SCHEMA_VERSION
    ? { $or: [{ schemaVersion: { $exists: false } }, { schemaVersion: { $lt: fromVersion + 1 } }] }
    : { schemaVersion: fromVersion };

// Most collections migrate v1→v2 by stamping the schemaVersion they already
// conform to — the doc shape didn't change, only the versioning era began.
const stampMigration = (collection: string, description: string): Migration => {
  const toVersion = COLLECTION_SCHEMA_VERSIONS[collection];
  const filter = versionFilter(LEGACY_SCHEMA_VERSION);
  return {
    id: `${collection}-v1-to-v${toVersion}`,
    collection,
    fromVersion: LEGACY_SCHEMA_VERSION,
    toVersion,
    title: `Stamp ${collection} schemaVersion ${toVersion}`,
    description,
    pending: async () => {
      return (await getCollection(collection)).countDocuments(filter);
    },
    run: async ({ dryRun }) => {
      const target = await getCollection(collection);
      const matched = await target.countDocuments(filter);
      if (dryRun) return { dryRun, matched, migrated: 0, created: 0, skipped: 0, notes: [] };
      const result = await target.updateMany(filter, { $set: { schemaVersion: toVersion } });
      return { dryRun, matched, migrated: result.modifiedCount, created: 0, skipped: 0, notes: [] };
    }
  };
};

// ---------------------------------------------------------------------------
// things v1 → v2: the unified-thing migration. v1 posts carry crystal fields
// at the root, comments EMBEDDED as an array, reactions EMBEDDED as an
// emoji → userId[] map, and shares as posts with shareOfId. v2 explodes the
// residue into standalone comment/reaction things and moves the payload under
// crystal (see app/schemas/registry.ts and api/utils/things/things.ts).

const THINGS_VERSION = COLLECTION_SCHEMA_VERSIONS.things;
const THINGS_BATCH = 200;

const legacyPostFilter = {
  kind: 'post',
  $or: [{ schemaVersion: { $exists: false } }, { schemaVersion: { $lt: THINGS_VERSION } }]
};

// Some in-place v2 upgrades deliberately left embedded interaction residue
// for the lazy reader to preserve. Storage accounting must migrate that
// residue before stamping the parent, regardless of the parent's schemaVersion
// — otherwise the parent can become authoritative while its children remain
// permanently stranded behind the new fail-closed writer guard.
const embeddedInteractionResidueFilter = {
	$and: [{ $or: [{ kind: 'post' }, { thingtime: 'post' }] }, { $or: [{ comments: { $exists: true } }, { reactions: { $exists: true } }] }]
};
const thingsMigrationPostFilter = { $or: [legacyPostFilter, embeddedInteractionResidueFilter] };

const validMigrationDate = (value: unknown): boolean => {
	const timestamp = value instanceof Date ? value.getTime() : new Date(value as any).getTime();
	return Number.isFinite(timestamp);
};

const interactionPlan = (doc: any) => validateLegacyInteractionResidue(doc);

// Mongo adds only `_id`; every other root/nested key must be exactly the
// server-built child envelope. Matching a subset of fields would let an
// unrelated or user-shaped Thing squat a deterministic migration id and have
// the embedded source erased as though the conversion had succeeded.
const exactInteractionTwin = (actual: any, expected: Record<string, unknown>): boolean => {
	if (!actual || typeof actual !== 'object') return false;
	const withoutMongoId = Object.fromEntries(Object.entries(actual).filter(([key]) => key !== '_id'));
	return isDeepStrictEqual(withoutMongoId, expected);
};

class InteractionMigrationCollision extends Error {
	constructor(readonly destinationId: string) {
		super(`interaction destination ${destinationId} is occupied by a noncanonical Thing`);
		this.name = 'InteractionMigrationCollision';
	}
}

const buildLegacyRelationalDestination = (doc: any): Record<string, unknown> | null => {
	if (
		(doc?.kind !== 'reaction' && doc?.kind !== 'comment') ||
		typeof doc?.ownerId !== 'string' ||
		!doc.ownerId ||
		typeof doc?.parentId !== 'string' ||
		!doc.parentId ||
		!validMigrationDate(doc.createdAt)
	) {
		return null;
	}
	const createdAt = new Date(doc.createdAt);
	if (doc.kind === 'reaction' && (typeof doc.token !== 'string' || !doc.token)) return null;
	if (doc.kind === 'comment' && typeof doc.text !== 'string') return null;
	const shareId = doc.kind === 'reaction' ? reactionShareId(doc.parentId, doc.ownerId, doc.token) : String(doc.commentId || doc._id || '');
	if (!shareId) return null;
	return {
		shareId,
		schemaVersion: THINGS_VERSION,
		thingtime: [doc.kind],
		crystal: doc.kind === 'reaction' ? { emoji: doc.token } : { text: doc.text },
		ownerId: doc.ownerId,
		acl: [ACL_INHERIT],
		targetId: doc.parentId,
		tags: [],
		createdAt,
		updatedAt: createdAt
	};
};

// interim relational era: kind:'reaction'/'comment' docs linked by parentId,
// written by the pre-unification relational model
const legacyRelationalFilter = { kind: { $in: ['reaction', 'comment'] } };

const thingsMigration: Migration = {
  id: `things-v1-to-v${THINGS_VERSION}`,
  collection: 'things',
  fromVersion: LEGACY_SCHEMA_VERSION,
  toVersion: THINGS_VERSION,
  title: 'Unify posts, comments, reactions, and shares as things',
  description:
    'Explodes embedded comments and reactions into standalone comment/reaction things ' +
    '(comment ids are preserved as thing shareIds; reaction things get deterministic ids so ' +
    're-runs are idempotent), converts interim relational kind:"reaction"/"comment" docs to ' +
    'thingtime things, converts share posts to thingtime ["post","share"] with targetId, moves ' +
    'post payloads under crystal, and stamps schemaVersion. Stray non-post docs in the things ' +
    'collection (legacy prototypes) are left untouched and reported.',
  pending: async () => {
    const things = await getCollection('things');
		const [posts, relational] = await Promise.all([things.countDocuments(thingsMigrationPostFilter), things.countDocuments(legacyRelationalFilter)]);
    return posts + relational;
  },
	run: async ({ dryRun, assertLease }) => {
    await ensureIndexes();
    const things = await getCollection('things');

		const [matched, relationalMatched] = await Promise.all([
			things.countDocuments(thingsMigrationPostFilter),
			things.countDocuments(legacyRelationalFilter)
		]);
    // anything unversioned that is not a v1 post: legacy prototype docs and
    // other experiments (e.g. kind:'record') deliberately stay untouched
    const strays = await things.countDocuments({
      $or: [{ schemaVersion: { $exists: false } }, { schemaVersion: { $lt: THINGS_VERSION } }],
      // kind:'reaction'/'comment' docs are converted (not strays)
      kind: { $nin: ['post', 'reaction', 'comment'] },
      thingtime: { $exists: false }
    });
    const notes: string[] = [];
    if (strays) notes.push(`${strays} stray non-post doc(s) in things left untouched`);

    let migrated = 0;
    let created = 0;
    let skipped = 0;

    if (dryRun) {
			// JS validation mirrors the real run and cannot throw Mongo expression
			// errors merely because a residue field is malformed.
			let wouldCreate = 0;
			let malformed = 0;
			const cursor = things.find(thingsMigrationPostFilter as any);
			for await (const doc of cursor) {
				const plan = interactionPlan(doc);
				if (!plan.ok) {
					malformed += 1;
					continue;
            }
				wouldCreate += plan.comments.length + plan.reactions.length;
          }
      notes.push(`${wouldCreate} standalone comment/reaction thing(s) would be created`);
			if (malformed) notes.push(`${malformed} post(s) have malformed embedded interaction residue and would remain pending`);
			if (relationalMatched) notes.push(`${relationalMatched} interim relational kind doc(s) would be converted`);
			return { dryRun, matched: matched + relationalMatched, migrated: 0, created: 0, skipped: 0, notes };
    }

    // batch through matching docs; re-runs only see still-unmigrated posts.
    // Collided posts are left at v1 and would re-match forever, so exclude the
    // ones we've already skipped this run from later batches.
    const skippedPostIds: any[] = [];
    for (;;) {
			await assertLease?.();
      const batchFilter = skippedPostIds.length
				? { $and: [thingsMigrationPostFilter, { _id: { $nin: skippedPostIds } }] }
				: thingsMigrationPostFilter;
			const batch = (await things
				.find(batchFilter as any)
				.limit(THINGS_BATCH)
				.toArray()) as any[];
      if (!batch.length) break;

      for (const doc of batch) {
				await assertLease?.();
				try {
					const outcome = await withMongoTransaction(async (session) => {
						const fresh = (await things.findOne({ _id: doc._id } as any, { session })) as any;
						if (!fresh) return { kind: 'gone' as const, created: 0 };

						const hasComments = Object.prototype.hasOwnProperty.call(fresh, 'comments');
						const hasReactions = Object.prototype.hasOwnProperty.call(fresh, 'reactions');
						const isLegacyParent =
							fresh.kind === 'post' && (!Number.isSafeInteger(fresh.schemaVersion) || Number(fresh.schemaVersion) < THINGS_VERSION);
						if (!hasComments && !hasReactions && !isLegacyParent) {
							return { kind: 'gone' as const, created: 0 };
						}

						const plan = interactionPlan(fresh);
						if (plan.ok === false) return { kind: 'malformed' as const, created: 0, reason: plan.reason };

						const children: Record<string, unknown>[] = [
							...plan.reactions.map((reaction) => ({
								shareId: reaction.shareId,
            schemaVersion: THINGS_VERSION,
								thingtime: ['reaction'],
								crystal: { emoji: reaction.emoji },
								ownerId: reaction.ownerId,
            acl: [ACL_INHERIT],
								targetId: fresh.shareId,
            tags: [],
								createdAt: reaction.createdAt,
								updatedAt: reaction.createdAt
							})),
							...plan.comments.map((comment) => ({
								shareId: comment.shareId,
              schemaVersion: THINGS_VERSION,
								thingtime: ['comment'],
								crystal: { text: comment.text },
								ownerId: comment.ownerId,
              acl: [ACL_INHERIT],
								targetId: fresh.shareId,
              tags: [],
								createdAt: comment.createdAt,
								updatedAt: comment.createdAt
							}))
						];

						// Claim/convert the parent first. The source clear and every child
						// insert share one snapshot transaction, so a collision or crash
						// automatically restores the embedded source and a concurrent
						// parent writer becomes a write conflict rather than lost data.
						const currentEnvelope = fresh.schemaVersion === THINGS_VERSION && Array.isArray(fresh.thingtime) && fresh.thingtime.includes('post');
						const claim = await things.updateOne(
          {
								_id: fresh._id,
								...(Object.prototype.hasOwnProperty.call(fresh, 'updatedAt') ? { updatedAt: fresh.updatedAt } : { updatedAt: { $exists: false } }),
								...(hasComments ? { comments: fresh.comments } : { comments: { $exists: false } }),
								...(hasReactions ? { reactions: fresh.reactions } : { reactions: { $exists: false } })
							} as any,
							{
								$set: currentEnvelope
									? { schemaVersion: THINGS_VERSION }
									: {
              schemaVersion: THINGS_VERSION,
											thingtime: fresh.shareOfId ? ['post', 'share'] : ['post'],
              crystal: {
												type: fresh.type || 'text',
												text: fresh.text || '',
												images: fresh.images || [],
												listing: fresh.listing || null
              },
											targetId: fresh.shareOfId || null,
											tags: fresh.tags || [],
											acl: aclFromVisibility(fresh.visibility) || [ACL_OWNER]
            },
            $unset: {
									comments: '',
									reactions: '',
									...(currentEnvelope
										? {}
										: {
              kind: '',
              type: '',
              text: '',
              images: '',
              listing: '',
              shareOfId: '',
              shareCount: '',
              visibility: ''
											})
            }
							},
							{ session }
        );
						if (claim.matchedCount !== 1) return { kind: 'race' as const, created: 0 };

						let inserted = 0;
						for (const expected of children) {
							const twin = await things.findOne({ shareId: expected.shareId } as any, { session });
							if (twin) {
								if (!exactInteractionTwin(twin, expected)) {
									throw new InteractionMigrationCollision(String(expected.shareId));
								}
								continue;
							}
							await things.insertOne(expected as any, { session });
							inserted += 1;
						}
						return { kind: 'migrated' as const, created: inserted };
					});

					if (outcome.kind === 'migrated') {
        migrated += 1;
						created += outcome.created;
					} else if (outcome.kind === 'malformed') {
						notes.push(`post ${String(doc.shareId || doc._id)}: malformed embedded interactions (${outcome.reason}) — left for repair`);
						skipped += 1;
						skippedPostIds.push(doc._id);
					} else if (outcome.kind === 'race') {
						notes.push(`post ${String(doc.shareId || doc._id)}: changed concurrently — left for a later re-run`);
						skipped += 1;
						skippedPostIds.push(doc._id);
					}
				} catch (error: any) {
					const duplicate =
						error?.code === 11000 || (Array.isArray(error?.writeErrors) && error.writeErrors.some((entry: any) => entry?.code === 11000));
					if (!(error instanceof InteractionMigrationCollision) && !duplicate) throw error;
					notes.push(`post ${String(doc.shareId || doc._id)}: interaction id collision — transaction rolled back, source kept`);
					skipped += 1;
					skippedPostIds.push(doc._id);
				}
      }
    }

    // convert interim relational kind:'reaction'/'comment' docs (written by the
    // pre-unification relational model) into v2 things, then remove them —
    // deterministic/stable ids make re-runs and races idempotent
    let converted = 0;
    const skippedRelationalIds: any[] = [];
    for (;;) {
			await assertLease?.();
      const relFilter = skippedRelationalIds.length
        ? { $and: [legacyRelationalFilter, { _id: { $nin: skippedRelationalIds } }] }
        : legacyRelationalFilter;
			const batch = (await things
				.find(relFilter as any)
				.limit(THINGS_BATCH)
				.toArray()) as any[];
      if (!batch.length) break;
      for (const doc of batch) {
				await assertLease?.();
				try {
					const outcome = await withMongoTransaction(async (session) => {
						const fresh = (await things.findOne({ _id: doc._id, kind: { $in: ['reaction', 'comment'] } } as any, {
							session
						})) as any;
						if (!fresh) return { kind: 'gone' as const, created: 0, shareId: '' };
						const expected = buildLegacyRelationalDestination(fresh);
						if (!expected) return { kind: 'malformed' as const, created: 0, shareId: String(fresh._id) };

						const twin = await things.findOne({ shareId: expected.shareId } as any, { session });
						let inserted = 0;
						if (twin) {
							if (!exactInteractionTwin(twin, expected)) {
								throw new InteractionMigrationCollision(String(expected.shareId));
            }
        } else {
							await things.insertOne(expected as any, { session });
							inserted = 1;
						}

						// The source delete participates in the same transaction as the
						// exact destination check/insert. A concurrent edit/delete becomes
						// a transaction conflict; no partial copy can commit.
						const removed = await things.deleteOne({ _id: fresh._id, kind: fresh.kind } as any, { session });
						if (removed.deletedCount !== 1) {
							throw new MigrationOperatorError('legacy_source_changed');
						}
						return { kind: 'converted' as const, created: inserted, shareId: String(expected.shareId) };
					});

					if (outcome.kind === 'converted') {
						converted += 1;
						created += outcome.created;
					} else if (outcome.kind === 'malformed') {
						notes.push(`relational ${doc.kind} ${outcome.shareId}: malformed source — kept for repair`);
						skipped += 1;
						skippedRelationalIds.push(doc._id);
					}
				} catch (error: any) {
					const duplicate =
						error?.code === 11000 || (Array.isArray(error?.writeErrors) && error.writeErrors.some((entry: any) => entry?.code === 11000));
					if (!(error instanceof InteractionMigrationCollision) && !duplicate) throw error;
					notes.push(`relational ${doc.kind} ${String(doc.commentId || doc._id)}: id collision — transaction rolled back, source kept`);
          skipped += 1;
          skippedRelationalIds.push(doc._id);
        }
      }
    }
    if (converted) notes.push(`${converted} interim relational kind doc(s) converted to things`);

		return { dryRun, matched: matched + relationalMatched, migrated: migrated + converted, created, skipped, notes };
  }
};

// ---------------------------------------------------------------------------
// Collection → things migrations (everything is a thing —
// TODO/claude-todo/22-everything-is-a-thing-collections.md).
// users, themes, feedAlgorithms, and waitlist collapse into the things
// collection. The destination shapes are EXACTLY what the new-write paths
// produce (auth/users insertUser, themes saveTheme, algorithms
// createAlgorithm, waitlist joinWaitlist) so migrated docs and things-era
// docs are indistinguishable to every dual-era read. Deterministic
// destination ids (preserved shareIds; the legacy users._id hex string) plus
// the unique shareId/uniqueKeys indexes make re-runs idempotent, and a legacy
// source doc is deleted only after its destination is verified genuinely ours
// (the thingsMigration relational convention) — a foreign doc squatting a
// destination id can never hijack or destroy legacy data: the doc is skipped,
// noted, and retried on a later run once the collision is resolved (dual-era
// reads keep serving the legacy doc meanwhile).

const CONVERT_BATCH = 200;
// per-doc collision/error notes are useful, but a pathological collection
// must not produce a multi-MB report through json() and the admin toast
const MAX_MIGRATION_NOTES = 25;

const makeNotes = () => {
  const notes: string[] = [];
  let overflow = 0;
  return {
    push: (note: string) => {
      if (notes.length < MAX_MIGRATION_NOTES) notes.push(note);
      else overflow += 1;
    },
    list: () => (overflow ? [...notes, `…plus ${overflow} more note(s) truncated`] : notes)
  };
};

type BuiltThing = { ok: true; thing: Record<string, any> } | { ok: false; reason: string };

const stableMigrationValue = (value: any): any => {
	if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
	if (typeof value === 'bigint') return value.toString();
	if (value instanceof Date) return { $date: value.toISOString() };
	if (Array.isArray(value)) return value.map(stableMigrationValue);
	if (value && typeof value.toJSON === 'function') {
		const json = value.toJSON();
		if (json !== value) return stableMigrationValue(json);
	}
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, stableMigrationValue(value[key])])
		);
	}
	return String(value);
};

const migrationSourceDigest = (doc: any): string =>
	createHash('sha256')
		.update(JSON.stringify(stableMigrationValue(doc)))
		.digest('hex');

const migrationReceiptKey = (collection: string, sourceId: unknown): string =>
	`migration-conversion:${collection}:${createHash('sha256')
		.update(JSON.stringify(stableMigrationValue(sourceId)))
		.digest('hex')}`;

const sourceUpdatedAtMs = (doc: any): number | null => {
	if (!doc?.updatedAt) return null;
	const value = new Date(doc.updatedAt).getTime();
	return Number.isFinite(value) ? value : null;
};

// This receipt is the durable proof that a server migration, rather than an
// identity-shaped foreign Thing, produced and verified the destination. It is
// deliberately stored outside Things so users cannot forge it and it never
// participates in account-byte accounting.
const writeCollectionConversionReceipt = async (collection: string, source: any, destinationShareId: string) => {
	const settings = await getSettingsCollection();
	const now = new Date();
	await settings.updateOne(
		{ key: migrationReceiptKey(collection, source._id) },
		{
			$set: {
				sourceCollection: collection,
				sourceId: String(source._id),
				sourceUpdatedAtMs: sourceUpdatedAtMs(source),
				sourceDigest: migrationSourceDigest(source),
				destinationShareId,
				convertedAt: now,
				updatedAt: now
			},
			$setOnInsert: {
				key: migrationReceiptKey(collection, source._id),
				schemaVersion: COLLECTION_SCHEMA_VERSIONS.settings,
				createdAt: now
			}
		},
		{ upsert: true }
	);
};

const hasCollectionConversionReceipt = async (collection: string, source: any): Promise<boolean> => {
	const receipt = await (
		await getSettingsCollection()
	).findOne(
		{ key: migrationReceiptKey(collection, source._id), sourceCollection: collection },
		{ projection: { sourceUpdatedAtMs: 1, sourceDigest: 1, destinationShareId: 1 } }
	);
	if (!receipt || typeof receipt.destinationShareId !== 'string') return false;
	const sourceTime = sourceUpdatedAtMs(source);
	return sourceTime !== null && Number.isFinite(receipt.sourceUpdatedAtMs)
		? Number(receipt.sourceUpdatedAtMs) >= sourceTime
		: receipt.sourceDigest === migrationSourceDigest(source);
};

const conversionSemanticFields = [
	'shareId',
	'schemaVersion',
	'thingtime',
	'crystal',
	'ownerId',
	'acl',
	'targetId',
	'tags',
	'uniqueKeys',
	'secure',
	'secureVersion',
	'secureAdmin',
	'secureRecentReactions',
	'avatarAttachmentId',
	'bannerAttachmentId'
] as const;

export const conversionThingSemanticallyEquals = (actual: any, expected: any, ignoreShareId: boolean): boolean => {
	const project = (doc: any) =>
		Object.fromEntries(conversionSemanticFields.filter((field) => !(ignoreShareId && field === 'shareId')).map((field) => [field, doc?.[field]]));
	return JSON.stringify(stableMigrationValue(project(actual))) === JSON.stringify(stableMigrationValue(project(expected)));
};

const destinationVersionCas = (doc: any): Record<string, unknown> => ({
	_id: doc._id,
	...(Object.prototype.hasOwnProperty.call(doc, 'updatedAt') ? { updatedAt: doc.updatedAt } : { updatedAt: { $exists: false } }),
	...(Object.prototype.hasOwnProperty.call(doc, 'secureVersion') ? { secureVersion: doc.secureVersion } : { secureVersion: { $exists: false } })
});

type ConvertSpec = {
  id: string;
  collection: string; // legacy source collection
  kind: string; // destination thingtime schema id
  title: string;
  description: string;
  // never the email or any other secret — labels land in admin-visible notes
  label: (doc: any) => string;
  // build the destination thing; { ok:false } skips + notes a malformed doc
  toThing: (doc: any) => BuiltThing;
  // when the destination shareId is NOT deterministic (waitlist mints uuids),
  // locate the existing counterpart by its uniqueKeys instead
  findExisting?: (things: any, doc: any, thing: Record<string, any>) => Promise<any>;
  // is the doc sitting at the destination genuinely this legacy doc's twin?
  isGenuine: (twin: any, doc: any, thing: Record<string, any>) => boolean;
};

const collectionToThingsMigration = (spec: ConvertSpec): Migration => ({
  id: spec.id,
  collection: spec.collection,
  fromVersion: COLLECTION_SCHEMA_VERSIONS[spec.collection],
  toVersion: THINGS_VERSION,
  title: spec.title,
  description: spec.description,
  // the whole remaining legacy collection is pending, whatever its stamped
  // schemaVersion — presence in the legacy collection IS the legacy era
  pending: async () => {
    return (await getCollection(spec.collection)).countDocuments({});
  },
	run: async ({ dryRun, assertLease }) => {
    await ensureIndexes();
    const things = await getCollection('things');
    const legacy = await getCollection(spec.collection);
    const notes = makeNotes();

    const matched = await legacy.countDocuments({});
    const existing = await things.countDocuments({ thingtime: spec.kind } as any);
    notes.push(`${existing} ${spec.kind} thing(s) already in things`);

    if (dryRun) {
      notes.push(`${matched} legacy ${spec.collection} doc(s) would be converted to ${spec.kind} things and removed`);
      return { dryRun, matched, migrated: 0, created: 0, skipped: 0, notes: notes.list() };
    }

    let migrated = 0;
    let created = 0;
    let skipped = 0;

    // batch through the legacy collection; collided/malformed docs stay put
    // and would re-match forever, so exclude the ones skipped this run
    const skippedIds: any[] = [];
    for (;;) {
			await assertLease?.();
      const filter = skippedIds.length ? { _id: { $nin: skippedIds } } : {};
			const batch = (await legacy
				.find(filter as any)
				.limit(CONVERT_BATCH)
				.toArray()) as any[];
      if (!batch.length) break;
      for (const doc of batch) {
				// This callback is invoked synchronously for only the current document;
				// it never escapes the loop iteration.
				// eslint-disable-next-line no-loop-func
        const skip = (reason: string) => {
          notes.push(`${spec.collection} ${spec.label(doc)}: ${reason}`);
          skipped += 1;
          skippedIds.push(doc._id);
        };
        try {
          const built = spec.toThing(doc);
          if (!built.ok) {
            const reason = 'reason' in built ? built.reason : 'conversion failed';
            skip(`${reason} — left for a later re-run`);
            continue;
          }
          const thing = built.thing;

          let twin = spec.findExisting ? await spec.findExisting(things, doc, thing) : null;
          let inserted = false;
          if (!twin) {
            try {
              if (spec.findExisting) {
                // non-deterministic shareId — the unique uniqueKeys index is
                // what dedupes concurrent/partial runs
                await things.insertOne(thing as any);
                inserted = true;
              } else {
                // atomic claim of the deterministic destination id: either we
                // created the doc at shareId (upsertedCount, genuinely ours by
                // construction) or something already sits there — re-read it
                // and let the genuine check decide
								const res = await things.updateOne({ shareId: thing.shareId } as any, { $setOnInsert: thing }, { upsert: true });
                inserted = !!res.upsertedCount;
                if (!inserted) twin = await things.findOne({ shareId: thing.shareId } as any);
              }
            } catch (err: any) {
              if (err?.code !== 11000) throw err;
              // a unique index (shareId race, or a uniqueKeys element held by
              // another doc) blocked the insert — re-read the counterpart and
              // let the genuine check decide; nothing was written
							twin = spec.findExisting ? await spec.findExisting(things, doc, thing) : await things.findOne({ shareId: thing.shareId } as any);
              if (!twin) {
                skip('unique key held by a foreign doc — left for a later re-run');
                continue;
              }
            }
          }
          if (!inserted && (!twin || !spec.isGenuine(twin, doc, thing))) {
            skip('destination id held by a foreign doc — left for a later re-run');
            continue;
          }
					// Re-read the source and require either byte-semantic equivalence or
					// a prior server receipt before consuming it. A kind/owner-shaped
					// twin alone is never conversion proof.
          if (inserted) created += 1;
          const fresh = await legacy.findOne({ _id: doc._id } as any);
					const destinationShareId = inserted ? thing.shareId : twin?.shareId ?? thing.shareId;
					if (!fresh) {
						// Another runner already consumed the source. Its receipt, not our
						// observation of a destination-shaped row, is the completion proof.
						if (!(await hasCollectionConversionReceipt(spec.collection, doc))) {
							skip('source changed during conversion — left for a later re-run');
						}
						continue;
					}
            const rebuilt = spec.toThing(fresh);
					if (!rebuilt.ok) {
						skip('source changed to an invalid shape during conversion — left for a later repair');
						continue;
					}
					const expected = { ...rebuilt.thing, shareId: destinationShareId };
					const destination = await things.findOne({ shareId: destinationShareId } as any);
					if (!destination || !spec.isGenuine(destination, fresh, expected)) {
						skip('destination changed during conversion — left for a later re-run');
						continue;
					}
					const receiptCoversFresh = await hasCollectionConversionReceipt(spec.collection, fresh);
					if (!receiptCoversFresh && !conversionThingSemanticallyEquals(destination, expected, !!spec.findExisting)) {
						// We may repair only the row inserted by THIS invocation, and only
						// while it still equals our original snapshot. A pre-existing weak
						// twin or a concurrently edited destination is left untouched.
						if (!inserted || !conversionThingSemanticallyEquals(destination, thing, !!spec.findExisting)) {
							skip('destination payload differs from the source and has no conversion receipt — left for repair');
							continue;
						}
						const replaced = await things.replaceOne(destinationVersionCas(destination) as any, expected as any);
						if (!replaced.matchedCount) {
							skip('destination changed during conversion — left for a later re-run');
							continue;
						}
            }
					await assertLease?.();
					const deleted = await legacy.deleteOne(exactDocumentSnapshotMatch(fresh) as any);
					if (!deleted.deletedCount) {
						skip('source changed during conversion — left for a later re-run');
						continue;
          }
					await writeCollectionConversionReceipt(spec.collection, fresh, destinationShareId);
          migrated += 1;
        } catch (err: any) {
          // generic note only — never echo err.message (could embed a doc
          // field value) into the admin-visible migration report
          skip('conversion error — left for a later re-run');
        }
      }
    }

    return { dryRun, matched, migrated, created, skipped, notes: notes.list() };
  }
});

const usersToThings = collectionToThingsMigration({
  id: 'users-to-things',
  collection: 'users',
  kind: 'user',
  title: 'Move user accounts into things',
  description:
    'Converts each legacy users doc into a user thing (thingtime ["user"]) shaped exactly like ' +
    'insertUser writes new accounts: public profile in crystal, credentials/private state under ' +
    'the root secure field (email + passwordHash as BinData so the wildcard text index cannot ' +
    'tokenize them), uniqueness via BinData uniqueKeys (username plain, email sha256-hashed), ' +
    'ownerId = shareId, acl ["tt:all"]. The legacy _id hex string is preserved as the thing ' +
    'shareId so sessions, rosters, and every ownerId reference keep working unchanged. Each ' +
    'legacy doc is deleted only once its user thing is verified in place; collisions are skipped ' +
    'and noted for a later re-run (dual-era reads keep serving the legacy doc meanwhile).',
  label: (doc) => (typeof doc?.username === 'string' && doc.username ? doc.username : String(doc?._id)),
  toThing: (doc) => {
    if (typeof doc?.username !== 'string' || !doc.username) return { ok: false, reason: 'missing username' };
    if (typeof doc?.email !== 'string' || !doc.email) return { ok: false, reason: 'missing email' };
    if (typeof doc?.passwordHash !== 'string' || !doc.passwordHash) return { ok: false, reason: 'missing passwordHash' };
    const shareId = String(doc._id);
    const createdAt = doc.createdAt ? new Date(doc.createdAt) : new Date();
    const updatedAt = doc.updatedAt ? new Date(doc.updatedAt) : createdAt;
    // buildUserSecure is THE user-thing secure shape (shared with insertUser),
    // so migrated + live-written accounts can't drift: opaque BinData blob, with
    // admin + the reaction MRU extracted to their root fields (secureAdmin
    // boolean, secureRecentReactions BinData array)
    const { secure, admin, recentReactions } = buildUserSecure({
      email: doc.email,
      passwordHash: doc.passwordHash,
      emailVerified: !!doc.emailVerified,
      accountKind: doc.accountKind === 'service' ? 'service' : 'user',
      emailVerificationRequiredBy: doc.emailVerificationRequiredBy ?? null,
      storageAllowanceBytes: typeof doc.storageAllowanceBytes === 'number' ? doc.storageAllowanceBytes : undefined,
      storageUsedBytes: typeof doc.storageUsedBytes === 'number' ? doc.storageUsedBytes : undefined,
      meta: doc.meta || {}
    });
    return {
      ok: true,
      thing: {
        shareId,
        schemaVersion: THINGS_VERSION,
        thingtime: ['user'],
        crystal: {
          username: doc.username,
          ttid: doc.ttid || doc.username,
          displayName: doc.displayName ?? null,
          bio: doc.bio ?? null,
          avatarUrl: doc.avatarUrl ?? null,
          bannerUrl: doc.bannerUrl ?? null
        },
        // users own themselves (insertUser convention)
        ownerId: shareId,
        acl: [ACL_ALL],
        targetId: null,
        tags: [],
				...profileAttachmentRefsForUserRoot(doc),
        uniqueKeys: [userUsernameKey(doc.username), userEmailKey(doc.email)],
        secure,
        secureVersion: 0, // matches insertUser — optimistic-concurrency token
        ...(admin ? { secureAdmin: true } : {}),
        ...(recentReactions.length ? { secureRecentReactions: packRecentReactions(recentReactions) } : {}),
        createdAt,
        updatedAt
      }
    };
  },
  isGenuine: (twin, doc, thing) =>
    Array.isArray(twin?.thingtime) &&
    twin.thingtime.includes('user') &&
    String(twin.ownerId) === thing.shareId &&
    twin.crystal?.username === doc.username
});

const themesToThings = collectionToThingsMigration({
  id: 'themes-to-things',
  collection: 'themes',
  kind: 'theme',
  title: 'Move saved themes into things',
  description:
    'Converts each legacy themes doc into a theme thing (thingtime ["theme"]) shaped exactly ' +
    'like saveTheme writes new themes: the resolved token doc in crystal { name, theme }, the ' +
    'legacy visibility enum mapped onto the acl (public → ["tt:all"], private → ["tt:user"]). ' +
    'shareIds are preserved so existing share links and users.meta.activeThemeId pointers keep ' +
    'resolving. Each legacy doc is deleted only once its theme thing is verified in place; ' +
    'collisions are skipped and noted for a later re-run.',
  label: (doc) => String(doc?.shareId || doc?._id),
  toThing: (doc) => {
    if (typeof doc?.shareId !== 'string' || !doc.shareId) return { ok: false, reason: 'missing shareId' };
    if (typeof doc?.name !== 'string' || !doc.name) return { ok: false, reason: 'missing name' };
    if (!doc.theme || typeof doc.theme !== 'object' || Array.isArray(doc.theme)) {
      return { ok: false, reason: 'missing theme tokens' };
    }
    const createdAt = doc.createdAt ? new Date(doc.createdAt) : new Date();
    const updatedAt = doc.updatedAt ? new Date(doc.updatedAt) : createdAt;
    return {
      ok: true,
      thing: {
        shareId: doc.shareId,
        schemaVersion: THINGS_VERSION,
        thingtime: ['theme'],
        crystal: { name: doc.name, theme: doc.theme },
        ownerId: String(doc.ownerId),
        acl: themeAcl(doc.visibility === 'public' ? 'public' : 'private'),
        targetId: null,
        tags: [],
        createdAt,
        updatedAt
      }
    };
  },
	isGenuine: (twin, doc) => Array.isArray(twin?.thingtime) && twin.thingtime.includes('theme') && String(twin.ownerId) === String(doc.ownerId)
});

const feedAlgorithmsToThings = collectionToThingsMigration({
  id: 'feed-algorithms-to-things',
  collection: 'feedAlgorithms',
  kind: 'feed-algorithm',
  title: 'Move feed algorithms into things',
  description:
    'Converts each legacy feedAlgorithms doc into a feed-algorithm thing (thingtime ' +
    '["feed-algorithm"]) shaped exactly like createAlgorithm writes new ones: the trained ' +
    'profile in crystal { name, emoji, parentId, weights, eventCount, lastTrainedAt }, ALWAYS ' +
    'private (acl ["tt:user"] — weights encode reading habits), targetId null so the ' +
    'reaction-unique partial index can never collide on crystal.emoji. shareIds are preserved so ' +
    'users.meta.activeFeedAlgorithmId pointers keep working. Each legacy doc is deleted only ' +
    'once its thing is verified in place; collisions are skipped and noted for a later re-run.',
  label: (doc) => String(doc?.shareId || doc?._id),
  toThing: (doc) => {
    if (typeof doc?.shareId !== 'string' || !doc.shareId) return { ok: false, reason: 'missing shareId' };
    if (typeof doc?.name !== 'string' || !doc.name) return { ok: false, reason: 'missing name' };
    const createdAt = doc.createdAt ? new Date(doc.createdAt) : new Date();
    const updatedAt = doc.updatedAt ? new Date(doc.updatedAt) : createdAt;
    return {
      ok: true,
      thing: {
        shareId: doc.shareId,
        schemaVersion: THINGS_VERSION,
        thingtime: ['feed-algorithm'],
        crystal: {
          name: doc.name,
          emoji: typeof doc.emoji === 'string' && doc.emoji ? doc.emoji : '🧠',
          parentId: doc.parentId ?? null,
          weights: doc.weights && typeof doc.weights === 'object' ? doc.weights : { types: {}, tags: {}, authors: {} },
          eventCount: typeof doc.eventCount === 'number' && doc.eventCount >= 0 ? doc.eventCount : 0,
          lastTrainedAt: doc.lastTrainedAt ? new Date(doc.lastTrainedAt) : null
        },
        ownerId: String(doc.ownerId),
        acl: [ACL_OWNER],
        // branch lineage lives ONLY in crystal.parentId (createAlgorithm
        // convention): a string targetId + crystal.emoji would collide in the
        // things_reaction_unique partial index
        targetId: null,
        tags: [],
        createdAt,
        updatedAt
      }
    };
  },
  isGenuine: (twin, doc) =>
		Array.isArray(twin?.thingtime) && twin.thingtime.includes('feed-algorithm') && String(twin.ownerId) === String(doc.ownerId)
});

const waitlistToThings = collectionToThingsMigration({
  id: 'waitlist-to-things',
  collection: 'waitlist',
  kind: 'waitlist',
  title: 'Move waitlist signups into things',
  description:
    'Converts each legacy waitlist doc into a waitlist thing (thingtime ["waitlist"]) shaped ' +
    'exactly like joinWaitlist mints new signups: uuid shareId, empty crystal, the email ONLY ' +
    'under the root secure field as BinData, uniqueness via the hashed BinData ' +
    'waitlist-email uniqueKey, system-owned and private (ownerId "system", acl ["tt:user"]). ' +
    'Emails whose things-era entry already exists are not duplicated (the uniqueKeys index is ' +
    'the dedup source of truth) — their legacy doc is simply removed. Each legacy doc is deleted ' +
    'only once its things-era entry is verified in place.',
  // never the email — labels land in admin-visible notes
  label: (doc) => String(doc?._id),
  toThing: (doc) => {
    if (typeof doc?.email !== 'string' || !doc.email.trim()) return { ok: false, reason: 'missing email' };
    const email = doc.email.trim().toLowerCase();
    const createdAt = doc.createdAt ? new Date(doc.createdAt) : new Date();
    return {
      ok: true,
      thing: {
        shareId: randomUUID(),
        schemaVersion: THINGS_VERSION,
        thingtime: ['waitlist'],
        crystal: {},
        // system-owned + owner-only: 'system' is never minted as a real user
        // id, so no viewer matches these through any read path
        ownerId: 'system',
        acl: [ACL_OWNER],
        targetId: null,
        tags: [],
        uniqueKeys: [waitlistEmailKey(email)],
        secure: { email: toBin(email) },
        createdAt,
        updatedAt: createdAt
      }
    };
  },
  // random shareId — the hashed-email uniqueKey is the deterministic identity
  findExisting: async (things, _doc, thing) => things.findOne({ uniqueKeys: thing.uniqueKeys[0] } as any),
	isGenuine: (twin) => Array.isArray(twin?.thingtime) && twin.thingtime.includes('waitlist') && twin.ownerId === 'system'
});

// ---------------------------------------------------------------------------
// Builtin-schema seeding: every builtin crystal schema in the code registry
// becomes a system-owned, public schema THING. These are real schema things,
// not search sugar: each crystal is projected onto the schema-thing grammar
// (projectBuiltinSchemaCrystal — lives in the registry beside the grammar it
// mirrors) and then passed through validateThingtimeCrystal(['schema']) — the
// exact write gate user-published schemas clear in createThing — before it is
// stored. A builtin that fails validation is a BUG reported loudly, never a
// silent skip. The envelope stays migration-built (not createThing) because it
// needs system-only powers the generic CRUD rightly refuses: ownerId 'system',
// the reserved 'schema-' shareId prefix (sanitizeShareId blocks it against
// squatters), uniqueKeys, and reconciling upserts. Re-runs self-heal drift —
// a genuine seeded doc whose crystal or server-owned control-plane storage
// stamp no longer matches is refreshed in place — and pending() counts missing
// AND stale docs, so drift genuinely surfaces in the admin census.

const BUILTIN_SCHEMA_SHARE_PREFIX = 'schema-';

const builtinCrystalSchemas = () => thingtimeSchemas.filter((schema) => schema.kind === 'crystal');
const builtinSchemaShareIds = () => builtinCrystalSchemas().map((schema) => `${BUILTIN_SCHEMA_SHARE_PREFIX}${schema.id}`);

// Registry schema -> the validated schema-thing crystal the seed stores. One
// call chains the shared projection + the shared write gate, so seeded
// builtins and user publishes can never drift onto different grammars.
const builtinSchemaCrystal = (schema: (typeof thingtimeSchemas)[number]) => validateThingtimeCrystal(['schema'], projectBuiltinSchemaCrystal(schema));

const genuineSeededSchema = (twin: any): boolean =>
  !!twin && Array.isArray(twin.thingtime) && twin.thingtime.includes('schema') && twin.ownerId === 'system';

const seedBuiltinSchemas: Migration = {
  id: 'seed-builtin-schemas',
  collection: 'things',
  fromVersion: THINGS_VERSION,
  toVersion: THINGS_VERSION,
  title: 'Seed builtin crystal schemas as schema things',
  description:
    'Every builtin crystal schema in the code registry is seeded as a system-owned public schema ' +
    'thing — thingtime ["schema"], shareId schema-<id>, uniqueKeys ["schema:<id>"], acl ["tt:all"], ' +
    'and the server-owned storageClass "control". Each crystal is projected onto ' +
    'the schema-thing field grammar and validated through validateThingtimeCrystal(["schema"]) ' +
    '— the same gate user-published schemas pass — before writing; open record shapes and ' +
    'reserved names are projected away, and a validation failure is reported as a bug. ' +
    'Idempotent and self-healing: re-runs upsert by shareId, refresh genuine seeded docs whose ' +
    'crystal or control-plane storage stamp drifted, and skip+note foreign docs squatting a destination id.',
  pending: async () => {
    const things = await getCollection('things');
    const schemas = builtinCrystalSchemas();
    const docs = await things
      .find({ shareId: { $in: builtinSchemaShareIds() } } as any)
      .project({ shareId: 1, thingtime: 1, ownerId: 1, crystal: 1, storageClass: 1 })
      .toArray();
		const byShareId = new Map<string, any>(docs.map((doc: any) => [String(doc.shareId), doc]));
    let count = 0;
    for (const schema of schemas) {
      const twin = byShareId.get(`${BUILTIN_SCHEMA_SHARE_PREFIX}${schema.id}`);
      // missing or squatted → unfinished work either way
      if (!genuineSeededSchema(twin)) {
        count += 1;
        continue;
      }
      const validated = builtinSchemaCrystal(schema);
      // Projection/grammar drift, registry crystal drift, and a missing or
      // incorrect server-owned control-plane stamp are all pending work.
      if (validated.ok === false || builtinSchemaSeedNeedsRefresh(twin, validated.crystal)) {
        count += 1;
      }
    }
    return count;
  },
	run: async ({ dryRun, assertLease }) => {
    await ensureIndexes();
    const things = await getCollection('things');
    const notes = makeNotes();
    const schemas = builtinCrystalSchemas();
    const matched = schemas.length;

    let created = 0;
    let refreshed = 0;
    let skipped = 0;
    let alreadySeeded = 0;

    for (const schema of schemas) {
      const shareId = `${BUILTIN_SCHEMA_SHARE_PREFIX}${schema.id}`;
      try {
        const validated = builtinSchemaCrystal(schema);
        if (validated.ok === false) {
          // the registry projection broke the schema-thing grammar — a code
          // bug to fix (builtinSchemaProjection.test.ts pins this), not data
          notes.push(`schema ${schema.id}: projection failed validation (${validated.error}) — left unseeded, fix the registry`);
          skipped += 1;
          continue;
        }
        const now = new Date();
        const thing = {
          shareId,
          schemaVersion: THINGS_VERSION,
          thingtime: validated.thingtime,
          crystal: validated.crystal,
          ownerId: 'system',
          storageClass: 'control',
          acl: [ACL_ALL],
          targetId: null,
          tags: [],
          uniqueKeys: [toBin(`schema:${schema.id}`)],
          createdAt: now,
          updatedAt: now
        };
        if (!dryRun) {
          const res = await things.updateOne({ shareId } as any, { $setOnInsert: thing }, { upsert: true });
          if (res.upsertedCount) {
            created += 1;
            continue;
          }
        }
        const twin = await things.findOne({ shareId } as any);
        if (dryRun && !twin) {
          created += 1;
          continue;
        }
        if (!genuineSeededSchema(twin)) {
          notes.push(`schema ${schema.id}: shareId ${shareId} held by a foreign doc — left unseeded`);
          skipped += 1;
          continue;
        }
        const crystalNeedsRefresh = JSON.stringify(twin!.crystal ?? {}) !== JSON.stringify(validated.crystal);
        const storageClassNeedsRefresh = twin!.storageClass !== 'control';
        if (builtinSchemaSeedNeedsRefresh(twin, validated.crystal)) {
          if (!dryRun) {
            // genuineness lives IN the filter — a foreign doc matches nothing,
            // preserving the same anti-squat guarantee as the skip above
						await things.updateOne({ shareId, ownerId: 'system', thingtime: 'schema' } as any, {
							$set: { crystal: validated.crystal, storageClass: 'control', updatedAt: now }
						});
          }
					const repairs = [crystalNeedsRefresh ? 'registry crystal' : null, storageClassNeedsRefresh ? 'control-plane storage class' : null].filter(
						Boolean
					);
          notes.push(`schema ${schema.id}: ${dryRun ? 'would repair' : 'repaired'} ${repairs.join(' and ')}`);
          refreshed += 1;
          continue;
        }
        alreadySeeded += 1;
      } catch (err: any) {
        if (err?.code === 11000) notes.push(`schema ${schema.id}: unique key held by a foreign doc — left unseeded`);
        else notes.push(`schema ${schema.id}: error: ${safeErrorText(err, 'migrations seedBuiltinSchemas')} — left unseeded`);
        skipped += 1;
      }
    }

    if (created) notes.push(`${created} builtin schema thing(s) ${dryRun ? 'would be ' : ''}seeded`);
    if (refreshed) notes.push(`${refreshed} builtin schema thing(s) ${dryRun ? 'would be ' : ''}refreshed`);
    if (alreadySeeded) notes.push(`${alreadySeeded} builtin schema thing(s) already seeded and current`);
    return {
      dryRun,
      matched,
      migrated: dryRun ? 0 : created + refreshed,
      created: dryRun ? 0 : created,
      skipped: skipped + alreadySeeded,
      notes: notes.list()
    };
  }
};

// ---------------------------------------------------------------------------
// Physical collection generations (mongodb/collectionNames.ts): every logical
// collection lives in a versioned physical collection — `things` at version 2
// is the physical collection `things_v2`. Adoption (mongodb/collections.ts)
// renames unversioned legacy collections in place on first db contact; the two
// migrations below cover what adoption can't:
//
// - merge-legacy-collections: when a legacy collection still exists BESIDE its
//   versioned successor (rename unavailable on the db tier, or writes landed
//   in the new collection before adoption ran), copy the leftover docs forward
//   by _id. The legacy collection is NEVER deleted here — it stays behind as a
//   frozen snapshot.
// - drop-stale-collection-generations: the only place old generations are
//   removed. A stale generation (unversioned legacy, or _v<N> below current)
//   is dropped only once nothing still needs it — legacy collections must
//   have zero unmerged docs, and no registered migration may still be reading
//   from it (sourcePhysicals + pending). This is the "database is on v5, so
//   every <v5 collection can safely go" step, and it is explicitly
//   destructive: the run endpoint requires confirm: true.
//
// Future shape migrations follow the same pattern: bump the collection's
// version in COLLECTION_SCHEMA_VERSIONS (the code immediately targets the new
// physical collection), register a copy-forward migration that reads the
// pinned old physical name (declare it in sourcePhysicals so cleanup waits for
// it), run it, verify, then run the cleanup to drop the superseded generation.

type LegacyResidueRow = {
  collection: string;
  physical: string;
  // docs in the legacy collection whose _id is absent from the current
  // generation — the exact set merge-legacy-collections still has to copy
  missing: number;
};

// A collection-to-Things migration intentionally removes its current physical
// source after verifying the destination. If an older unversioned collection
// still exists as a frozen snapshot, absence from the current generation no
// longer means that row needs copying again: the genuine Thing is the durable
// successor. Keep this predicate aligned with the conversion specs above so a
// malformed row or a foreign destination collision remains pending.
const legacyRowHasConvertedThing = async (collection: string, doc: any, things: any): Promise<boolean> => {
	if (!(await hasCollectionConversionReceipt(collection, doc))) return false;
	if (collection === 'users') {
		if (
			typeof doc?.username !== 'string' ||
			!doc.username ||
			typeof doc?.email !== 'string' ||
			!doc.email ||
			typeof doc?.passwordHash !== 'string' ||
			!doc.passwordHash
		) {
			return false;
		}
		const shareId = String(doc._id);
		const twin = await things.findOne({ shareId }, { projection: { thingtime: 1, ownerId: 1, 'crystal.username': 1 } });
		return (
			Array.isArray(twin?.thingtime) && twin.thingtime.includes('user') && String(twin.ownerId) === shareId && twin.crystal?.username === doc.username
		);
	}

	if (collection === 'themes') {
		if (
			typeof doc?.shareId !== 'string' ||
			!doc.shareId ||
			typeof doc?.name !== 'string' ||
			!doc.name ||
			!doc.theme ||
			typeof doc.theme !== 'object' ||
			Array.isArray(doc.theme)
		) {
			return false;
		}
		const twin = await things.findOne({ shareId: doc.shareId }, { projection: { thingtime: 1, ownerId: 1 } });
		return Array.isArray(twin?.thingtime) && twin.thingtime.includes('theme') && String(twin.ownerId) === String(doc.ownerId);
	}

	if (collection === 'feedAlgorithms') {
		if (typeof doc?.shareId !== 'string' || !doc.shareId || typeof doc?.name !== 'string' || !doc.name) {
			return false;
		}
		const twin = await things.findOne({ shareId: doc.shareId }, { projection: { thingtime: 1, ownerId: 1 } });
		return Array.isArray(twin?.thingtime) && twin.thingtime.includes('feed-algorithm') && String(twin.ownerId) === String(doc.ownerId);
	}

	if (collection === 'waitlist') {
		if (typeof doc?.email !== 'string' || !doc.email.trim()) return false;
		const twin = await things.findOne({ uniqueKeys: waitlistEmailKey(doc.email.trim().toLowerCase()) }, { projection: { thingtime: 1, ownerId: 1 } });
		return Array.isArray(twin?.thingtime) && twin.thingtime.includes('waitlist') && twin.ownerId === 'system';
	}

	return false;
};

// The unversioned legacy collections that still exist, with their unmerged-doc
// counts. Exact by _id ($lookup into the current generation), so "missing: 0"
// genuinely means every doc has a counterpart and the snapshot is droppable.
const legacyResidue = async (): Promise<LegacyResidueRow[]> => {
  const db = await getThingtimeDb();
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry: any) => entry.name);
  const legacyRows = classifyPhysicalCollections(names).filter((row) => row.version === null);
	const things = db.collection(physicalCollectionName('things'));
  return Promise.all(
    legacyRows.map(async (row) => {
			const cursor = db.collection(row.physical).aggregate([
          {
            $lookup: {
              from: physicalCollectionName(row.collection),
              localField: '_id',
              foreignField: '_id',
              as: 'copied'
            }
          },
          { $match: { copied: { $size: 0 } } },
				{ $project: { copied: 0 } }
			]);
			let missing = 0;
			for await (const doc of cursor) {
				if (!(await legacyRowHasConvertedThing(row.collection, doc, things))) missing += 1;
			}
			return { collection: row.collection, physical: row.physical, missing };
    })
  );
};

// ---------------------------------------------------------------------------
// Full-power app namespaces (TODO/claude-todo/16-full-power-app-namespaces.md):
// pre-namespace app-data things carry only crystal.appId. Stamp the scalar
// root appId (the namespace marker every app-lens query keys on) + sizeBytes
// (the storage ledger's unit), then reconcile each (user, app) ledger to the
// $sum of its namespace — absolute writes, so re-running is always safe. Sandbox docs
// get stamped too but never enter a standing ledger (they TTL away).

const appNamespaceBackfillFilter = {
  thingtime: 'app-data',
  'crystal.appId': { $exists: true },
  $or: [{ appId: { $exists: false } }, { sizeBytes: { $exists: false } }]
};

const backfillAppNamespaceFields: Migration = {
  id: 'backfill-app-namespace-fields',
  collection: 'things',
  fromVersion: THINGS_VERSION,
  toVersion: THINGS_VERSION,
  title: 'Backfill app namespace stamps (appId + sizeBytes) and storage ledgers',
  description:
    'Stamps the scalar root appId and serialized sizeBytes onto pre-namespace app-data things ' +
    '(crystal.appId only), then reconciles every (user, app) storage ledger to the sum of its ' +
    'namespace. Idempotent: stamps are recomputed deterministically and ledgers are set absolutely.',
  pending: async () => {
    return (await getCollection('things')).countDocuments(appNamespaceBackfillFilter);
  },
	run: async ({ dryRun, assertLease }) => {
    const things = await getCollection('things');
    const matched = await things.countDocuments(appNamespaceBackfillFilter);
    const notes: string[] = [];
    if (dryRun) return { dryRun, matched, migrated: 0, created: 0, skipped: 0, notes };

    let migrated = 0;
    // batch the stamp pass — each doc's sizeBytes depends on its own payload
    while (true) {
			await assertLease?.();
      const batch = await things
        .find(appNamespaceBackfillFilter)
        .project({ shareId: 1, crystal: 1, extended: 1, tags: 1 })
        .limit(THINGS_BATCH)
        .toArray();
      if (!batch.length) break;
      for (const doc of batch) {
				await things.updateOne({ shareId: doc.shareId }, { $set: { appId: doc.crystal?.appId, sizeBytes: appThingSizeBytes(doc as any) } });
        migrated += 1;
      }
      if (batch.length < THINGS_BATCH) break;
    }

    // ledger reconcile: absolute sums over every non-sandbox namespace doc
    const sums = await things
      .aggregate([
        { $match: { appId: { $exists: true }, sandboxExpiresAt: { $exists: false }, sizeBytes: { $type: 'number' } } },
        { $group: { _id: { ownerId: '$ownerId', appId: '$appId' }, bytes: { $sum: '$sizeBytes' } } }
      ])
      .toArray();
    let ledgers = 0;
    for (const entry of sums) {
			await assertLease?.();
      const ownerId = String(entry._id?.ownerId || '');
      const appId = String(entry._id?.appId || '');
      if (!ownerId || !appId) continue;
			await convertHistoricalAppStorageCounter(ownerId, appId);
      if (await setAppStorageUsed(ownerId, appId, entry.bytes || 0, { onlyIfNotLive: true })) {
        ledgers += 1;
      }
    }
    notes.push(`${ledgers} storage ledger(s) reconciled to their namespace sums`);

    return { dryRun, matched, migrated, created: ledgers, skipped: 0, notes };
  }
};

// ---------------------------------------------------------------------------
// Registered-app storage allowances. PR 16's namespace ledger was per user;
// this follow-up makes the app's real aggregate ceiling explicit too. Legacy
// apps stay fail-closed because positive writes require the accounting-version
// marker plus the policy fields. For each app we stamp pre-namespace residue,
// reconcile/protect user ledgers, then initialize the aggregate LAST. That is
// the writer fence: no new-code write can race a baseline into an undercount.

const appStorageAllowanceBackfillFilter = {
  thingtime: 'app',
  'crystal.storageAccountingVersion': { $ne: APP_STORAGE_ACCOUNTING_VERSION }
};

const backfillAppStorageAllowances: Migration = {
  id: 'backfill-app-storage-allowances',
  collection: 'things',
  fromVersion: THINGS_VERSION,
  toVersion: THINGS_VERSION,
  title: 'Initialize whole-app and per-app-user storage allowances',
  description:
    'Initializes each legacy app with the free storage plan, aggregate usage, and 50 MiB default user ' +
    'allowance. Reconciles every user ledger and converts it to the protected app-storage kind before ' +
    'enabling writes, then installs the app aggregate/version marker last so concurrent new-code writes ' +
    'cannot be overwritten by the baseline.',
  pending: async () => {
    return (await getCollection('things')).countDocuments(appStorageAllowanceBackfillFilter);
  },
	run: async ({ dryRun, assertLease }) => {
    const things = await getCollection('things');
		const apps = await things.find(appStorageAllowanceBackfillFilter).project({ 'crystal.clientId': 1 }).toArray();
    const matched = apps.length;
    const notes: string[] = [];
    if (dryRun) return { dryRun, matched, migrated: 0, created: 0, skipped: 0, notes };

    let migrated = 0;
    let ledgers = 0;
    let stamped = 0;
    let skipped = 0;

    for (const app of apps) {
			await assertLease?.();
      const appId = typeof app.crystal?.clientId === 'string' ? app.crystal.clientId : '';
      if (!appId) {
        skipped += 1;
        continue;
      }

      // A legacy KV entry may still carry only crystal.appId. Stamp it before
      // either sum so this migration is safe even when the older namespace
      // migration has not been run yet.
      while (true) {
				await assertLease?.();
        const batch = await things
          .find({
            thingtime: 'app-data',
            'crystal.appId': appId,
            $or: [{ appId: { $exists: false } }, { sizeBytes: { $exists: false } }]
          })
          .project({ shareId: 1, crystal: 1, extended: 1, tags: 1 })
          .limit(THINGS_BATCH)
          .toArray();
        if (!batch.length) break;
        for (const doc of batch) {
					await things.updateOne({ shareId: doc.shareId }, { $set: { appId, sizeBytes: appThingSizeBytes(doc as any) } });
          stamped += 1;
        }
        if (batch.length < THINGS_BATCH) break;
      }

      const perUser = await things
        .aggregate([
          {
            $match: {
              appId,
              sandboxExpiresAt: { $exists: false },
              sizeBytes: { $type: 'number' }
            }
          },
          { $group: { _id: '$ownerId', bytes: { $sum: '$sizeBytes' } } }
        ])
        .toArray();
      const bytesByOwner = new Map<string, number>();
      let appUsedBytes = 0;
      for (const entry of perUser) {
				await assertLease?.();
        const ownerId = String(entry._id || '');
        if (!ownerId) continue;
        const usedBytes = Math.max(0, Math.floor(entry.bytes || 0));
        bytesByOwner.set(ownerId, usedBytes);
				await convertHistoricalAppStorageCounter(ownerId, appId);
        const reconciled = await setAppStorageUsed(ownerId, appId, usedBytes, { onlyIfNotLive: true });
        appUsedBytes += usedBytes;
        if (reconciled) ledgers += 1;
      }

      // A prior ambiguous refund can leave a conservative counter even when
      // that user has no namespace docs left, so the aggregation above has no
      // row for them. Reconcile those existing counters explicitly to zero.
      const existingLedgers = await things
        .find({
					shareId: { $regex: `^${APP_STORAGE_RESERVED_ID_PREFIX}` },
          'crystal.appId': appId,
          sandboxExpiresAt: { $exists: false }
        })
        .project({ ownerId: 1 })
        .toArray();
      for (const ledger of existingLedgers) {
				await assertLease?.();
        const ownerId = String(ledger.ownerId || '');
        if (!ownerId || bytesByOwner.has(ownerId)) continue;
				await convertHistoricalAppStorageCounter(ownerId, appId);
        if (await setAppStorageUsed(ownerId, appId, 0, { onlyIfNotLive: true })) {
          ledgers += 1;
        }
      }

      if (await initializeAppStorageAccounting(appId, appUsedBytes)) migrated += 1;
      else skipped += 1; // another idempotent migration runner initialized it
    }

    notes.push(`${stamped} legacy namespace doc(s) stamped before accounting`);
    notes.push(`${ledgers} per-app-user ledger(s) reconciled`);
    notes.push(`${migrated} whole-app aggregate(s) initialized last`);
    return { dryRun, matched, migrated, created: ledgers, skipped, notes };
  }
};

// ---------------------------------------------------------------------------
// Whole-account storage. Every customer-controlled Thing uses the same
// versioned logical-byte stamp, while the protected user subscription Thing is
// the one hot enforcement/display ledger. App content contributes to this
// account total once and keeps its app/app-user counters only as overlapping
// sub-limits. Existing secure-blob usage is ignored because no write path ever
// maintained it; an explicit legacy allowance is preserved as a real override.

// Function (rather than a module-time array) because mergeLegacyCollections is
// declared below this migration. Calls happen only after module initialization.
export const userStoragePrerequisites = (): Migration[] => [
	mergeLegacyCollections,
	thingsMigration,
	seedBuiltinSchemas,
	usersToThings,
	themesToThings,
	feedAlgorithmsToThings,
	backfillAppNamespaceFields,
	backfillAppStorageAllowances
];

const currentUserIds = async (): Promise<string[]> => {
	const [thingUsers, legacyUsers] = await Promise.all([
		getCollection('things').then((things) => things.find({ thingtime: 'user' }).project({ shareId: 1 }).toArray()),
		getCollection('users').then((users) => users.find({}).project({ _id: 1 }).toArray())
	]);
	return [
		...new Set([
			...thingUsers.map((doc: any) => String(doc.shareId || '')).filter(Boolean),
			...legacyUsers.map((doc: any) => String(doc._id || '')).filter(Boolean)
		])
	];
};

const legacyServiceQuotaMatch = {
	thingtime: 'data',
	'crystal.quotaKind': SERVICE_QUOTA_THINGTIME
};
const LEGACY_SERVICE_QUOTA_QUARANTINE_KIND = 'legacy-service-quota-quarantine';

const countLegacyServiceQuotaThings = async (): Promise<number> => {
	const things = await getCollection('things');
	// Exact-envelope classification must inspect the unprojected document. A
	// projection could hide an attacker-controlled root field and accidentally
	// make arbitrary content look like the historical server envelope.
	const cursor = things.find(legacyServiceQuotaMatch);
	let count = 0;
	for await (const doc of cursor) {
		if (classifyLegacyServiceQuotaThing(doc).disposition !== 'ignore') count += 1;
	}
	return count;
};

const migrateLegacyServiceQuotaThings = async (assertLease: () => Promise<void>): Promise<{ rebuilt: number; quarantined: number }> => {
	const things = await getCollection('things');
	const cursor = things.find(legacyServiceQuotaMatch);
	let rebuilt = 0;
	let quarantined = 0;
	for await (const doc of cursor) {
		await assertLease();
		const disposition = await withMongoTransaction(async (session) => {
			await assertLease();
			const fresh = await things.findOne({ _id: doc._id, thingtime: 'data', 'crystal.quotaKind': SERVICE_QUOTA_THINGTIME }, { session });
			if (!fresh) return 'ignore' as const;

			const classification = classifyLegacyServiceQuotaThing(fresh);
			if (classification.disposition === 'ignore') return 'ignore' as const;
			await assertLease();
			const at = Date.now();
			let modified = 0;
			if (classification.disposition === 'rebuild') {
				const replacement = buildConservativeLegacyServiceQuotaThing(classification, at);
				const result = await things.replaceOne(
					{ _id: fresh._id, thingtime: 'data', 'crystal.quotaKind': SERVICE_QUOTA_THINGTIME },
					{ _id: fresh._id, ...replacement },
					{ session }
				);
				modified = result.modifiedCount;
			} else {
				// Preserve arbitrary content fields, but remove every root-level route
				// to a storage exemption and retire the forged quota marker. The
				// normal byte-stamping pass below will then account for the complete
				// quarantined payload as generic data.
				const result = await things.updateOne(
					{ _id: fresh._id, thingtime: 'data', 'crystal.quotaKind': SERVICE_QUOTA_THINGTIME },
					{
						$set: {
							thingtime: ['data'],
							storageClass: 'content',
							'crystal.quotaKind': LEGACY_SERVICE_QUOTA_QUARANTINE_KIND,
							updatedAt: new Date(at)
						},
						$unset: {
							sandboxExpiresAt: '',
							sizeBytes: '',
							storageAccountingVersion: ''
						}
					},
					{ session }
				);
				modified = result.modifiedCount;
			}
			if (!modified) return 'ignore' as const;

			// A prior partial account total may include this row. Keep the owner
			// fenced in the same transaction; exact reconciliation later in this
			// migration is the only path back to ready.
			if (typeof fresh.ownerId === 'string' && fresh.ownerId) {
				await things.updateOne(
					{
						...subscriptionThingMatch('user', fresh.ownerId),
						'crystal.storageAccountingVersion': USER_STORAGE_ACCOUNTING_VERSION
					},
					{
						$set: {
							'crystal.storageLedgerStatus': USER_STORAGE_STATUS.needsReconcile,
							'crystal.storageUpdatedAt': new Date(at)
						}
					},
					{ session }
				);
			}
			return classification.disposition;
		});
		if (disposition === 'rebuild') rebuilt += 1;
		if (disposition === 'quarantine') quarantined += 1;
		await assertLease();
	}
	return { rebuilt, quarantined };
};

const countUnstampedBillableThings = async (knownUsers: Set<string>): Promise<number> => {
	const things = await getCollection('things');
	const cursor = things.find({ ownerId: { $type: 'string' } }).project(USER_STORAGE_ACCOUNTING_MIGRATION_PROJECTION);
	let pending = 0;
	for await (const doc of cursor) {
		// Every data-kind service-quota claim is counted independently above. An
		// exact full-document envelope will be conservatively rebuilt; any other
		// claim will first be normalized to billable quarantine content. Skipping
		// it here avoids double-counting pending work without granting an exemption.
		if (
			doc.crystal?.quotaKind === SERVICE_QUOTA_THINGTIME &&
			(doc.thingtime === 'data' || (Array.isArray(doc.thingtime) && doc.thingtime.includes('data')))
		) {
			continue;
		}
		const sandboxState = storageSandboxState(doc as any);
		if (sandboxState === 'sandbox') continue;
		const ownership = storageMigrationOwnership(doc as any, knownUsers);
		if (ownership === 'excluded') continue;
		if (ownership === 'unknown-user') {
			pending += 1;
			continue;
		}
		if (sandboxState === 'invalid') {
			pending += 1;
			continue;
		}
		if (
			doc.schemaVersion !== COLLECTION_SCHEMA_VERSIONS.things ||
			!Array.isArray(doc.thingtime) ||
			doc.storageClass !== 'content' ||
			doc.storageAccountingVersion !== USER_STORAGE_ACCOUNTING_VERSION ||
			!Number.isSafeInteger(doc.sizeBytes) ||
			Number(doc.sizeBytes) < 0 ||
			doc.sizeBytes !== thingStorageSizeBytes(doc as any)
		) {
			pending += 1;
		}
	}
	return pending;
};

const registeredAppStorageIds = (things: any) =>
	things.aggregate([
		{
			$match: {
				$or: [
					{ thingtime: 'app', 'crystal.clientId': { $type: 'string' } },
					{ appId: { $type: 'string' } },
					{
						shareId: { $regex: `^${APP_STORAGE_RESERVED_ID_PREFIX}` },
						'crystal.appId': { $type: 'string' }
					}
				]
			}
		},
		{
			$project: {
				appId: {
					$switch: {
						branches: [
							{
								case: {
									$and: [
										{ $eq: [{ $type: '$crystal.clientId' }, 'string'] },
										{ $in: ['app', { $cond: [{ $isArray: '$thingtime' }, '$thingtime', []] }] }
									]
								},
								then: '$crystal.clientId'
							},
							{ case: { $eq: [{ $type: '$appId' }, 'string'] }, then: '$appId' },
							{ case: { $eq: [{ $type: '$crystal.appId' }, 'string'] }, then: '$crystal.appId' }
						],
						default: null
					}
				}
			}
		},
		{ $match: { appId: { $type: 'string', $ne: '' } } },
		{ $group: { _id: '$appId' } },
		{ $sort: { _id: 1 } }
	]);

const canonicalStandingAppCounter = (counter: any, ownerId: string, appId: string): boolean => {
	const scope: AppNamespaceScope = {
		appId,
		ownerId,
		sharedRead: false,
		scopes: [],
		username: '',
		sandbox: null
	};
	return !!counter && appStorageCounterEnvelopeIsTrusted(counter, scope) && appStorageCounterCrystalIsReady(counter.crystal);
};

// Exact postflight for all overlapping app ledgers, including deleted apps.
// It deliberately checks source (owner, app) pairs against deterministic
// counters instead of independently summing bytes for display; the protected
// counter remains the sole rendered/enforced source.
const pendingAppStorageAccounting = async (): Promise<number> => {
	const things = await getCollection('things');
	let pending = 0;

	const liveApps = things.find({ thingtime: 'app', 'crystal.clientId': { $type: 'string' } });
	for await (const app of liveApps) {
		if (!appStoragePolicyOf(app).ready) pending += 1;
	}

	// Every reserved standing counter must be the exact protected envelope and
	// ready. Valid Date-scoped sandbox counters are intentionally outside the
	// standing ledger universe and expire with their sandbox.
	const counterCursor = things.find({ shareId: { $regex: `^${APP_STORAGE_RESERVED_ID_PREFIX}` } });
	for await (const counter of counterCursor) {
		if (counter.sandboxExpiresAt instanceof Date && Number.isFinite(counter.sandboxExpiresAt.getTime())) continue;
		const ownerId = typeof counter.ownerId === 'string' ? counter.ownerId : '';
		const appId = typeof counter.crystal?.appId === 'string' ? counter.crystal.appId : '';
		if (!ownerId || !appId || ownerId.startsWith('sandbox:') || !canonicalStandingAppCounter(counter, ownerId, appId)) {
			pending += 1;
		}
	}

	const verifyPairs = async (pairs: Array<{ ownerId: string; appId: string; shareId: string }>) => {
		if (!pairs.length) return;
		const docs = await things.find({ shareId: { $in: pairs.map((pair) => pair.shareId) } }).toArray();
		const byId = new Map(docs.map((doc: any) => [String(doc.shareId), doc]));
		for (const pair of pairs) {
			if (!canonicalStandingAppCounter(byId.get(pair.shareId), pair.ownerId, pair.appId)) pending += 1;
		}
	};

	let pairs: Array<{ ownerId: string; appId: string; shareId: string }> = [];
	const sourcePairs = things.aggregate([
		{
			$match: {
				ownerId: { $type: 'string' },
				appId: { $type: 'string' },
				sandboxExpiresAt: { $exists: false }
			}
		},
		{ $group: { _id: { ownerId: '$ownerId', appId: '$appId' } } }
	]);
	for await (const row of sourcePairs) {
		const ownerId = String(row._id?.ownerId || '');
		const appId = String(row._id?.appId || '');
		if (!ownerId || !appId || ownerId.startsWith('sandbox:')) {
			pending += 1;
			continue;
		}
		pairs.push({ ownerId, appId, shareId: appStorageCounterShareId(ownerId, appId) });
		if (pairs.length === 500) {
			await verifyPairs(pairs);
			pairs = [];
		}
	}
	await verifyPairs(pairs);
	return pending;
};

const pendingUserStorageAccounting = async (): Promise<number> => {
	const [prerequisitePending, legacyServiceQuotas, appStoragePending] = await Promise.all([
		Promise.all(userStoragePrerequisites().map((migration) => migration.pending())),
		countLegacyServiceQuotaThings(),
		pendingAppStorageAccounting()
	]);
	const things = await getCollection('things');
	const ids = await currentUserIds();
	if (!ids.length) {
		return prerequisitePending.reduce((sum, count) => sum + count, 0) + legacyServiceQuotas + appStoragePending;
	}
	let ready = 0;
	// Keep every $in beneath Mongo's command/BSON ceilings even on a very
	// large install. The migration itself checkpoints through source stamps and
	// per-owner ledgers, so reruns resume rather than restart from guessed data.
	for (let offset = 0; offset < ids.length; offset += 500) {
		const batch = ids.slice(offset, offset + 500);
		const docs = await things.find({ shareId: { $in: batch.map((id) => subscriptionThingMatch('user', id).shareId) } }).toArray();
		const byShareId = new Map<string, any>(docs.map((doc: any) => [String(doc.shareId), doc]));
		for (const ownerId of batch) {
			const doc = byShareId.get(subscriptionThingMatch('user', ownerId).shareId);
			if (
				userSubscriptionLedgerEnvelopeIsTrusted(doc, ownerId) &&
				doc.crystal?.storageAccountingVersion === USER_STORAGE_ACCOUNTING_VERSION &&
				doc.crystal?.storageLedgerStatus === USER_STORAGE_STATUS.ready &&
				Number.isSafeInteger(doc.crystal?.storageUsedBytes) &&
				Number(doc.crystal.storageUsedBytes) >= 0 &&
				userStorageAllowanceIsValid(doc.crystal)
			) {
				ready += 1;
			}
		}
	}
	return (
		prerequisitePending.reduce((sum, count) => sum + count, 0) +
		legacyServiceQuotas +
		appStoragePending +
		ids.length -
		ready +
		(await countUnstampedBillableThings(new Set(ids)))
	);
};

// Existing installations predate the root proof marker. Only the exact old
// server envelope may receive it; a row with a wrong subject, ACL, extra
// payload, or any other reserved-id squatting is left untouched and blocks
// publication. The CAS match repeats the complete old envelope so a
// concurrent change can never be accidentally blessed.
const upgradeUserSubscriptionLedgerEnvelopes = async (ids: readonly string[]): Promise<number> => {
	const things = await getCollection('things');
	let upgraded = 0;
	for (const ownerId of ids) {
		const looseMatch = subscriptionThingMatch('user', ownerId);
		let doc = await things.findOne(looseMatch);
		if (!doc || userSubscriptionLedgerEnvelopeIsTrusted(doc, ownerId)) continue;
		if (!legacyUserSubscriptionLedgerEnvelopeCanUpgrade(doc, ownerId)) {
			throw new MigrationOperatorError('subscription_envelope_invalid', {
				internalMessage: `Subscription ledger ${looseMatch.shareId} has an invalid protected envelope`
			});
		}
		const result = await things.updateOne(legacyUserSubscriptionLedgerMatch(ownerId) as any, {
			$set: { storageLedgerEnvelopeVersion: USER_STORAGE_LEDGER_ENVELOPE_VERSION }
		});
		if (result.modifiedCount) upgraded += 1;
		doc = await things.findOne(looseMatch);
		if (!userSubscriptionLedgerEnvelopeIsTrusted(doc, ownerId)) {
			throw new MigrationOperatorError('subscription_envelope_changed', {
				internalMessage: `Subscription ledger ${looseMatch.shareId} changed while its protected envelope was upgraded`
			});
		}
	}
	return upgraded;
};

const fenceAllStorageLedgers = async (): Promise<{ accounts: number; apps: number; appUsers: number }> => {
	const things = await getCollection('things');
	const now = new Date();
	const userIds = await currentUserIds();
	await upgradeUserSubscriptionLedgerEnvelopes(userIds);
	let accounts = 0;
	for (const ownerId of userIds) {
		const result = await things.updateOne(
			{
				...userSubscriptionLedgerMatch(ownerId),
				'crystal.storageAccountingVersion': USER_STORAGE_ACCOUNTING_VERSION
			} as any,
			{
				$set: {
					'crystal.storageLedgerStatus': USER_STORAGE_STATUS.initializing,
					'crystal.storageUpdatedAt': now
				}
			}
		);
		accounts += result.modifiedCount;
	}
	const [apps, appUsers] = await Promise.all([
		things.updateMany(
			{
				thingtime: 'app',
				'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION
			},
			{
				$set: {
					'crystal.storageLedgerStatus': USER_STORAGE_STATUS.initializing,
					'crystal.storageUpdatedAt': now
				}
			}
		),
		things.updateMany(
			{
				thingtime: 'app-storage',
				'crystal.quotaKind': 'app-storage',
				'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION
			},
			{
				$set: {
					'crystal.storageLedgerStatus': USER_STORAGE_STATUS.initializing,
					'crystal.storageUpdatedAt': now,
					updatedAt: now
				}
			}
		)
	]);
	return {
		accounts,
		apps: apps.modifiedCount,
		appUsers: appUsers.modifiedCount
	};
};

const backfillUserStorageAccounting: Migration = {
	id: 'backfill-user-storage-accounting',
	collection: 'things',
	fromVersion: THINGS_VERSION,
	toVersion: THINGS_VERSION,
	title: 'Initialize exact whole-account storage ledgers',
	description:
		'Stamps every customer-controlled Thing with the canonical UTF-8 payload byte count, then initializes ' +
		'the protected subscription ledger from those source documents. App data is included once in the account ' +
		'total. Legacy used counters are ignored; explicit legacy allowances become subscription overrides. ' +
		'Existing accounts stay fail-closed until their ledger is enabled last.',
	pending: pendingUserStorageAccounting,
	run: async ({ dryRun, assertLease }) => {
		await ensureIndexes();
		const things = await getCollection('things');
		const matched = await pendingUserStorageAccounting();
		const notes: string[] = [];
		if (dryRun) return { dryRun, matched, migrated: 0, created: 0, skipped: 0, notes };
		if (!assertLease) throw new MigrationOperatorError('lease_required');
		await assertLease();

		// Eliminate every dual-era content bypass before a whole-account ledger is
		// enabled. Each prerequisite is idempotent; running only when pending keeps
		// this migration self-contained even if an administrator selects it first.
		// Fence every already-initialized account before any legacy source can be
		// copied/converted. Normal positive writers now fail closed; deletes and
		// shrinks remain possible and conflict/retry against final reconciliation.
		// App/app-user counters overlap the account ledger. Fence every current
		// ledger before a prerequisite can copy or reclassify source content.
		let publishedComplete = false;
		try {
			const fenced = await fenceAllStorageLedgers();
			if (fenced.accounts || fenced.apps || fenced.appUsers) {
				notes.push(`${fenced.accounts} account, ${fenced.apps} app, and ${fenced.appUsers} app-user ledger(s) fenced during migration`);
			}
			await assertLease();

			for (const prerequisite of userStoragePrerequisites()) {
				await assertLease();
				const pending = await prerequisite.pending();
				if (!pending) continue;
				const report = await prerequisite.run({ dryRun: false, assertLease });
				notes.push(`${prerequisite.id}: ${report.migrated} prerequisite record(s) migrated`);
				await assertLease();
				const remaining = await prerequisite.pending();
				if (remaining) {
					throw new MigrationOperatorError('prerequisite_unresolved', {
						prerequisiteId: prerequisite.id,
						pending: remaining
					});
				}
			}

			// A later prerequisite can change an earlier migration's source view. The
			// final fixed-point check is what prevents a locally-successful sequence
			// from publishing ledgers while copy/convert work became pending again.
			await assertLease();
			const finalPrerequisitePending = await Promise.all(
				userStoragePrerequisites().map(async (prerequisite) => ({
					id: prerequisite.id,
					pending: await prerequisite.pending()
				}))
			);
			const unresolvedPrerequisite = finalPrerequisitePending.find((entry) => entry.pending > 0);
			if (unresolvedPrerequisite) {
				throw new MigrationOperatorError('prerequisite_reappeared', {
					prerequisiteId: unresolvedPrerequisite.id,
					pending: unresolvedPrerequisite.pending
				});
			}

			// Service quotas used to masquerade as user-editable `data` Things. Only an
			// exact historical envelope is replaced, from scratch, with a fully
			// consumed canonical control record. Every malformed or extended claim is
			// retained as billable quarantine content and continues to fail closed at
			// the reserved quota id.
			const legacyServiceQuotas = await migrateLegacyServiceQuotaThings(assertLease);
			notes.push(
				`${legacyServiceQuotas.rebuilt} exact legacy service quota Thing(s) conservatively rebuilt; ` +
					`${legacyServiceQuotas.quarantined} invalid claim(s) quarantined as billable content`
			);
			await assertLease();

			const ids = await currentUserIds();
			const knownUsers = new Set(ids);

			let stamped = 0;
			const cursor = things.find({ ownerId: { $type: 'string' } }).project(USER_STORAGE_ACCOUNTING_MIGRATION_PROJECTION);
			for await (const initialDoc of cursor) {
				const initialSandboxState = storageSandboxState(initialDoc as any);
				if (initialSandboxState === 'sandbox') continue;
				const ownership = storageMigrationOwnership(initialDoc as any, knownUsers);
				if (ownership === 'excluded') continue;
				if (ownership === 'unknown-user') {
					throw new MigrationOperatorError('orphan_billable_thing', {
						internalMessage: `Billable Thing ${String(initialDoc._id)} belongs to no current user`,
						diagnosticObjectIds: [String(initialDoc._id)]
					});
				}
				if (initialSandboxState === 'invalid' && initialDoc.sandboxExpiresAt !== null) {
					throw new MigrationOperatorError('invalid_sandbox_marker', {
						internalMessage: `Billable Thing ${String(initialDoc._id)} has an invalid sandbox marker`,
						diagnosticObjectIds: [String(initialDoc._id)]
					});
				}
				let doc: any = initialDoc;
				for (let attempt = 0; attempt < 3; attempt += 1) {
					if (doc.schemaVersion !== COLLECTION_SCHEMA_VERSIONS.things || !Array.isArray(doc.thingtime)) {
						throw new MigrationOperatorError('schema_prerequisite', {
							internalMessage: `Billable Thing ${String(doc._id)} requires its schema migration before storage accounting`,
							diagnosticObjectIds: [String(doc._id)]
						});
					}
					const sizeBytes = thingStorageSizeBytes(doc as any);
					if (
						doc.storageClass === 'content' &&
						doc.storageAccountingVersion === USER_STORAGE_ACCOUNTING_VERSION &&
						doc.sizeBytes === sizeBytes &&
						storageSandboxState(doc) === 'real'
					) {
						break;
					}
					const result = await things.updateOne(
						{
							_id: doc._id,
							...(doc.updatedAt instanceof Date ? { updatedAt: doc.updatedAt } : { updatedAt: { $exists: false } })
						},
						{
							$set: {
								storageClass: 'content',
								sizeBytes,
								storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION
							},
							...(doc.sandboxExpiresAt === null ? { $unset: { sandboxExpiresAt: '' } } : {})
						}
					);
					if (result.modifiedCount) {
						stamped += 1;
						break;
					}
					const fresh = await things.findOne({ _id: doc._id });
					if (!fresh || storageSandboxState(fresh as any) === 'sandbox') break;
					const freshOwnership = storageMigrationOwnership(fresh as any, knownUsers);
					if (freshOwnership === 'excluded') break;
					if (freshOwnership === 'unknown-user') {
						throw new MigrationOperatorError('unknown_owner_change', {
							internalMessage: `Billable Thing ${String(fresh._id)} changed to an unknown owner during storage migration`,
							diagnosticObjectIds: [String(fresh._id)]
						});
					}
					if (storageSandboxState(fresh as any) === 'invalid' && fresh.sandboxExpiresAt !== null) {
						throw new MigrationOperatorError('invalid_sandbox_marker', {
							internalMessage: `Billable Thing ${String(fresh._id)} has an invalid sandbox marker`,
							diagnosticObjectIds: [String(fresh._id)]
						});
					}
					doc = fresh;
					if (attempt === 2) {
						throw new MigrationOperatorError('billable_thing_churn', {
							internalMessage: `Billable Thing ${String(doc._id)} kept changing during storage migration`,
							diagnosticObjectIds: [String(doc._id)]
						});
					}
				}
			}
			await assertLease();
			// Rebuild every app and app-user sub-ledger from the exact same stamped
			// source universe before any account is published ready. The id stream is
			// the union of live app Things, persisted namespace content, and reserved
			// counters, so deleting an app can never strand its retained user data.
			let reconciledApps = 0;
			let reconciledOrphanApps = 0;
			for await (const row of registeredAppStorageIds(things)) {
				await assertLease();
				const appId = String(row._id || '');
				if (!appId) continue;
				const liveApp = await things.findOne({ thingtime: 'app', 'crystal.clientId': appId }, { projection: { _id: 1 } });
				if (liveApp) {
					// Canonicalize old deterministic counters before the strict
					// reconciliation query can touch them. Claimed values/allowances are
					// discarded; the source sum below is the only authority.
					const candidates = things.find({
						shareId: { $regex: `^${APP_STORAGE_RESERVED_ID_PREFIX}` },
						'crystal.appId': appId,
						sandboxExpiresAt: { $exists: false }
					});
					for await (const candidate of candidates) {
						await assertLease();
						const ownerId = typeof candidate.ownerId === 'string' ? candidate.ownerId : '';
						if (!ownerId || ownerId.startsWith('sandbox:')) {
							throw new MigrationOperatorError('app_counter_owner_invalid', {
								internalMessage: `Reserved app-storage counter for ${appId} has an invalid owner`
							});
						}
						await convertHistoricalAppStorageCounter(ownerId, appId);
					}
					await reconcileAppStorage(appId);
					reconciledApps += 1;
				} else {
					await reconcileOrphanAppStorage(appId);
					reconciledOrphanApps += 1;
				}
			}
			notes.push(
				`${reconciledApps} live app aggregate set(s) and ${reconciledOrphanApps} orphan namespace ledger set(s) reconciled from canonical bytes`
			);

			let initialized = 0;
			let reconciled = 0;
			let preservedAllowances = 0;
			let removedLegacyStorageFields = 0;
			for (let offset = 0; offset < ids.length; offset += 100) {
				const ownerIds = ids.slice(offset, offset + 100);
				const legacyStorageById = await findLegacyUserStorageFieldsByIds(ownerIds);
				for (const ownerId of ownerIds) {
					await assertLease();
					const match = subscriptionThingMatch('user', ownerId);
					const legacyStorage = legacyStorageById.get(ownerId);
					const legacyAllowance = legacyStorage?.storageAllowanceBytes;
					const hasLegacyAllowance = Number.isSafeInteger(legacyAllowance) && Number(legacyAllowance) >= 0;
					const hasLegacyStorageResidue =
						!!legacyStorage &&
						(Object.prototype.hasOwnProperty.call(legacyStorage, 'storageAllowanceBytes') ||
							Object.prototype.hasOwnProperty.call(legacyStorage, 'storageUsedBytes'));
					const now = new Date();
					let existing = await things.findOne(match);
					if (!existing) {
						const info = await getSubscription('user', ownerId);
						const inserted = await things.updateOne(
							match,
							{
								$setOnInsert: {
									shareId: match.shareId,
									schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
									thingtime: ['subscription'],
									crystal: {
										quotaKind: 'subscription',
										subjectType: 'user',
										subjectId: ownerId,
										tier: info.tier,
										tierVersionId: info.tierVersionId,
										tierVersion: info.tierVersion,
										tierName: info.tierName,
										tierMetered: info.metered,
										tierQuotas: info.effective,
										overrides: hasLegacyAllowance ? { userStorageBytes: Number(legacyAllowance) } : info.overrides,
										note: info.note,
										updatedBy: info.updatedBy,
										isDefaultAssignment: info.isDefault,
										storageUsedBytes: 0,
										storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
										storageLedgerStatus: USER_STORAGE_STATUS.initializing,
										storageUpdatedAt: now
									},
									ownerId,
									acl: [ACL_OWNER],
									targetId: null,
									tags: [],
									storageLedgerEnvelopeVersion: USER_STORAGE_LEDGER_ENVELOPE_VERSION,
									createdAt: now,
									updatedAt: now
								}
							},
							{ upsert: true }
						);
						if (inserted.upsertedCount) {
							initialized += 1;
							if (hasLegacyAllowance) preservedAllowances += 1;
						}
						existing = await things.findOne(match);
						if (!existing) {
							throw new MigrationOperatorError('subscription_init_failed', {
								internalMessage: `Subscription ledger for ${ownerId} could not be initialized`
							});
						}
					}
					if (!userSubscriptionLedgerEnvelopeIsTrusted(existing, ownerId)) {
						throw new MigrationOperatorError('subscription_envelope_invalid', {
							internalMessage: `Subscription ledger ${match.shareId} has an invalid protected envelope`
						});
					}

					const overrideWasAbsent =
						hasLegacyAllowance &&
						(!existing.crystal?.overrides ||
							typeof existing.crystal.overrides !== 'object' ||
							!Object.prototype.hasOwnProperty.call(existing.crystal.overrides, 'userStorageBytes'));
					const setStage: Record<string, unknown> = {
						'crystal.storageAccountingVersion': USER_STORAGE_ACCOUNTING_VERSION,
						'crystal.storageLedgerStatus': USER_STORAGE_STATUS.initializing,
						'crystal.storageUpdatedAt': now,
						updatedAt: now
					};
					if (hasLegacyAllowance) {
						setStage['crystal.overrides'] = {
							$cond: [
								{ $eq: [{ $type: '$crystal.overrides.userStorageBytes' }, 'missing'] },
								{
									$mergeObjects: [
										{
											$cond: [{ $eq: [{ $type: '$crystal.overrides' }, 'object'] }, '$crystal.overrides', {}]
										},
										{ userStorageBytes: Number(legacyAllowance) }
									]
								},
								'$crystal.overrides'
							]
						};
					}
					await things.updateOne(userSubscriptionLedgerMatch(ownerId) as any, [{ $set: setStage }]);
					if (overrideWasAbsent) preservedAllowances += 1;
					// Reconciliation is the only operation that publishes ready. Every
					// owner is reconciled on every run, including ledgers that were ready
					// before prerequisites stamped or removed content.
					await reconcileUserStorage(ownerId);
					if (hasLegacyStorageResidue) {
						await removeLegacyUserStorageFields(ownerId);
						removedLegacyStorageFields += 1;
					}
					reconciled += 1;
				}
			}

			await assertLease();
			const unfinished = await pendingUserStorageAccounting();
			if (unfinished) {
				throw new MigrationOperatorError('pending_storage_records', { pending: unfinished });
			}

			notes.push(`${stamped} billable Thing(s) stamped with canonical bytes`);
			notes.push(`${initialized} account ledger(s) initialized; ${reconciled} transactionally reconciled`);
			notes.push(`${preservedAllowances} explicit legacy allowance(s) preserved as subscription overrides`);
			notes.push(
				`${removedLegacyStorageFields} legacy user storage field set(s) removed after handoff; ` +
					'storageUsedBytes values were ignored because they were never maintained'
			);
			publishedComplete = true;
			return { dryRun, matched, migrated: stamped + reconciled, created: initialized, skipped: 0, notes };
		} finally {
			if (!publishedComplete) {
				// This invariant lives inside the migration as well as its API wrapper:
				// tests, future orchestrators, or an internal caller must not be able
				// to observe a partially-published ready ledger after any late error.
				await fenceAllStorageLedgers().catch(() => {});
			}
		}
	}
};

const mergeLegacyCollections: Migration = {
  id: 'merge-legacy-collections',
  collection: 'all',
  fromVersion: 0,
  toVersion: 0,
  title: 'Merge leftover legacy collections into their versioned successors',
  description:
    'Adoption renames each unversioned legacy collection (things → things_v2) in place on first ' +
    'db contact. When that rename was not possible — the db tier does not allow renameCollection ' +
    '(Atlas M0), or writes had already landed in the versioned collection — this migration copies ' +
    'every leftover legacy doc into the current generation by _id: insert-if-absent, so a doc ' +
    'already copied (or newer, written post-deploy) is never overwritten, and a doc blocked by a ' +
    'unique index (a post-deploy write claimed its username/email/token) is skipped and noted — ' +
    'the versioned collection wins. Legacy collections are never deleted here: they stay behind ' +
    'as frozen snapshots until drop-stale-collection-generations removes them.',
  pending: async () => {
    const residue = await legacyResidue();
    return residue.reduce((sum, row) => sum + row.missing, 0);
  },
	run: async ({ dryRun, assertLease }) => {
    await ensureIndexes();
    const db = await getThingtimeDb();
    const notes = makeNotes();
    const residue = await legacyResidue();
    const matched = residue.reduce((sum, row) => sum + row.missing, 0);

    if (dryRun) {
      for (const row of residue) {
        notes.push(`${row.physical}: ${row.missing} doc(s) would be copied to ${physicalCollectionName(row.collection)}`);
      }
      return { dryRun, matched, migrated: 0, created: 0, skipped: 0, notes: notes.list() };
    }

    let created = 0;
    let skipped = 0;
		let alreadyConverted = 0;

    for (const row of residue) {
			await assertLease?.();
      if (!row.missing) continue;
      const legacy = db.collection(row.physical);
      const destinationName = physicalCollectionName(row.collection);
			const destination = db.collection(destinationName);
			const cursor = legacy.aggregate([
          {
            $lookup: { from: destinationName, localField: '_id', foreignField: '_id', as: 'copied' }
          },
          { $match: { copied: { $size: 0 } } },
				{ $project: { copied: 0 } }
			]);
			for await (const doc of cursor) {
				await assertLease?.();
				if (await legacyRowHasConvertedThing(row.collection, doc, db.collection(physicalCollectionName('things')))) {
					alreadyConverted += 1;
					continue;
				}
        try {
					await destination.insertOne(doc);
					created += 1;
        } catch (err: any) {
					if (err?.code !== 11000) throw err;
					// A concurrent copier may have won this exact _id. Only a duplicate
					// held elsewhere is unresolved and remains visible in pending().
					if (await destination.findOne({ _id: doc._id }, { projection: { _id: 1 } })) continue;
            skipped += 1;
					notes.push(`${row.physical}: one doc blocked by a unique key — versioned collection wins`);
          }
        }
      }

		if (alreadyConverted) {
			notes.push(`${alreadyConverted} frozen legacy snapshot doc(s) already had verified Things-era successors`);
    }

    return { dryRun, matched, migrated: created, created, skipped, notes: notes.list() };
  }
};

const dropStaleCollectionGenerations: Migration = {
  id: 'drop-stale-collection-generations',
  collection: 'all',
  fromVersion: 0,
  toVersion: 0,
  destructive: true,
  title: 'Drop superseded collection generations',
  description:
    'THE delete step of collection versioning — removes physical collections the code no longer ' +
    'reads: unversioned legacy collections (things) and generations below the current version ' +
    '(things_v1 once the code is on things_v2). A collection is dropped only when nothing still ' +
    'needs it: a legacy collection must have zero unmerged docs (merge-legacy-collections is the ' +
    'source of truth), and any generation a registered migration still reads from (sourcePhysicals) ' +
    'is kept until that migration reports zero pending. Unknown collections and generations ABOVE ' +
    'the current version (a rolled-back deploy) are never touched. Dry-run lists every candidate ' +
    'with its doc count; the real run requires confirm: true. Run it only after the deploy has ' +
    'settled — instances still on pre-versioning code write to the legacy names.',
  pending: async () => {
    const db = await getThingtimeDb();
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry: any) => entry.name);
    const stale = classifyPhysicalCollections(names).filter((row) => row.stale);
    if (!stale.length) return 0;
    const residue = await legacyResidue();
    const unmerged = new Map(residue.map((row) => [row.physical, row.missing]));
    let count = 0;
    for (const row of stale) {
      if (row.version === null && (unmerged.get(row.physical) ?? 0) > 0) continue;
      if (await staleGenerationBlocker(row.physical)) continue;
      count += 1;
    }
    return count;
  },
  run: async ({ dryRun }) => {
    const db = await getThingtimeDb();
    const notes = makeNotes();
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry: any) => entry.name);
    const stale = classifyPhysicalCollections(names).filter((row) => row.stale);
    const residue = await legacyResidue();
    const unmerged = new Map(residue.map((row) => [row.physical, row.missing]));

    let dropped = 0;
    let skipped = 0;

    for (const row of stale) {
      const docs = await db.collection(row.physical).estimatedDocumentCount();
			const missing = row.version === null ? unmerged.get(row.physical) ?? 0 : 0;
      if (missing > 0) {
        notes.push(`${row.physical}: kept — ${missing} doc(s) not yet merged (run merge-legacy-collections)`);
        skipped += 1;
        continue;
      }
      const blocker = await staleGenerationBlocker(row.physical);
      if (blocker) {
        notes.push(`${row.physical}: kept — migration ${blocker} still reads it and has pending work`);
        skipped += 1;
        continue;
      }
      if (dryRun) {
        notes.push(`${row.physical}: ${docs} doc(s) — would be dropped`);
        continue;
      }
      await db.dropCollection(row.physical);
      notes.push(`${row.physical}: ${docs} doc(s) — dropped`);
      dropped += 1;
    }

    return { dryRun, matched: stale.length, migrated: dropped, created: 0, skipped, notes: notes.list() };
  }
};

// Does a registered migration still READ this stale physical collection while
// having pending work? Cleanup keeps the collection until that migration is
// done. (Declared via sourcePhysicals on future copy-forward migrations.)
const staleGenerationBlocker = async (physical: string): Promise<string | null> => {
  for (const migration of migrations) {
    const sources = migration.sourcePhysicals?.() || [];
    if (!sources.includes(physical)) continue;
    if ((await migration.pending()) > 0) return migration.id;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Relationship uniqueKeys backfill. Relationship dedupe moved off the
// kind-blind crystal-path unique indexes (squattable through free-form data
// crystals — see KIND-BLIND HISTORY in collections.ts) onto the
// server-only root uniqueKeys namespace. New docs stamp at insert
// (messenger/shared.ts newThingDoc + the friend writer); this stamps legacy
// docs so their create-race dedupe is structural again, and counts (never
// touches) data things carrying a relationship-shaped name. Before phase 2
// that is the squat census; after the namespace reopens it may be intentional
// ordinary data and remains operator information only.

const relationshipBackfillTargets = (): Array<{ kind: string; field: string }> =>
	Object.entries(RELATIONSHIP_UNIQUE_CRYSTAL_KEYS).map(([kind, field]) => ({ kind, field }));

const relationshipBackfillFilter = (kind: string, field: string) =>
	({ thingtime: kind, [`crystal.${field}`]: { $type: 'string' }, uniqueKeys: { $exists: false } }) as any;

const backfillRelationshipUniqueKeys: Migration = {
	id: 'backfill-relationship-unique-keys',
	collection: 'things',
	fromVersion: THINGS_VERSION,
	toVersion: THINGS_VERSION,
	title: 'Backfill relationship uniqueKeys (follow/member/DM/invite/emoji/friend/vote/passkey link)',
	description:
		'Stamps the server-only root uniqueKeys dedupe entry (`<field>:<key>` BinData) onto legacy relationship ' +
		'things whose uniqueness previously rode kind-blind crystal-path unique indexes (retired to lookup ' +
		'indexes by the boot-time ensure). Idempotent: stamps are deterministic and only docs without ' +
		'uniqueKeys are touched. Also counts — never modifies — free-form data things carrying a relationship ' +
		'name at the crystal root: operator census only, because phase 2 makes those names valid ordinary data. ' +
		'Targets are read from the relationship map, so a family that joins later (passkey-app-link, which ' +
		'shipped mid-migration with its own crystal-path unique index) is covered by re-running this.',
	pending: async () => {
		const things = await getCollection('things');
		let total = 0;
		for (const { kind, field } of relationshipBackfillTargets()) {
			total += await things.countDocuments(relationshipBackfillFilter(kind, field));
		}
		return total;
	},
	run: async ({ dryRun, assertLease }) => {
		const things = await getCollection('things');
		const notes: string[] = [];
		let matched = 0;
		let migrated = 0;
		let skipped = 0;
		for (const { kind, field } of relationshipBackfillTargets()) {
			const filter = relationshipBackfillFilter(kind, field);
			const kindMatched = await things.countDocuments(filter);
			matched += kindMatched;
			if (dryRun || !kindMatched) continue;
			let kindMigrated = 0;
			while (true) {
				await assertLease?.();
				const batch = await things.find(filter).project({ shareId: 1, crystal: 1 }).limit(THINGS_BATCH).toArray();
				if (!batch.length) break;
				for (const doc of batch) {
					const uniqueKeys = relationshipUniqueKeys(kind, doc.crystal);
					if (!uniqueKeys) {
						skipped += 1;
						continue;
					}
					try {
						await things.updateOne({ shareId: doc.shareId, uniqueKeys: { $exists: false } } as any, { $set: { uniqueKeys } } as any);
						kindMigrated += 1;
					} catch (err: any) {
						if (err?.code !== 11000) throw err;
						// The slot is already held by another doc — a twin from the
						// pre-unique-index era. Leave it unstamped for operator review;
						// guessing a winner here could delete a real relationship.
						skipped += 1;
						notes.push(`duplicate ${kind} ${field} slot left unstamped: ${doc.shareId}`);
					}
				}
				if (batch.length < THINGS_BATCH) break;
			}
			migrated += kindMigrated;
			if (kindMigrated) notes.push(`${kindMigrated} ${kind} doc(s) stamped`);
		}
		const relationshipFields = Array.from(new Set(Object.values(RELATIONSHIP_UNIQUE_CRYSTAL_KEYS)));
		for (const field of relationshipFields) {
			await assertLease?.();
			const count = await things.countDocuments({ thingtime: 'data', [`crystal.${field}`]: { $exists: true } } as any);
			if (count) {
				notes.push(
					`${count} data thing(s) carry crystal.${field} at the root (operator census only — never modified; valid ordinary data after phase 2)`
				);
			}
		}
		return { dryRun, matched, migrated, created: 0, skipped, notes };
	}
};

export const migrations: Migration[] = [
	// Physical residue must land in the current generation before any logical
	// shape or byte-ledger migration can declare its source universe complete.
	mergeLegacyCollections,
  thingsMigration,
  usersToThings,
  themesToThings,
  feedAlgorithmsToThings,
  waitlistToThings,
  seedBuiltinSchemas,
  stampMigration('users', 'User docs already match the v2 shape — stamps schemaVersion.'),
  stampMigration('sessions', 'Session docs already match the v2 shape — stamps schemaVersion.'),
  stampMigration('emailVerifications', 'Email verification docs already match the v2 shape — stamps schemaVersion.'),
  stampMigration('themes', 'Theme docs already match the v2 shape — stamps schemaVersion.'),
  stampMigration('waitlist', 'Waitlist docs already match the v2 shape — stamps schemaVersion.'),
  stampMigration('feedAlgorithms', 'Feed algorithm docs already match the v2 shape — stamps schemaVersion.'),
	stampMigration('lopuMusingRateLimits', 'Stamps schemaVersion on both rate-limit shapes (musing sliding windows and waitlist counters).'),
  backfillAppNamespaceFields,
  backfillAppStorageAllowances,
	backfillUserStorageAccounting,
	backfillRelationshipUniqueKeys,
  dropStaleCollectionGenerations
];

export const getMigration = (id: unknown): Migration | null =>
  typeof id === 'string' ? migrations.find((migration) => migration.id === id.trim()) || null : null;

export type CollectionVersionStatus = {
  collection: string;
  physical: string;
  currentVersion: number;
  total: number;
  versions: Record<string, number>;
  pendingMigrations: string[];
};

// One physical collection on the server, classified against the registry: the
// storage-generation view behind "which collections can I safely delete".
export type CollectionGenerationStatus = {
  collection: string;
  physical: string;
  version: number | null;
  docs: number;
  current: boolean;
  stale: boolean;
};

// Per-collection version census + storage generations + which registered
// migrations still have work.
export const getMigrationStatus = async (): Promise<{
  collections: CollectionVersionStatus[];
  generations: CollectionGenerationStatus[];
  adoptionIssues: string[];
  migrations: Array<
    Pick<Migration, 'id' | 'collection' | 'fromVersion' | 'toVersion' | 'title' | 'description'> & {
      pending: number;
      destructive: boolean;
    }
  >;
}> => {
  const db = await getThingtimeDb();

  const collections = await Promise.all(
    COLLECTIONS.map(async (collection) => {
      const rows = (await getCollection(collection).then((target) =>
				target.aggregate([{ $group: { _id: { $ifNull: ['$schemaVersion', LEGACY_SCHEMA_VERSION] }, count: { $sum: 1 } } }]).toArray()
      )) as any[];
      const versions: Record<string, number> = {};
      let total = 0;
      rows.forEach((row) => {
        versions[String(row._id)] = row.count;
        total += row.count;
      });
      return {
        collection,
        physical: physicalCollectionName(collection),
        currentVersion: collectionVersion(collection),
        total,
        versions,
        pendingMigrations: [] as string[]
      };
    })
  );

  // every physical collection the server actually has, current or stale — the
  // admin sees exactly what cleanup would drop before running it
  const physicalNames = (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry: any) => entry.name);
  const generations = await Promise.all(
    classifyPhysicalCollections(physicalNames).map(async (row) => ({
      collection: row.collection,
      physical: row.physical,
      version: row.version,
      docs: await db.collection(row.physical).estimatedDocumentCount(),
      current: row.current,
      stale: row.stale
    }))
  );
  generations.sort((a, b) => a.collection.localeCompare(b.collection) || (a.version ?? 0) - (b.version ?? 0));

  // Adoption issues are derived LIVE from what actually exists right now — a
  // legacy collection merged and dropped since boot must not keep a stale
  // warning up. The boot-time pass only contributes the rename-failure REASON
  // for legacy collections that are still present.
  const renameFailures = new Map(
    getAdoptionIssues().flatMap((issue) => (issue.includes('rename to') ? [[issue.split(':')[0], issue] as const] : []))
  );
  const adoptionIssues = generations
    .filter((generation) => generation.version === null)
    .map(
      (generation) =>
        renameFailures.get(generation.collection) ||
				`${generation.collection}: legacy collection still exists beside ${physicalCollectionName(
					generation.collection
				)} — run merge-legacy-collections`
    );

  const withPending = await Promise.all(
    migrations.map(async (migration) => ({
      id: migration.id,
      collection: migration.collection,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      title: migration.title,
      description: migration.description,
      destructive: !!migration.destructive,
      pending: await migration.pending()
    }))
  );

  withPending.forEach((migration) => {
    if (!migration.pending) return;
    const status = collections.find((entry) => entry.collection === migration.collection);
    if (status) status.pendingMigrations.push(migration.id);
  });

  return { collections, generations, adoptionIssues, migrations: withPending };
};

export const runMigration = async (
  id: unknown,
  options: { dryRun?: unknown; confirm?: unknown }
): Promise<Fail | MigrationFailure | { ok: true; migration: string; report: MigrationReport }> => {
  const migration = getMigration(id);
  if (!migration) return fail(404, 'Unknown migration');
  const dryRun = options.dryRun === true || options.dryRun === 'true';
  // destructive migrations (collection drops) never run on an unconfirmed
  // call — a mis-sent id can cost data, so the API demands intent twice
  if (migration.destructive && !dryRun && options.confirm !== true) {
    return fail(400, `Migration ${migration.id} drops data — pass confirm: true to run it`);
  }
	if (dryRun) {
		try {
			const report = await migration.run({ dryRun: true });
			return { ok: true, migration: migration.id, report };
		} catch (error) {
			// Dry runs never mutate migration target documents, so an exception is
			// a known rejection rather than an ambiguous mutation outcome. Some
			// runners may still bootstrap database indexes before their read pass.
			return migrationFailureResult(migration.id, error, 'rejected');
		}
	}

	let lease: Awaited<ReturnType<typeof acquireMigrationLease>>;
	try {
		lease = await acquireMigrationLease(migration.id);
	} catch (error) {
		return migrationFailureResult(migration.id, error, 'rejected');
	}
	if (!lease) return fail(409, 'Another database migration is already running; wait for it to finish and refresh');
	let migrationStarted = false;
	try {
		await lease.assert();
		if (migration.id !== backfillUserStorageAccounting.id && new Set(userStoragePrerequisites().map((entry) => entry.id)).has(migration.id)) {
			const things = await getCollection('things');
			// Do not predicate this safety gate on a pre-run pending snapshot. New
			// legacy residue can arrive between pending() and run(); if any
			// overlapping ledger is authoritative, only the orchestrated storage
			// migration may fence first and mutate source data afterward.
			const [readyAccounts, readyApps, readyAppUsers] = await Promise.all([
				things.countDocuments(
					{
						thingtime: 'subscription',
						'crystal.subjectType': 'user',
						'crystal.storageAccountingVersion': USER_STORAGE_ACCOUNTING_VERSION,
						'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready
					},
					{ limit: 1 }
				),
				things.countDocuments(
					{
						thingtime: 'app',
						'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION,
						'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready
					},
					{ limit: 1 }
				),
				things.countDocuments(
					{
						thingtime: 'app-storage',
						'crystal.quotaKind': 'app-storage',
						'crystal.storageAccountingVersion': APP_STORAGE_ACCOUNTING_VERSION,
						'crystal.storageLedgerStatus': USER_STORAGE_STATUS.ready
					},
					{ limit: 1 }
				)
			]);
			if (readyAccounts || readyApps || readyAppUsers) {
				return fail(
					409,
					`Migration ${migration.id} can change billable source data while storage ledgers are live. ` +
						`Run ${backfillUserStorageAccounting.id}; it fences, migrates, and reconciles every overlapping ledger safely.`
				);
			}
		}
		await lease.assert();
		migrationStarted = true;
		const report = await migration.run({ dryRun: false, assertLease: lease.assert });
		await lease.assert();
		return { ok: true, migration: migration.id, report };
	} catch (error) {
		if (migrationStarted && migration.id === backfillUserStorageAccounting.id) {
			// A late postflight/lease failure must never leave the ledgers that were
			// already reconciled earlier in the sweep looking authoritative. This
			// fence is monotonic-safe even if a successor has begun: it can only
			// remove readiness, never publish a stale total.
			await fenceAllStorageLedgers().catch(() => {});
		}
		return migrationFailureResult(migration.id, error, migrationStarted ? 'unknown' : 'rejected');
	} finally {
		await lease.release();
	}
};
