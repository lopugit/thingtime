import { randomUUID } from 'node:crypto';

import { ensureIndexes, getAdoptionIssues, getCollection, getThingtimeDb } from '../mongodb/collections';
import {
  COLLECTIONS,
  classifyPhysicalCollections,
  collectionVersion,
  physicalCollectionName
} from '../mongodb/collectionNames';
import { safeErrorText } from '../errors/safeError';
import { appThingSizeBytes, initializeAppStorageAccounting, setAppStorageUsed } from '../apps/namespace';
import { reactionShareId } from '../things/things';
import { buildUserSecure, packRecentReactions, toBin, userEmailKey, userUsernameKey } from '../auth/users';
import { waitlistEmailKey } from '../waitlist/waitlist';
import { themeAcl } from '../themes/themes';
import {
  ACL_ALL,
  ACL_INHERIT,
  ACL_OWNER,
  COLLECTION_SCHEMA_VERSIONS,
  LEGACY_SCHEMA_VERSION,
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
    const [posts, relational] = await Promise.all([
      things.countDocuments(legacyPostFilter),
      things.countDocuments(legacyRelationalFilter)
    ]);
    return posts + relational;
  },
  run: async ({ dryRun }) => {
    await ensureIndexes();
    const things = await getCollection('things');

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

// ---------------------------------------------------------------------------
// Collection → things migrations (claude-todo/12: everything is a thing).
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
  run: async ({ dryRun }) => {
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
      const filter = skippedIds.length ? { _id: { $nin: skippedIds } } : {};
      const batch = (await legacy.find(filter as any).limit(CONVERT_BATCH).toArray()) as any[];
      if (!batch.length) break;
      for (const doc of batch) {
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
                const res = await things.updateOne(
                  { shareId: thing.shareId } as any,
                  { $setOnInsert: thing },
                  { upsert: true }
                );
                inserted = !!res.upsertedCount;
                if (!inserted) twin = await things.findOne({ shareId: thing.shareId } as any);
              }
            } catch (err: any) {
              if (err?.code !== 11000) throw err;
              // a unique index (shareId race, or a uniqueKeys element held by
              // another doc) blocked the insert — re-read the counterpart and
              // let the genuine check decide; nothing was written
              twin = spec.findExisting
                ? await spec.findExisting(things, doc, thing)
                : await things.findOne({ shareId: thing.shareId } as any);
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
          // destination verified (fresh atomic insert, or a genuine prior-run
          // twin) — only now is the legacy source removed (thingsMigration's
          // convention: never delete data that wasn't safely relocated).
          //
          // Data-loss guard: a live write can land on the legacy doc between the
          // batch snapshot and here (until the thing exists, updateUserStore &
          // co. target legacy). Re-read fresh; if updatedAt advanced, the thing
          // we built is stale — rebuild it from the fresh doc before deleting,
          // and guard the delete on that fresh updatedAt so a write in the
          // remaining sliver leaves legacy for the next (idempotent) run.
          if (inserted) created += 1;
          const fresh = await legacy.findOne({ _id: doc._id } as any);
          const freshTime = fresh?.updatedAt ? +new Date(fresh.updatedAt) : 0;
          // What the destination thing currently reflects. On a fresh insert
          // that's this batch's snapshot (the thing we just built from `doc`).
          // On a prior-run twin it's the twin's OWN updatedAt — comparing only
          // against the batch snapshot missed this: a twin an earlier pass built
          // from older legacy data was never refreshed, so the guarded delete
          // then dropped a legacy write that had raced that earlier pass.
          const destinationShareId = inserted ? thing.shareId : twin?.shareId ?? thing.shareId;
          const destinationTime = inserted
            ? doc.updatedAt
              ? +new Date(doc.updatedAt)
              : 0
            : twin?.updatedAt
              ? +new Date(twin.updatedAt)
              : 0;
          if (fresh && freshTime > destinationTime) {
            const rebuilt = spec.toThing(fresh);
            // keep the destination's shareId so references never rotate — a
            // random-shareId spec would otherwise mint a new id on rebuild
            if (rebuilt.ok) {
              await things.replaceOne(
                { shareId: destinationShareId } as any,
                { ...rebuilt.thing, shareId: destinationShareId } as any
              );
            }
          }
          await legacy.deleteOne(fresh ? ({ _id: doc._id, updatedAt: fresh.updatedAt } as any) : ({ _id: doc._id } as any));
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
  isGenuine: (twin, doc) =>
    Array.isArray(twin?.thingtime) && twin.thingtime.includes('theme') && String(twin.ownerId) === String(doc.ownerId)
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
    Array.isArray(twin?.thingtime) &&
    twin.thingtime.includes('feed-algorithm') &&
    String(twin.ownerId) === String(doc.ownerId)
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
  isGenuine: (twin) =>
    Array.isArray(twin?.thingtime) && twin.thingtime.includes('waitlist') && twin.ownerId === 'system'
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
// a genuine seeded doc whose crystal no longer matches the validated registry
// projection is refreshed in place — and pending() counts missing AND stale
// docs, so drift genuinely surfaces in the admin census.

const BUILTIN_SCHEMA_SHARE_PREFIX = 'schema-';

const builtinCrystalSchemas = () => thingtimeSchemas.filter((schema) => schema.kind === 'crystal');
const builtinSchemaShareIds = () => builtinCrystalSchemas().map((schema) => `${BUILTIN_SCHEMA_SHARE_PREFIX}${schema.id}`);

// Registry schema -> the validated schema-thing crystal the seed stores. One
// call chains the shared projection + the shared write gate, so seeded
// builtins and user publishes can never drift onto different grammars.
const builtinSchemaCrystal = (schema: (typeof thingtimeSchemas)[number]) =>
  validateThingtimeCrystal(['schema'], projectBuiltinSchemaCrystal(schema));

const genuineSeededSchema = (twin: any): boolean =>
  !!twin && Array.isArray(twin.thingtime) && twin.thingtime.includes('schema') && twin.ownerId === 'system';

const seedBuiltinSchemas: Migration = {
  id: 'seed-builtin-schemas',
  collection: 'things',
  fromVersion: THINGS_VERSION,
  toVersion: THINGS_VERSION,
  title: 'Seed builtin crystal schemas as schema things',
  description:
    'Every builtin crystal schema in the code registry (all 13 crystal kinds: post, comment, ' +
    'reaction, share, data, schema, save, app, app-data, user, theme, feed-algorithm, waitlist) ' +
    'is seeded as a system-owned public schema thing — thingtime ["schema"], shareId ' +
    'schema-<id>, uniqueKeys ["schema:<id>"], acl ["tt:all"]. Each crystal is projected onto ' +
    'the schema-thing field grammar and validated through validateThingtimeCrystal(["schema"]) ' +
    '— the same gate user-published schemas pass — before writing; open record shapes and ' +
    'reserved names are projected away, and a validation failure is reported as a bug. ' +
    'Idempotent and self-healing: re-runs upsert by shareId, refresh genuine seeded docs whose ' +
    'crystal drifted from the registry, and skip+note foreign docs squatting a destination id.',
  pending: async () => {
    const things = await getCollection('things');
    const schemas = builtinCrystalSchemas();
    const docs = await things
      .find({ shareId: { $in: builtinSchemaShareIds() } } as any)
      .project({ shareId: 1, thingtime: 1, ownerId: 1, crystal: 1 })
      .toArray();
    const byShareId = new Map(docs.map((doc: any) => [doc.shareId, doc]));
    let count = 0;
    for (const schema of schemas) {
      const twin = byShareId.get(`${BUILTIN_SCHEMA_SHARE_PREFIX}${schema.id}`);
      // missing or squatted → unfinished work either way
      if (!genuineSeededSchema(twin)) {
        count += 1;
        continue;
      }
      const validated = builtinSchemaCrystal(schema);
      // projection no longer validates (registry/grammar drift) or the stored
      // crystal differs from the validated projection — both are pending work
      if (validated.ok === false || JSON.stringify(twin.crystal ?? {}) !== JSON.stringify(validated.crystal)) {
        count += 1;
      }
    }
    return count;
  },
  run: async ({ dryRun }) => {
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
        if (JSON.stringify(twin!.crystal ?? {}) !== JSON.stringify(validated.crystal)) {
          if (!dryRun) {
            // genuineness lives IN the filter — a foreign doc matches nothing,
            // preserving the same anti-squat guarantee as the skip above
            await things.updateOne(
              { shareId, ownerId: 'system', thingtime: 'schema' } as any,
              { $set: { crystal: validated.crystal, updatedAt: now } }
            );
          }
          notes.push(`schema ${schema.id}: crystal ${dryRun ? 'would be ' : ''}refreshed from the registry`);
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

const MERGE_BATCH = 200;

type LegacyResidueRow = {
  collection: string;
  physical: string;
  // docs in the legacy collection whose _id is absent from the current
  // generation — the exact set merge-legacy-collections still has to copy
  missing: number;
};

// The unversioned legacy collections that still exist, with their unmerged-doc
// counts. Exact by _id ($lookup into the current generation), so "missing: 0"
// genuinely means every doc has a counterpart and the snapshot is droppable.
const legacyResidue = async (): Promise<LegacyResidueRow[]> => {
  const db = await getThingtimeDb();
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry: any) => entry.name);
  const legacyRows = classifyPhysicalCollections(names).filter((row) => row.version === null);
  return Promise.all(
    legacyRows.map(async (row) => {
      const counted = (await db
        .collection(row.physical)
        .aggregate([
          {
            $lookup: {
              from: physicalCollectionName(row.collection),
              localField: '_id',
              foreignField: '_id',
              as: 'copied'
            }
          },
          { $match: { copied: { $size: 0 } } },
          { $count: 'n' }
        ])
        .toArray()) as any[];
      return { collection: row.collection, physical: row.physical, missing: counted.length ? counted[0].n : 0 };
    })
  );
};

// ---------------------------------------------------------------------------
// Full-power app namespaces (claude-todo/16): pre-namespace app-data things
// carry only crystal.appId. Stamp the scalar root appId (the namespace
// marker every app-lens query keys on) + sizeBytes (the storage ledger's
// unit), then reconcile each (user, app) ledger to the $sum of its
// namespace — absolute writes, so re-running is always safe. Sandbox docs
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
  run: async ({ dryRun }) => {
    const things = await getCollection('things');
    const matched = await things.countDocuments(appNamespaceBackfillFilter);
    const notes: string[] = [];
    if (dryRun) return { dryRun, matched, migrated: 0, created: 0, skipped: 0, notes };

    let migrated = 0;
    // batch the stamp pass — each doc's sizeBytes depends on its own payload
    while (true) {
      const batch = await things
        .find(appNamespaceBackfillFilter)
        .project({ shareId: 1, crystal: 1, extended: 1, tags: 1 })
        .limit(THINGS_BATCH)
        .toArray();
      if (!batch.length) break;
      for (const doc of batch) {
        await things.updateOne(
          { shareId: doc.shareId },
          { $set: { appId: doc.crystal?.appId, sizeBytes: appThingSizeBytes(doc as any) } }
        );
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
      const ownerId = String(entry._id?.ownerId || '');
      const appId = String(entry._id?.appId || '');
      if (!ownerId || !appId) continue;
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
// apps stay fail-closed because positive writes require all three numeric app
// fields. For each app we stamp any pre-namespace KV residue, reconcile its
// user ledgers, then initialize the aggregate LAST. That order is the writer
// fence: no new-code write can race an absolute baseline into an undercount.

const appStorageAllowanceBackfillFilter = {
  thingtime: 'app',
  $or: [
    { 'crystal.storageAllowanceBytes': { $not: { $type: 'number' } } },
    { 'crystal.storageUsedBytes': { $not: { $type: 'number' } } },
    { 'crystal.userStorageAllowanceBytes': { $not: { $type: 'number' } } }
  ]
};

const backfillAppStorageAllowances: Migration = {
  id: 'backfill-app-storage-allowances',
  collection: 'things',
  fromVersion: THINGS_VERSION,
  toVersion: THINGS_VERSION,
  title: 'Initialize whole-app and per-app-user storage allowances',
  description:
    'Initializes each legacy app with its server-owned aggregate storage allowance, aggregate usage, ' +
    'and per-user allowance. Reconciles every user ledger before enabling app writes, then installs ' +
    'the app aggregate last so concurrent new-code writes cannot be overwritten by the baseline.',
  pending: async () => {
    return (await getCollection('things')).countDocuments(appStorageAllowanceBackfillFilter);
  },
  run: async ({ dryRun }) => {
    const things = await getCollection('things');
    const apps = await things
      .find(appStorageAllowanceBackfillFilter)
      .project({ 'crystal.clientId': 1 })
      .toArray();
    const matched = apps.length;
    const notes: string[] = [];
    if (dryRun) return { dryRun, matched, migrated: 0, created: 0, skipped: 0, notes };

    let migrated = 0;
    let ledgers = 0;
    let stamped = 0;
    let skipped = 0;

    for (const app of apps) {
      const appId = typeof app.crystal?.clientId === 'string' ? app.crystal.clientId : '';
      if (!appId) {
        skipped += 1;
        continue;
      }

      // A legacy KV entry may still carry only crystal.appId. Stamp it before
      // either sum so this migration is safe even when the older namespace
      // migration has not been run yet.
      while (true) {
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
          await things.updateOne(
            { shareId: doc.shareId },
            { $set: { appId, sizeBytes: appThingSizeBytes(doc as any) } }
          );
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
        const ownerId = String(entry._id || '');
        if (!ownerId) continue;
        const usedBytes = Math.max(0, Math.floor(entry.bytes || 0));
        bytesByOwner.set(ownerId, usedBytes);
        const reconciled = await setAppStorageUsed(ownerId, appId, usedBytes, { onlyIfNotLive: true });
        appUsedBytes += usedBytes;
        if (reconciled) ledgers += 1;
      }

      // A prior ambiguous refund can leave a conservative counter even when
      // that user has no namespace docs left, so the aggregation above has no
      // row for them. Reconcile those existing counters explicitly to zero.
      const existingLedgers = await things
        .find({
          thingtime: 'data',
          'crystal.quotaKind': 'app-storage',
          'crystal.appId': appId,
          sandboxExpiresAt: { $exists: false }
        })
        .project({ ownerId: 1 })
        .toArray();
      for (const ledger of existingLedgers) {
        const ownerId = String(ledger.ownerId || '');
        if (!ownerId || bytesByOwner.has(ownerId)) continue;
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
  run: async ({ dryRun }) => {
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

    for (const row of residue) {
      if (!row.missing) continue;
      const legacy = db.collection(row.physical);
      const destinationName = physicalCollectionName(row.collection);
      // docs that failed to insert (unique key held by a newer doc at another
      // _id) would re-match forever — exclude them from later batches
      const blockedIds: any[] = [];
      for (;;) {
        const pipeline: any[] = [
          ...(blockedIds.length ? [{ $match: { _id: { $nin: blockedIds } } }] : []),
          {
            $lookup: { from: destinationName, localField: '_id', foreignField: '_id', as: 'copied' }
          },
          { $match: { copied: { $size: 0 } } },
          { $project: { copied: 0 } },
          { $limit: MERGE_BATCH }
        ];
        const batch = (await legacy.aggregate(pipeline).toArray()) as any[];
        if (!batch.length) break;
        try {
          const result = await db.collection(destinationName).insertMany(batch, { ordered: false });
          created += result.insertedCount;
        } catch (err: any) {
          const writeErrors = err?.writeErrors || [];
          const duplicates = writeErrors.filter((we: any) => we?.code === 11000);
          if (writeErrors.length !== duplicates.length && err?.code !== 11000) throw err;
          created += err?.result?.insertedCount ?? err?.insertedCount ?? 0;
          for (const we of duplicates) {
            const doc = batch[we.index];
            if (doc) blockedIds.push(doc._id);
            skipped += 1;
          }
          if (duplicates.length) {
            notes.push(`${row.physical}: ${duplicates.length} doc(s) blocked by a unique key — versioned collection wins`);
          }
        }
      }
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

export const migrations: Migration[] = [
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
  stampMigration(
    'lopuMusingRateLimits',
    'Stamps schemaVersion on both rate-limit shapes (musing sliding windows and waitlist counters).'
  ),
  backfillAppNamespaceFields,
  backfillAppStorageAllowances,
  mergeLegacyCollections,
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
        target
          .aggregate([{ $group: { _id: { $ifNull: ['$schemaVersion', LEGACY_SCHEMA_VERSION] }, count: { $sum: 1 } } }])
          .toArray()
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
        `${generation.collection}: legacy collection still exists beside ${physicalCollectionName(generation.collection)} — run merge-legacy-collections`
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
): Promise<Fail | { ok: true; migration: string; report: MigrationReport }> => {
  const migration = getMigration(id);
  if (!migration) return fail(404, 'Unknown migration');
  const dryRun = options.dryRun === true || options.dryRun === 'true';
  // destructive migrations (collection drops) never run on an unconfirmed
  // call — a mis-sent id can cost data, so the API demands intent twice
  if (migration.destructive && !dryRun && options.confirm !== true) {
    return fail(400, `Migration ${migration.id} drops data — pass confirm: true to run it`);
  }
  const report = await migration.run({ dryRun });
  return { ok: true, migration: migration.id, report };
};
