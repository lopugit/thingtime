import { subspaceMessagingMigration } from './subspaceMessaging';
import { accidentalCatalogAccountMigration } from './accidentalCatalogAccount';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  ensureHomeThingsIndexPlan,
  withHomeIndexMaintenance,
  isHomeIndexRecoveryActive,
  ensureIndexes,
  getAdoptionIssues,
  getCiControlCollection,
  getCollection,
  getHomeThingsCollection,
  getHomeThingtimeDb,
  getSettingsCollection,
  invalidateHomeRelationshipKeys,
  getThingtimeDb,
  thingsIndexPlanNames,
  withMongoTransaction
} from '../mongodb/collections';
import { COLLECTIONS, classifyPhysicalCollections, collectionVersion, physicalCollectionName } from '../mongodb/collectionNames';
import { safeErrorText } from '../errors/safeError';
import { reactionShareId } from '../things/things';
import { buildUserSecure, packRecentReactions, toBin, unpackSecure, userEmailKey, userUsernameKey } from '../auth/users';
import { getSecureFieldsConfig } from '../secureFields/config';
import { waitlistEmailKey } from '../waitlist/waitlist';
import { externalPostSourceKey, externalPostSourceShareId } from '../connections/connections';
import { RELATIONSHIP_UNIQUE_CRYSTAL_KEYS } from '../messenger/shared';
import { repairRelationshipKeys } from './relationshipKeys';
import { migrateRelationshipIndexLayout } from '../mongodb/relationshipIndexLayout';
import { migrateLegacyThingIndexLayout } from '../mongodb/legacyThingLayout';
import { themeAcl } from '../themes/themes';
import {
	builtinSchemaSeedNeedsRefresh,
	bulkWriteErrorCodesByOp,
	conversionBuildOutcomes,
	exactDocumentSnapshotMatch,
	storageMigrationOwnership,
	upsertedOpIndexes
} from './migrationCore';
import { MigrationOperatorError, migrationFailureResult, type MigrationFailure } from './migrationFailure';
import { getSubscription } from '../subscriptions/subscriptions';
import {
	legacyUserSubscriptionLedgerEnvelopeCanUpgrade,
	legacyUserSubscriptionLedgerMatch,
	subscriptionThingMatch,
	userSubscriptionLedgerEnvelopeIsTrusted,
	userSubscriptionLedgerEnvelopeIssues,
	userSubscriptionLedgerMatch
} from '../subscriptions/subscriptionIdentity';
import {
	InvalidAttachmentStorageEnvelopeError,
	USER_STORAGE_ACCOUNTING_VERSION,
	USER_STORAGE_STATUS,
	storageSandboxState,
	thingStorageSizeBytes
} from '../storage/storageCore';
import { reconcileUserStorage, userStorageAllowanceIsValid } from '../storage/userStorage';
import {
  ACL_ALL,
  ACL_EXTACCT_PREFIX,
  ACL_EXT_SOURCED,
  ACL_INHERIT,
  ACL_OWNER,
  APP_STORAGE_ACCOUNTING_VERSION,
  APP_STORAGE_RESERVED_ID_PREFIX,
  CI_CONTROL_THINGTIME,
  COLLECTION_SCHEMA_VERSIONS,
  LEGACY_SCHEMA_VERSION,
  USER_STORAGE_LEDGER_ENVELOPE_VERSION,
  aclFromVisibility,
  projectBuiltinSchemaCrystal,
  thingtimeSchemas,
  validateThingtimeCrystal
} from '~/schemas/registry';
import { relocateCiControlRows, rebuildPlanIndexes } from './ciControlRelocationCore';

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
	timelineEnvelopeVersion: 1,
	secure: 1,
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
	if (!isHomeIndexRecoveryActive()) await ensureIndexes();
	const settings = await getSettingsCollection();
	// Authenticated repair must remain reachable when an unrelated unique index
	// cannot build, but the existing migration lease still needs its own constraint.
	if (isHomeIndexRecoveryActive()) await settings.createIndex({ key: 1 }, { unique: true, maxTimeMS: 15_000 });
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

