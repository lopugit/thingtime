import { randomUUID } from 'node:crypto';

import { ensureIndexes, getThingtimeDb } from '../mongodb/collections';
import { reactionShareId } from '../things/things';
import { buildUserSecure, toBin, userEmailKey, userUsernameKey } from '../auth/users';
import { waitlistEmailKey } from '../waitlist/waitlist';
import { themeAcl } from '../themes/themes';
import {
  ACL_ALL,
  ACL_INHERIT,
  ACL_OWNER,
  COLLECTION_SCHEMA_VERSIONS,
  LEGACY_SCHEMA_VERSION,
  MAX_SCHEMA_FIELD_DESCRIPTION_CHARS,
  MAX_SCHEMA_FIELD_NAME_CHARS,
  SCHEMA_FIELD_NAME_PATTERN,
  SCHEMA_FIELD_TYPES,
  aclFromVisibility,
  thingtimeSchemas,
  type ThingtimeSchemaField
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
    const db = await getThingtimeDb();
    return db.collection(spec.collection).countDocuments({});
  },
  run: async ({ dryRun }) => {
    await ensureIndexes();
    const db = await getThingtimeDb();
    const things = db.collection('things');
    const legacy = db.collection(spec.collection);
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
            skip(`${built.reason} — left for a later re-run`);
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
          const snapTime = doc.updatedAt ? +new Date(doc.updatedAt) : 0;
          if (fresh && freshTime > snapTime) {
            const rebuilt = spec.toThing(fresh);
            if (rebuilt.ok) await things.replaceOne({ shareId: thing.shareId } as any, rebuilt.thing as any);
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
    // so migrated + live-written accounts can't drift: opaque BinData blob,
    // admin extracted to the root boolean
    const { secure, admin } = buildUserSecure({
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
// becomes a system-owned, public schema THING so /search's community schema
// browser lists them next to user-published ones. The code registry remains
// the validation source of truth — these things are read-only discovery
// mirrors, seeded through the migrations framework so drift surfaces as
// pending work in the admin census.

const BUILTIN_SCHEMA_SHARE_PREFIX = 'schema-';

const builtinCrystalSchemas = () => thingtimeSchemas.filter((schema) => schema.kind === 'crystal');
const builtinSchemaShareIds = () => builtinCrystalSchemas().map((schema) => `${BUILTIN_SCHEMA_SHARE_PREFIX}${schema.id}`);

// Map a registry field onto the schema-thing field grammar enforced by
// sanitizeSchemaCrystal ({ name, type, description?, values? }): 'id' fields
// are strings on the wire; object/record shapes and names outside the field
// grammar (the data schema's '*' catch-all) don't fit and are skipped — an
// explicitly lossy projection, since schema things are search sugar, never a
// validation gate.
const builtinSchemaField = (field: ThingtimeSchemaField): Record<string, any> | null => {
  const type = field.type === 'id' ? 'string' : field.type;
  if (!(SCHEMA_FIELD_TYPES as readonly string[]).includes(type)) return null;
  if (field.name.length > MAX_SCHEMA_FIELD_NAME_CHARS || !SCHEMA_FIELD_NAME_PATTERN.test(field.name)) return null;
  const out: Record<string, any> = { name: field.name, type };
  if (field.description) out.description = field.description.slice(0, MAX_SCHEMA_FIELD_DESCRIPTION_CHARS);
  if (type === 'enum' && Array.isArray(field.values) && field.values.length) out.values = [...field.values];
  return out;
};

const genuineSeededSchema = (twin: any): boolean =>
  !!twin && Array.isArray(twin.thingtime) && twin.thingtime.includes('schema') && twin.ownerId === 'system';

const seedBuiltinSchemas: Migration = {
  id: 'seed-builtin-schemas',
  collection: 'things',
  fromVersion: THINGS_VERSION,
  toVersion: THINGS_VERSION,
  title: 'Seed builtin crystal schemas as schema things',
  description:
    'Every builtin crystal schema in the code registry (post, comment, reaction, share, data, ' +
    'schema, user, theme, feed-algorithm, waitlist) is seeded as a system-owned public schema ' +
    'thing — thingtime ["schema"], shareId schema-<id>, uniqueKeys ["schema:<id>"], acl ' +
    '["tt:all"] — so the /search schema browser lists them. Fields are projected onto the ' +
    'schema-thing field grammar (object/record shapes are skipped). The code registry stays the ' +
    'validation source of truth. Idempotent: re-runs upsert by shareId and create nothing that ' +
    'already exists; a foreign doc squatting a destination id is skipped and noted.',
  pending: async () => {
    const db = await getThingtimeDb();
    const ids = builtinSchemaShareIds();
    const seeded = await db
      .collection('things')
      .countDocuments({ shareId: { $in: ids }, thingtime: 'schema', ownerId: 'system' } as any);
    return ids.length - seeded;
  },
  run: async ({ dryRun }) => {
    await ensureIndexes();
    const db = await getThingtimeDb();
    const things = db.collection('things');
    const notes = makeNotes();
    const schemas = builtinCrystalSchemas();
    const matched = schemas.length;

    if (dryRun) {
      const seeded = await things.countDocuments({
        shareId: { $in: builtinSchemaShareIds() },
        thingtime: 'schema',
        ownerId: 'system'
      } as any);
      notes.push(`${matched - seeded} builtin schema thing(s) would be created (${seeded} of ${matched} already seeded)`);
      return { dryRun, matched, migrated: 0, created: 0, skipped: 0, notes: notes.list() };
    }

    let created = 0;
    let skipped = 0;
    let alreadySeeded = 0;

    for (const schema of schemas) {
      const shareId = `${BUILTIN_SCHEMA_SHARE_PREFIX}${schema.id}`;
      try {
        const fields = schema.fields
          .map(builtinSchemaField)
          .filter((field): field is Record<string, any> => field !== null);
        const now = new Date();
        const thing = {
          shareId,
          schemaVersion: THINGS_VERSION,
          thingtime: ['schema'],
          crystal: { name: schema.title, description: schema.summary, fields },
          ownerId: 'system',
          acl: [ACL_ALL],
          targetId: null,
          tags: [],
          uniqueKeys: [toBin(`schema:${schema.id}`)],
          createdAt: now,
          updatedAt: now
        };
        const res = await things.updateOne({ shareId } as any, { $setOnInsert: thing }, { upsert: true });
        if (res.upsertedCount) {
          created += 1;
          continue;
        }
        const twin = await things.findOne({ shareId } as any);
        if (genuineSeededSchema(twin)) {
          alreadySeeded += 1;
        } else {
          notes.push(`schema ${schema.id}: shareId ${shareId} held by a foreign doc — left unseeded`);
          skipped += 1;
        }
      } catch (err: any) {
        if (err?.code === 11000) notes.push(`schema ${schema.id}: unique key held by a foreign doc — left unseeded`);
        else notes.push(`schema ${schema.id}: error: ${err?.message || String(err)} — left unseeded`);
        skipped += 1;
      }
    }

    if (created) notes.push(`${created} builtin schema thing(s) seeded`);
    if (alreadySeeded) notes.push(`${alreadySeeded} builtin schema thing(s) already seeded`);
    return { dryRun, matched, migrated: created, created, skipped: skipped + alreadySeeded, notes: notes.list() };
  }
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
