import { ensureIndexes, getThingtimeDb } from '../mongodb/collections';
import { reactionShareId } from '../things/things';
import { ACL_INHERIT, ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, LEGACY_SCHEMA_VERSION, aclFromVisibility } from '~/schemas/registry';

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
  pending: () => Promise<number>;
  run: (options: { dryRun: boolean }) => Promise<MigrationReport>;
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
      const db = await getThingtimeDb();
      return db.collection(collection).countDocuments(filter);
    },
    run: async ({ dryRun }) => {
      const db = await getThingtimeDb();
      const matched = await db.collection(collection).countDocuments(filter);
      if (dryRun) return { dryRun, matched, migrated: 0, created: 0, skipped: 0, notes: [] };
      const result = await db.collection(collection).updateMany(filter, { $set: { schemaVersion: toVersion } });
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
    const db = await getThingtimeDb();
    const [posts, relational] = await Promise.all([
      db.collection('things').countDocuments(legacyPostFilter),
      db.collection('things').countDocuments(legacyRelationalFilter)
    ]);
    return posts + relational;
  },
  run: async ({ dryRun }) => {
    await ensureIndexes();
    const db = await getThingtimeDb();
    const things = db.collection('things');

    const matched = await things.countDocuments(legacyPostFilter);
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
      // count what the run would create without writing anything
      const sample = await things
        .aggregate([
          { $match: legacyPostFilter },
          {
            $group: {
              _id: null,
              comments: { $sum: { $size: { $ifNull: ['$comments', []] } } },
              reactions: {
                $sum: {
                  $reduce: {
                    input: { $objectToArray: { $ifNull: ['$reactions', {}] } },
                    initialValue: 0,
                    in: { $add: ['$$value', { $size: { $ifNull: ['$$this.v', []] } }] }
                  }
                }
              }
            }
          }
        ])
        .toArray();
      const wouldCreate = sample.length ? sample[0].comments + sample[0].reactions : 0;
      notes.push(`${wouldCreate} standalone comment/reaction thing(s) would be created`);
      const relational = await things.countDocuments(legacyRelationalFilter);
      if (relational) notes.push(`${relational} interim relational kind doc(s) would be converted`);
      return { dryRun, matched: matched + relational, migrated: 0, created: 0, skipped: 0, notes };
    }

    // batch through matching docs; re-runs only see still-unmigrated posts.
    // Collided posts are left at v1 and would re-match forever, so exclude the
    // ones we've already skipped this run from later batches.
    const skippedPostIds: any[] = [];
    for (;;) {
      const batchFilter = skippedPostIds.length
        ? { $and: [legacyPostFilter, { _id: { $nin: skippedPostIds } }] }
        : legacyPostFilter;
      const batch = (await things.find(batchFilter as any).limit(THINGS_BATCH).toArray()) as any[];
      if (!batch.length) break;

      for (const doc of batch) {
        // Each embedded comment/reaction becomes a standalone thing at a
        // deterministic id, along with the genuine (ownerId, targetId) it must
        // carry. A foreign doc squatting one of these ids would let an attacker
        // hijack migrated content, so verify every destination id is either
        // free or already a genuine counterpart before touching the post.
        const inserts: any[] = [];
        for (const comment of doc.comments || []) {
          inserts.push({
            shareId: comment.id,
            schemaVersion: THINGS_VERSION,
            thingtime: ['comment'],
            crystal: { text: comment.text },
            ownerId: comment.userId,
            acl: [ACL_INHERIT],
            targetId: doc.shareId,
            tags: [],
            createdAt: new Date(comment.createdAt),
            updatedAt: new Date(comment.createdAt)
          });
        }
        for (const [emoji, userIds] of Object.entries(doc.reactions || {})) {
          for (const userId of (userIds as string[]) || []) {
            inserts.push({
              shareId: reactionShareId(doc.shareId, userId, emoji),
              schemaVersion: THINGS_VERSION,
              thingtime: ['reaction'],
              crystal: { emoji },
              ownerId: userId,
              acl: [ACL_INHERIT],
              targetId: doc.shareId,
              tags: [],
              // v1 stored no per-reaction time; the post's updatedAt is the
              // closest deterministic stand-in
              createdAt: new Date(doc.updatedAt),
              updatedAt: new Date(doc.updatedAt)
            });
          }
        }

        // Skip a post whose interaction migration would collide with a foreign
        // doc: convert its body but KEEP the embedded copies (reads fold them),
        // so nothing is lost or double-counted and a re-run finishes it once
        // the collision is resolved.
        let collision = false;
        if (inserts.length) {
          const ids = inserts.map((entry) => entry.shareId);
          const existing = (await things.find({ shareId: { $in: ids } } as any).toArray()) as any[];
          const byId = new Map(existing.map((row) => [row.shareId, row]));
          collision = inserts.some((entry) => {
            const twin = byId.get(entry.shareId);
            // free id, or a genuine prior-run counterpart (same owner + target)
            return (
              twin &&
              (String(twin.ownerId) !== String(entry.ownerId) || String(twin.targetId) !== String(entry.targetId))
            );
          });
        }

        if (collision) {
          // Leave the whole post at v1 (reads fold its embedded data) so a
          // re-run retries it once the squatting doc is removed. Never $unset
          // embedded data we couldn't safely relocate.
          notes.push(`post ${doc.shareId}: interaction id collision — left at v1 for a later re-run`);
          skipped += 1;
          skippedPostIds.push(doc._id);
          continue;
        }

        if (inserts.length) {
          try {
            const result = await things.insertMany(inserts, { ordered: false });
            created += result.insertedCount;
          } catch (err: any) {
            // duplicate shareIds from a previous partial run — count the rest
            const inserted = err?.result?.insertedCount ?? err?.insertedCount ?? 0;
            const duplicates = (err?.writeErrors || []).filter((we: any) => we?.code === 11000).length;
            if (!duplicates && err?.code !== 11000) throw err;
            created += inserted;
            skipped += duplicates || inserts.length - inserted;
          }

          // Post-insert verification closes the TOCTOU window: a doc could have
          // been squatted at a destination id between the pre-check above and
          // this insert (making the genuine insert dup-fail). Re-read every
          // destination and confirm each is a genuine counterpart (our owner +
          // target). If any isn't, roll back the counterparts we DID create and
          // leave the post at v1 — never $unset embedded data we couldn't
          // fully relocate, and never double-count by keeping both copies.
          const ids = inserts.map((entry) => entry.shareId);
          const after = (await things.find({ shareId: { $in: ids } } as any).toArray()) as any[];
          const afterById = new Map(after.map((row) => [row.shareId, row]));
          const isGenuine = (entry: any) => {
            const twin = afterById.get(entry.shareId);
            return (
              !!twin &&
              String(twin.ownerId) === String(entry.ownerId) &&
              String(twin.targetId) === String(entry.targetId)
            );
          };
          if (!inserts.every(isGenuine)) {
            const ours = inserts.filter(isGenuine).map((entry) => entry.shareId);
            if (ours.length) {
              await things.deleteMany({ shareId: { $in: ours }, targetId: doc.shareId } as any);
            }
            notes.push(`post ${doc.shareId}: interaction id race — rolled back, left at v1 for a later re-run`);
            skipped += 1;
            skippedPostIds.push(doc._id);
            continue;
          }
        }

        await things.updateOne(
          { _id: doc._id },
          {
            $set: {
              schemaVersion: THINGS_VERSION,
              thingtime: doc.shareOfId ? ['post', 'share'] : ['post'],
              crystal: {
                type: doc.type || 'text',
                text: doc.text || '',
                images: doc.images || [],
                listing: doc.listing || null
              },
              targetId: doc.shareOfId || null,
              tags: doc.tags || [],
              // legacy visibility enum becomes acl grants/exclusions
              acl: aclFromVisibility(doc.visibility) || [ACL_OWNER]
            },
            $unset: {
              kind: '',
              type: '',
              text: '',
              images: '',
              listing: '',
              comments: '',
              reactions: '',
              shareOfId: '',
              shareCount: '',
              visibility: ''
            }
          }
        );
        migrated += 1;
      }
    }

    // convert interim relational kind:'reaction'/'comment' docs (written by the
    // pre-unification relational model) into v2 things, then remove them —
    // deterministic/stable ids make re-runs and races idempotent
    let converted = 0;
    const skippedRelationalIds: any[] = [];
    for (;;) {
      const relFilter = skippedRelationalIds.length
        ? { $and: [legacyRelationalFilter, { _id: { $nin: skippedRelationalIds } }] }
        : legacyRelationalFilter;
      const batch = (await things.find(relFilter as any).limit(THINGS_BATCH).toArray()) as any[];
      if (!batch.length) break;
      for (const doc of batch) {
        const shareId =
          doc.kind === 'reaction'
            ? reactionShareId(String(doc.parentId), String(doc.ownerId), String(doc.token))
            : String(doc.commentId || doc._id);
        const res = await things.updateOne(
          { shareId },
          {
            $setOnInsert: {
              shareId,
              schemaVersion: THINGS_VERSION,
              thingtime: [doc.kind],
              crystal: doc.kind === 'reaction' ? { emoji: doc.token } : { text: doc.text || '' },
              ownerId: doc.ownerId,
              acl: [ACL_INHERIT],
              targetId: doc.parentId,
              tags: [],
              createdAt: new Date(doc.createdAt),
              updatedAt: new Date(doc.createdAt)
            }
          },
          { upsert: true }
        );
        // Only delete the source once its converted counterpart is safely in
        // place — either we just inserted it, or the existing doc at that id is
        // a genuine twin (same owner + target). A foreign doc squatting the id
        // ($setOnInsert no-ops) must NOT cause the source to be deleted.
        let genuine = !!res.upsertedCount;
        if (!genuine) {
          const twin = (await things.findOne({ shareId } as any)) as any;
          genuine =
            !!twin && String(twin.ownerId) === String(doc.ownerId) && String(twin.targetId) === String(doc.parentId);
        }
        if (genuine) {
          await things.deleteOne({ _id: doc._id });
          converted += 1;
        } else {
          notes.push(`relational ${doc.kind} ${shareId}: id collision — source kept for a later re-run`);
          skipped += 1;
          skippedRelationalIds.push(doc._id);
        }
      }
    }
    if (converted) notes.push(`${converted} interim relational kind doc(s) converted to things`);

    return { dryRun, matched: matched + converted, migrated: migrated + converted, created, skipped, notes };
  }
};