// Everything the receipt decision needs; `key` is carried so a batched read can
// map each row back to the source it certifies.
const CONVERSION_RECEIPT_PROJECTION = { key: 1, sourceUpdatedAtMs: 1, sourceDigest: 1, destinationShareId: 1 };

// Does an ALREADY-FETCHED receipt certify this exact source snapshot? Pure, so
// the single-doc and batched lookups below cannot drift apart in what they
// accept — the two are read by the same consume phase and disagreement would
// mean deleting a legacy source on weaker proof in one path than the other.
export const conversionReceiptCovers = (receipt: any, source: any): boolean => {
	if (!receipt || typeof receipt.destinationShareId !== 'string') return false;
	const sourceTime = sourceUpdatedAtMs(source);
	return sourceTime !== null && Number.isFinite(receipt.sourceUpdatedAtMs)
		? Number(receipt.sourceUpdatedAtMs) >= sourceTime
		: receipt.sourceDigest === migrationSourceDigest(source);
};

const hasCollectionConversionReceipt = async (collection: string, source: any): Promise<boolean> => {
	const receipt = await (
		await getSettingsCollection()
	).findOne(
		{ key: migrationReceiptKey(collection, source._id), sourceCollection: collection },
		{ projection: CONVERSION_RECEIPT_PROJECTION }
	);
	return conversionReceiptCovers(receipt, source);
};