export const migrations: Migration[] = [
  thingsMigration,
  stampMigration('users', 'User docs already match the v2 shape — stamps schemaVersion.'),
  stampMigration('sessions', 'Session docs already match the v2 shape — stamps schemaVersion.'),
  stampMigration('emailVerifications', 'Email verification docs already match the v2 shape — stamps schemaVersion.'),
  stampMigration('themes', 'Theme docs already match the v2 shape — stamps schemaVersion.'),
  stampMigration('waitlist', 'Waitlist docs already match the v2 shape — stamps schemaVersion.'),
  stampMigration('feedAlgorithms', 'Feed algorithm docs already match the v2 shape — stamps schemaVersion.'),
  stampMigration(
    'lopuMusingRateLimits',
    'Stamps schemaVersion on both rate-limit shapes (musing sliding windows and waitlist counters).'
  )
];

export const getMigration = (id: unknown): Migration | null =>
  typeof id === 'string' ? migrations.find((migration) => migration.id === id.trim()) || null : null;

export type CollectionVersionStatus = {
  collection: string;
  currentVersion: number;
  total: number;
  versions: Record<string, number>;
  pendingMigrations: string[];
};

// Per-collection version census + which registered migrations still have work.
export const getMigrationStatus = async (): Promise<{
  collections: CollectionVersionStatus[];
  migrations: Array<Pick<Migration, 'id' | 'collection' | 'fromVersion' | 'toVersion' | 'title' | 'description'> & { pending: number }>;
}> => {
  const db = await getThingtimeDb();

  const collections = await Promise.all(
    Object.entries(COLLECTION_SCHEMA_VERSIONS).map(async ([collection, currentVersion]) => {
      const rows = (await db
        .collection(collection)
        .aggregate([{ $group: { _id: { $ifNull: ['$schemaVersion', LEGACY_SCHEMA_VERSION] }, count: { $sum: 1 } } }])
        .toArray()) as any[];
      const versions: Record<string, number> = {};
      let total = 0;
      rows.forEach((row) => {
        versions[String(row._id)] = row.count;
        total += row.count;
      });
      return { collection, currentVersion, total, versions, pendingMigrations: [] as string[] };
    })
  );

  const withPending = await Promise.all(
    migrations.map(async (migration) => ({
      id: migration.id,
      collection: migration.collection,
      fromVersion: migration.fromVersion,
      toVersion: migration.toVersion,
      title: migration.title,
      description: migration.description,
      pending: await migration.pending()
    }))
  );

  withPending.forEach((migration) => {
    if (!migration.pending) return;
    const status = collections.find((entry) => entry.collection === migration.collection);
    if (status) status.pendingMigrations.push(migration.id);
  });

  return { collections, migrations: withPending };
};

export const runMigration = async (
  id: unknown,
  options: { dryRun?: unknown }
): Promise<Fail | { ok: true; migration: string; report: MigrationReport }> => {
  const migration = getMigration(id);
  if (!migration) return fail(404, 'Unknown migration');
  const report = await migration.run({ dryRun: options.dryRun === true || options.dryRun === 'true' });
  return { ok: true, migration: migration.id, report };
};