// Batched form of the lookup above: one `key: { $in: [...] }` read resolves a
// whole page's receipts against the unique `settings.key` index, instead of one
// findOne per surviving document.
//
// Safe to hoist out of the per-doc loop because the receipt key derives ONLY
// from (collection, source._id) — identical for a page-query snapshot and its
// consume-phase re-read — and because receipts are only ever upserted, never
// deleted or revoked. So a page-old snapshot can miss a receipt a concurrent
// runner just wrote, but can never invent one: a miss falls through to the
// stricter semantic-equality path, which is the same direction every other
// batched read here already fails. The freshness comparison itself stays
// per-document, run against the exact snapshot being judged.
const findCollectionConversionReceipts = async (collection: string, sourceIds: any[]): Promise<Map<string, any>> => {
	if (!sourceIds.length) return new Map();
	const sourceIdByKey = new Map(sourceIds.map((id) => [migrationReceiptKey(collection, id), String(id)]));
	const receipts = (await (
		await getSettingsCollection()
	)
		.find({ key: { $in: [...sourceIdByKey.keys()] }, sourceCollection: collection }, { projection: CONVERSION_RECEIPT_PROJECTION })
		.toArray()) as any[];
	const bySourceId = new Map<string, any>();
	for (const receipt of receipts) {
		const sourceId = sourceIdByKey.get(String(receipt?.key));
		if (sourceId !== undefined) bySourceId.set(sourceId, receipt);
	}
	return bySourceId;
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
  // batched form of findExisting: given the whole page of built candidates,
  // return each one's existing counterpart (or null) in ONE query so the
  // non-deterministic path costs O(pages) reads instead of O(docs). Falls back
  // to per-doc findExisting when a spec doesn't provide it.
  findExistingMany?: (
    things: any,
    candidates: { doc: any; thing: Record<string, any> }[]
  ) => Promise<(any | null)[]>;
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

    // Batch through the legacy collection ONE ~CONVERT_BATCH page at a time,
    // batching every Mongo step that can batch without weakening a guard: the
    // claim is one bulk write and the consume-phase source/destination re-reads
    // are one query each, so a ~50k collection is O(pages) round trips for
    // those steps instead of O(docs) × 3-4. The receipt-verified consume of
    // each survivor (CAS repair, exact-snapshot delete, receipt write) stays
    // per-doc — a conversion receipt may only certify a delete that verifiably
    // landed. Every guard the per-doc path had is preserved — only the
    // batching around it changed.
    //
    // Collided/malformed docs stay put and would re-match the page query
    // forever, so exclude the ones skipped this run.
    const skippedIds: any[] = [];
    const skip = (doc: any, reason: string) => {
      notes.push(`${spec.collection} ${spec.label(doc)}: ${reason}`);
      skipped += 1;
      skippedIds.push(doc._id);
    };

    for (;;) {
			await assertLease?.();
      const filter = skippedIds.length ? { _id: { $nin: skippedIds } } : {};
			const batch = (await legacy
				.find(filter as any)
				.limit(CONVERT_BATCH)
				.toArray()) as any[];
      if (!batch.length) break;

      // Phase 1 — BUILD every destination thing (pure, no I/O). A malformed doc
      // is skipped + noted exactly as the per-doc path did, and so is one whose
      // conversion THROWS: the per-doc loop built inside its try/catch, and
      // losing that isolation would let a single corrupt legacy row abort the
      // whole run before it ever reaches skippedIds (see conversionBuildOutcomes).
      const candidates: { doc: any; thing: Record<string, any> }[] = [];
      for (const outcome of conversionBuildOutcomes(batch, spec.toThing)) {
        // `=== false`, not `!outcome.ok`: this tsconfig runs with
        // strictNullChecks off, where truthiness does NOT narrow a boolean
        // discriminant (the same reason the old build read `'reason' in built`)
        if (outcome.ok === false) {
          skip(outcome.doc, `${outcome.reason} — left for a later re-run`);
          continue;
        }
        candidates.push({ doc: outcome.doc, thing: outcome.thing });
      }
      // Every doc on this page was malformed → all now in skippedIds; the next
      // page query excludes them and eventually returns empty. Guard against a
      // no-progress spin only if the whole page skipped (candidates empty).
      if (!candidates.length) continue;

      // Per-candidate outcome of the CLAIM phase, aligned to `candidates`:
      //  inserted[i] — a fresh doc we created (genuinely ours by construction)
      //  twins[i]    — a verified genuine prior-run counterpart at the destination
      //  done[i]     — skipped in this phase (collision/error), excluded below
      const inserted = new Array<boolean>(candidates.length).fill(false);
      const twins = new Array<any>(candidates.length).fill(null);
      const done = new Array<boolean>(candidates.length).fill(false);

      if (spec.findExisting) {
        // Non-deterministic shareId (waitlist mints uuids): the unique uniqueKeys
        // index is the identity, so we can't upsert on shareId. Locate existing
        // twins in one batched read when the spec supports it, else per-doc.
        const existingTwins = spec.findExistingMany
          ? await spec.findExistingMany(things, candidates)
          : await (async () => {
              const out: (any | null)[] = [];
              for (const c of candidates) out.push(await spec.findExisting!(things, c.doc, c.thing));
              return out;
            })();
        existingTwins.forEach((twin, i) => {
          if (twin) twins[i] = twin;
        });

        // Insert the ones with no twin in a single unordered bulk insert; the
        // unique uniqueKeys index dedupes concurrent/partial runs.
        const toInsert = candidates.map((c, i) => ({ c, i })).filter(({ i }) => !twins[i]);
        if (toInsert.length) {
          try {
            await things.bulkWrite(
              toInsert.map(({ c }) => ({ insertOne: { document: c.thing } })) as any,
              { ordered: false }
            );
            toInsert.forEach(({ i }) => {
              inserted[i] = true;
            });
          } catch (err: any) {
            // position in toInsert → code (the ops array IS toInsert here)
            const failed = bulkWriteErrorCodesByOp(err);
            if (!failed) throw err; // not a per-op bulk failure
            // Inserts are all-or-nothing per op, so absence from the error map
            // IS the success signal — unlike the upsert branch below, where a
            // non-failing op may have merely matched an existing doc.
            toInsert.forEach(({ i }, pos) => {
              if (!failed.has(pos)) inserted[i] = true;
            });
            // A per-doc fallback ONLY for genuine conflicts: a unique key already
            // held. If it's OUR counterpart (uniqueKeys race), re-read + let the
            // genuine check below decide; a foreign holder is skipped for a later
            // re-run. A non-11000 error is a generic per-doc conversion error.
            for (const [pos, code] of failed) {
              const { c, i } = toInsert[pos];
              if (code !== 11000) {
                skip(c.doc, 'conversion error — left for a later re-run');
                done[i] = true;
                continue;
              }
              const twin = await spec.findExisting!(things, c.doc, c.thing);
              if (twin) twins[i] = twin;
              else {
                skip(c.doc, 'unique key held by a foreign doc — left for a later re-run');
                done[i] = true;
              }
            }
          }
        }

        // Anything not freshly inserted must sit at a genuine twin, or it's a
        // foreign doc squatting our unique key.
        candidates.forEach((c, i) => {
          if (inserted[i] || done[i]) return;
          if (!twins[i] || !spec.isGenuine(twins[i], c.doc, c.thing)) {
            skip(c.doc, 'destination id held by a foreign doc — left for a later re-run');
            done[i] = true;
          }
        });
      } else {
        // Deterministic destination shareId: ONE unordered bulk upsert atomically
        // CLAIMS every id. upsertedIds tells us which we created (genuinely ours
        // by construction); every other candidate already existed (or hit a
        // unique key) and is verified by a single re-read below.
        const ops = candidates.map((c) => ({
          updateOne: { filter: { shareId: c.thing.shareId }, update: { $setOnInsert: c.thing }, upsert: true }
        }));
        const errorCodes = new Map<number, number>(); // op index → write-error code
        try {
          const res: any = await things.bulkWrite(ops as any, { ordered: false });
          for (const i of upsertedOpIndexes(res)) inserted[i] = true;
        } catch (err: any) {
          const codes = bulkWriteErrorCodesByOp(err);
          if (!codes) throw err; // not a per-op bulk failure
          // Unordered: the non-failing ops still applied — recover their upserts.
          for (const i of upsertedOpIndexes(err?.result)) inserted[i] = true;
          for (const [i, code] of codes) errorCodes.set(i, code);
        }

        // Non-11000 failures are generic per-doc errors (the per-doc path threw
        // to its outer catch → skip); isolate them to that doc.
        for (const [i, code] of errorCodes) {
          if (code !== 11000 && !inserted[i]) {
            skip(candidates[i].doc, 'conversion error — left for a later re-run');
            done[i] = true;
          }
        }

        // One re-read for every not-inserted candidate closes the genuine check:
        // a prior-run twin (same owner/target per spec.isGenuine) is kept; an id
        // with NO doc after an 11000 means a foreign doc holds one of our OTHER
        // unique keys (uniqueKeys); a non-genuine holder squats the id.
        const pending = candidates.map((c, i) => ({ c, i })).filter(({ i }) => !inserted[i] && !done[i]);
        if (pending.length) {
          const found = (await things
            .find({ shareId: { $in: pending.map(({ c }) => c.thing.shareId) } } as any)
            .toArray()) as any[];
          const byShareId = new Map(found.map((t) => [String(t.shareId), t]));
          for (const { c, i } of pending) {
            const twin = byShareId.get(String(c.thing.shareId)) ?? null;
            if (!twin) {
              skip(
                c.doc,
                errorCodes.get(i) === 11000
                  ? 'unique key held by a foreign doc — left for a later re-run'
                  : 'destination id held by a foreign doc — left for a later re-run'
              );
              done[i] = true;
              continue;
            }
            if (!spec.isGenuine(twin, c.doc, c.thing)) {
              skip(c.doc, 'destination id held by a foreign doc — left for a later re-run');
              done[i] = true;
              continue;
            }
            twins[i] = twin;
          }
        }
      }

      // Survivors: freshly inserted, or a verified genuine twin. Their legacy
      // source may be consumed only after the receipt verification below
      // (thingsMigration's convention: never delete data that wasn't safely
      // relocated).
      const survivors = candidates.map((c, i) => ({ c, i })).filter(({ i }) => !done[i]);
      created += survivors.filter(({ i }) => inserted[i]).length;
      if (!survivors.length) continue;

      // Batched form of the per-doc consume guard: re-read every survivor's
      // legacy source and its destination thing in ONE query each, then require
      // either byte-semantic equivalence or a prior server receipt before
      // consuming the source — a kind/owner-shaped twin alone is never
      // conversion proof. Every mutation below is CAS-guarded on these
      // snapshots (destinationVersionCas for the repair, the exact source
      // snapshot for the delete), so a write racing the batched reads matches 0
      // and leaves the doc for the next (idempotent) run instead of dropping
      // the racing write.
      const freshDocs = (await legacy
        .find({ _id: { $in: survivors.map(({ c }) => c.doc._id) } } as any)
        .toArray()) as any[];
      const freshById = new Map(freshDocs.map((d) => [String(d._id), d]));
      const destinations = (await things
        .find({ shareId: { $in: survivors.map(({ c, i }) => (inserted[i] ? c.thing.shareId : twins[i]?.shareId ?? c.thing.shareId)) } } as any)
        .toArray()) as any[];
      const destinationByShareId = new Map(destinations.map((d) => [String(d.shareId), d]));
      // Third batched read: the conversion receipts. Keyed by source _id, which
      // both consume-phase checks below share (`fresh` is this same _id re-read),
      // so one page-wide lookup serves the already-consumed branch and the
      // freshness check alike.
      const receiptBySourceId = await findCollectionConversionReceipts(
        spec.collection,
        survivors.map(({ c }) => c.doc._id)
      );

      for (const { c, i } of survivors) {
        const { doc, thing } = c;
        const twin = twins[i];
        const fresh = freshById.get(String(doc._id));
        const destinationShareId = inserted[i] ? thing.shareId : twin?.shareId ?? thing.shareId;
        try {
          const receipt = receiptBySourceId.get(String(doc._id));
          if (!fresh) {
            // Another runner already consumed the source. Its receipt, not our
            // observation of a destination-shaped row, is the completion proof.
            if (!conversionReceiptCovers(receipt, doc)) {
              skip(doc, 'source changed during conversion — left for a later re-run');
            }
            continue;
          }
          const rebuilt = spec.toThing(fresh);
          if (!rebuilt.ok) {
            skip(doc, 'source changed to an invalid shape during conversion — left for a later repair');
            continue;
          }
          const expected = { ...rebuilt.thing, shareId: destinationShareId };
          const destination = destinationByShareId.get(String(destinationShareId)) ?? null;
          if (!destination || !spec.isGenuine(destination, fresh, expected)) {
            skip(doc, 'destination changed during conversion — left for a later re-run');
            continue;
          }
          const receiptCoversFresh = conversionReceiptCovers(receipt, fresh);
          if (!receiptCoversFresh && !conversionThingSemanticallyEquals(destination, expected, !!spec.findExisting)) {
            // We may repair only the row inserted by THIS invocation, and only
            // while it still equals our original snapshot. A pre-existing weak
            // twin or a concurrently edited destination is left untouched.
            if (!inserted[i] || !conversionThingSemanticallyEquals(destination, thing, !!spec.findExisting)) {
              skip(doc, 'destination payload differs from the source and has no conversion receipt — left for repair');
              continue;
            }
            const replaced = await things.replaceOne(destinationVersionCas(destination) as any, expected as any);
            if (!replaced.matchedCount) {
              skip(doc, 'destination changed during conversion — left for a later re-run');
              continue;
            }
          }
          await assertLease?.();
          const deleted = await legacy.deleteOne(exactDocumentSnapshotMatch(fresh) as any);
          if (!deleted.deletedCount) {
            skip(doc, 'source changed during conversion — left for a later re-run');
            continue;
          }
          await writeCollectionConversionReceipt(spec.collection, fresh, destinationShareId);
          migrated += 1;
        } catch (err: any) {
          // generic note only — never echo err.message (could embed a doc
          // field value) into the admin-visible migration report
          skip(doc, 'conversion error — left for a later re-run');
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
    'profile in crystal { name, emoji, parentId, weights, eventCount, lastTrainedAt, shared }, ALWAYS ' +
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
          lastTrainedAt: doc.lastTrainedAt ? new Date(doc.lastTrainedAt) : null,
          // the "try my feed brain 🧠" branch invitation is owner state, not
          // derived: dropping it here would silently revoke every share link a
          // legacy-era owner had handed out, since the source doc is deleted
          // once the twin verifies. Strict === true matches algorithmThingToDoc,
          // so a pre-share doc migrates as unshared.
          shared: doc.shared === true
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
  // batched form: one $in over the whole page's hashed-email keys, mapped back
  // by decoding each BinData uniqueKey (fromBin is the canonical decoder)
  findExistingMany: async (things, candidates) => {
    const keys = candidates.map((c) => c.thing.uniqueKeys[0]);
    const found = (await things.find({ uniqueKeys: { $in: keys } } as any).toArray()) as any[];
    const byKey = new Map<string, any>();
    for (const doc of found) for (const key of doc.uniqueKeys || []) byKey.set(fromBin(key), doc);
    return candidates.map((c) => byKey.get(fromBin(c.thing.uniqueKeys[0])) ?? null);
  },
	isGenuine: (twin) => Array.isArray(twin?.thingtime) && twin.thingtime.includes('waitlist') && twin.ownerId === 'system'
});

// ---------------------------------------------------------------------------
// Builtin-schema seeding: every builtin schema in the code registry
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

const builtinPublicSchemas = () => thingtimeSchemas;
const builtinSchemaShareIds = () => builtinPublicSchemas().map((schema) => `${BUILTIN_SCHEMA_SHARE_PREFIX}${schema.id}`);

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
  title: 'Seed all builtin schemas as public schema things',
  description:
    'Every builtin schema in the code registry is seeded as a system-owned public schema ' +
    'thing — thingtime ["schema"], shareId schema-<id>, uniqueKeys ["schema:<id>"], acl ["tt:all"], ' +
    'and the server-owned storageClass "control". Each crystal is projected onto ' +
    'the schema-thing field grammar and validated through validateThingtimeCrystal(["schema"]) ' +
    '— the same gate user-published schemas pass — before writing; open records use bounded JSON fields, ' +
    'reserved tagging names are omitted, and a validation failure is reported as a bug. ' +
    'Idempotent and self-healing: re-runs upsert by shareId, refresh genuine seeded docs whose ' +
    'crystal or control-plane storage stamp drifted, and skip+note foreign docs squatting a destination id.',
  pending: async () => {
    const things = await getCollection('things');
    const schemas = builtinPublicSchemas();
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
    const schemas = builtinPublicSchemas();
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

// Reconcile the plaintext email mirror on user things with the admin
// secure-fields toggle (api/utils/secureFields/config.ts). The secure blob is
// ALWAYS the source of truth; the root `email` field is a derived debugging
// mirror that exists only while the toggle is off (plaintext mode):
//   secure mode    → strip every root email mirror ($unset, one updateMany)
//   plaintext mode → walk all user things and $set the mirror from the blob
// Idempotent + config-driven, so it can re-run any time (the admin toggle runs
// it inline on every flip; re-run it after users-to-things conversions made
// during plaintext mode, since toThing writes blob-only docs). Root-only $set
// without a secureVersion bump is safe: concurrent blob CAS writes derive the
// same mirror value themselves (mutateUserThingSecure self-heals it).
const usersEmailMirrorSync: Migration = {
  id: 'users-email-mirror-sync',
  collection: 'things',
  fromVersion: THINGS_VERSION,
  toVersion: THINGS_VERSION, // reconcile, not a shape change (legal: fromVersion === toVersion)
  title: 'Sync plaintext email mirrors with the secure-fields toggle',
  description:
    'Brings the root plaintext `email` mirror on every user thing in line with the admin ' +
    'secure-fields config: removes all mirrors when email is in secure (blob-only) mode, or ' +
    'copies each blob email to the root mirror when an admin has toggled email to plaintext ' +
    'mode for direct-DB debugging. The BinData secure blob stays the single source of truth ' +
    'either way; the mirror is derived, regenerable data.',
  pending: async () => {
    const db = await getThingtimeDb();
    const config = await getSecureFieldsConfig(true);
    // cheap approximation: presence/absence mismatches (a drifted VALUE — mirror
    // ≠ blob email — is invisible here but fixed by run(); no email-change flow
    // exists today, so drift is theoretical)
    const filter =
      config.email?.secure === false
        ? { thingtime: 'user', email: { $exists: false } }
        : { thingtime: 'user', email: { $exists: true } };
    return db.collection('things').countDocuments(filter as any);
  },
  run: async ({ dryRun }) => {
    const db = await getThingtimeDb();
    const things = db.collection('things');
    const config = await getSecureFieldsConfig(true);
    const notes = makeNotes();

    if (config.email?.secure !== false) {
      // secure mode: the mirror must not exist anywhere — one bulk $unset
      const filter = { thingtime: 'user', email: { $exists: true } } as any;
      const matched = await things.countDocuments(filter);
      if (dryRun || !matched) return { dryRun, matched, migrated: 0, created: 0, skipped: 0, notes: notes.list() };
      const result = await things.updateMany(filter, { $unset: { email: '' } });
      return { dryRun, matched, migrated: result.modifiedCount, created: 0, skipped: 0, notes: notes.list() };
    }

    // plaintext mode: walk ALL user things (mirrors that merely drifted in
    // value need fixing too, so the filter can't drain — paginate by _id)
    const BATCH = 200;
    let matched = 0;
    let migrated = 0;
    let skipped = 0;
    let lastId: any = null;
    for (;;) {
      const page = (await things
        .find(lastId ? ({ thingtime: 'user', _id: { $gt: lastId } } as any) : ({ thingtime: 'user' } as any))
        .sort({ _id: 1 })
        .limit(BATCH)
        .toArray()) as any[];
      if (!page.length) break;
      lastId = page[page.length - 1]._id;
      for (const doc of page) {
        try {
          const blobEmail = unpackSecure(doc.secure).email || '';
          const desired = blobEmail || null; // never mirror an empty string
          const current = typeof doc.email === 'string' ? doc.email : null;
          if (current === desired) continue;
          matched += 1;
          if (dryRun) continue;
          await things.updateOne(
            { _id: doc._id } as any,
            desired ? { $set: { email: desired } } : { $unset: { email: '' } }
          );
          migrated += 1;
        } catch {
          // generic note only — never echo a doc field (an email!) into the
          // admin-visible migration report
          skipped += 1;
          notes.push('mirror sync error — left for a later re-run');
        }
      }
    }
    return { dryRun, matched, migrated, created: 0, skipped, notes: notes.list() };
  }
};

export const migrations: Migration[] = [
  subspaceMessagingMigration,
	accidentalCatalogAccountMigration,
	// Physical residue must land in the current generation before any logical
	// shape or byte-ledger migration can declare its source universe complete.
	mergeLegacyCollections,
  thingsMigration,
  usersToThings,
  themesToThings,
  feedAlgorithmsToThings,
  waitlistToThings,
  seedBuiltinSchemas,
  usersEmailMirrorSync,
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
	relationalExternalPostSources,
	// Shape first, then storage: relocate drains the ci-* rows out of things and
	// rebuild reclaims the index bytes they left behind, so both run after every
	// migration that still reads or rewrites things documents.
	consolidateRelationshipIndexes,
	retireLegacyThingIndexes,
	relocateCiControlTelemetry,
	rebuildThingsIndexes,
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
  // storage census ($collStats): uncompressed document bytes, on-disk
  // collection bytes, total index bytes, and the index count — so "which
  // generation is eating the cluster" is visible where cleanup is decided.
  // OPTIONAL: absent when the census could not be taken (collectionStorage).
  // "Unknown" must not serialize as 0 — 0 B of documents beside 0 B of index
  // is what a genuinely empty generation looks like, and the panel decides
  // whether to raise its bloat badge from exactly these numbers.
  dataBytes?: number;
  storageBytes?: number;
  indexBytes?: number;
  indexes?: number;
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
    classifyPhysicalCollections(physicalNames).map(async (row): Promise<CollectionGenerationStatus> => {
      const storage = await collectionStorage(db, row.physical);
      // omitted, not zeroed, when there is no census — see CollectionStorage
      const census: Partial<CollectionGenerationStatus> = storage
        ? {
            dataBytes: storage.dataBytes,
            storageBytes: storage.storageBytes,
            indexBytes: storage.indexBytes,
            indexes: Object.keys(storage.indexSizes).length
          }
        : {};
      return {
        collection: row.collection,
        physical: row.physical,
        version: row.version,
        docs: storage ? storage.docs : await db.collection(row.physical).estimatedDocumentCount(),
        current: row.current,
        stale: row.stale,
        ...census
      };
    })
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
