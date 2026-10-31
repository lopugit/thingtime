import type { PublicUser, SavedDeploymentLink, DeploymentSyncMode } from '../auth/users';
import { findUserById, toPublicUser, updateUserProfile } from '../auth/users';
import { fail, isFail, listThings, upsertThing, viewerOf } from '../things/things';
import type { Fail, PublicThing } from '../things/things';
import {
  remoteListThings,
  remoteMe,
  remotePutThing,
  remoteUpdateProfile
} from './remote';
import type { RemoteThing } from './remote';

// The sync engine. One run reconciles the link owner's account data between
// THIS deployment (local) and the linked deployment (remote), driven by the
// link's sync mode + per-path rules:
//   push    local → remote
//   pull    remote → local
//   two-way both directions, last-write-wins on updatedAt for real conflicts
// Data paths: 'profile', 'things' (every non-protected thing kind), and
// 'things/<kind>' overrides (matched against any of a thing's thingtime ids,
// in rule order). Identity across deployments is the thing's shareId — the
// same id upserts on both sides, so syncing is idempotent.
//
// Ping-pong safety: a copied thing gets a NEW updatedAt on the destination, so
// naive LWW would bounce it straight back on the next two-way run. Content
// equality is therefore checked FIRST — identical content is always a skip,
// whatever the timestamps say — and updatedAt only breaks ties between
// genuinely different versions.
//
// Serverless budget: one run scans up to MAX_SYNC_THINGS per side and executes
// at most MAX_SYNC_OPS_PER_RUN changes (remote writes ride the remote's own
// things.write rate limit). `remaining` in the report says how much is left —
// running sync again continues where this run left off. Deletes don't
// propagate (no tombstones yet): removing a thing on one side leaves it on the
// other until it's removed there too.

const MAX_SYNC_THINGS = 1000;
const SYNC_PAGE_LIMIT = 100;
const MAX_SYNC_OPS_PER_RUN = 40;
const MAX_REPORTED_ERRORS = 12;
// dependency rounds for target-attached things (comment → post, reply →
// comment, reaction → either): depth is tiny in practice
const MAX_TARGET_ROUNDS = 5;

// Wall-clock fence for one pass. MAX_SYNC_OPS_PER_RUN bounds how MANY remote
// calls a pass makes, not how long they take: every remoteFetch waits up to
// REMOTE_TIMEOUT_MS (15s), so 40 ops against a merely slow deployment — a cold
// serverless remote doing a Mongo upsert per write is enough — outlive the
// platform's function limit long before the op budget runs out.
//
// Being killed mid-pass is the outcome worth avoiding: the writes that already
// landed stay landed, but the route never reaches its updateUserDeploymentLink
// call, so lastSyncAt/lastSyncSummary never record them and the caller gets a
// platform 504 instead of the report. Stopping early costs nothing by
// comparison — the pass is already resumable, and whatever is left is counted
// in `remaining`, which is exactly what the UI tells the user to run again.
const SYNC_WALL_CLOCK_BUDGET_MS = 45_000;

// true = stop scheduling ops. One op is ALWAYS attempted before the fence can
// fire: if the scans alone ate the budget, a pure elapsed-time check would
// return "0 done, N remaining" forever and no re-run would ever advance. Every
// pass settling at least one op keeps progress monotonic.
export const syncBudgetSpent = (
  settled: number,
  elapsedMs: number,
  budgetMs: number = SYNC_WALL_CLOCK_BUDGET_MS
): boolean => settled > 0 && elapsedMs >= budgetMs;

export type SyncSummary = {
  mode: DeploymentSyncMode;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  scannedLocal: number;
  scannedRemote: number;
  planned: number;
  pushed: number;
  pulled: number;
  unchanged: number;
  conflictsResolved: number;
  remaining: number;
  truncatedScan: boolean;
  errors: string[];
};

type SyncSide = 'local' | 'remote';
export type NormalizedThing = {
  id: string;
  thingtime: string[];
  crystal: Record<string, any>;
  extended: unknown | null;
  acl: string[];
  targetId: string | null;
  tags: string[];
  updatedAt: string;
};

export type SyncOp = {
  direction: 'push' | 'pull';
  source: NormalizedThing;
  conflict: boolean;
};

// deterministic deep stringify so content comparison never depends on key order
const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
};

export const contentKey = (thing: NormalizedThing): string =>
  stableStringify({
    thingtime: [...thing.thingtime].sort(),
    crystal: thing.crystal,
    extended: thing.extended ?? null,
    tags: [...thing.tags].sort(),
    targetId: thing.targetId
  });

export const normalize = (thing: PublicThing | RemoteThing): NormalizedThing => ({
  id: thing.id,
  thingtime: Array.isArray(thing.thingtime) ? thing.thingtime : [],
  crystal: thing.crystal && typeof thing.crystal === 'object' ? thing.crystal : {},
  extended: thing.extended ?? null,
  acl: Array.isArray((thing as any).acl) ? (thing as any).acl : [],
  targetId: thing.targetId ?? null,
  tags: Array.isArray(thing.tags) ? thing.tags : [],
  updatedAt: thing.updatedAt || thing.createdAt || ''
});

// mode for a thing: first path rule naming one of its kinds wins, then the
// catch-all 'things' rule, then the link's overall mode
export const modeForThing = (link: SavedDeploymentLink, thingtime: string[]): DeploymentSyncMode => {
  for (const rule of link.pathRules) {
    if (!rule.path.startsWith('things/')) continue;
    if (thingtime.includes(rule.path.slice('things/'.length))) return rule.mode;
  }
  const catchAll = link.pathRules.find((rule) => rule.path === 'things');
  return catchAll ? catchAll.mode : link.syncMode;
};

export const modeForProfile = (link: SavedDeploymentLink): DeploymentSyncMode => {
  const rule = link.pathRules.find((entry) => entry.path === 'profile');
  return rule ? rule.mode : link.syncMode;
};

const collectLocalThings = async (
  user: PublicUser
): Promise<{ things: NormalizedThing[]; truncated: boolean } | Fail> => {
  const viewer = viewerOf({ id: user.id, username: user.username });
  const things: NormalizedThing[] = [];
  let cursor: string | null = null;
  while (things.length < MAX_SYNC_THINGS) {
    const page = await listThings(viewer, { cursor, limit: SYNC_PAGE_LIMIT });
    if (page.ok === false) return page;
    things.push(...page.things.map(normalize));
    cursor = page.nextCursor;
    if (!cursor) return { things, truncated: false };
  }
  return { things: things.slice(0, MAX_SYNC_THINGS), truncated: true };
};

export const collectRemoteThings = async (
  link: SavedDeploymentLink,
  // injected in tests: the pager below is driven by a cursor the REMOTE picks,
  // so its termination has to hold against answers we don't control
  lister: typeof remoteListThings = remoteListThings
): Promise<{ things: NormalizedThing[]; truncated: boolean } | Fail> => {
  const things: NormalizedThing[] = [];
  let cursor: string | null = null;
  while (things.length < MAX_SYNC_THINGS) {
    const page = await lister(link.baseUrl, link.token, { cursor, limit: SYNC_PAGE_LIMIT });
    if (isFail(page)) return page;
    things.push(...page.things.map(normalize));
    cursor = page.nextCursor;
    if (!cursor) return { things, truncated: false };
    // Progress guard. Unlike the local scan — whose cursor comes from our own
    // collection and always advances — `nextCursor` here is whatever the linked
    // deployment says. A remote answering { things: [], nextCursor: <non-null> }
    // never grows `things`, so the length bound above alone would spin this
    // loop (one remote request per turn) until the function times out. Every
    // turn must now either collect a thing or stop, which bounds the scan at
    // MAX_SYNC_THINGS requests no matter what the remote returns.
    if (!page.things.length) return { things, truncated: true };
  }
  return { things: things.slice(0, MAX_SYNC_THINGS), truncated: true };
};

// PUT body for either side. acl is omitted for audience-inheriting things —
// their audience is the target's, and both createThing and updateThing would
// reject an explicit acl for them.
export const putBodyFor = (thing: NormalizedThing): Record<string, unknown> => ({
  // both spellings: the remote HTTP route maps id → shareId, while the local
  // upsertThing util takes shareId directly
  id: thing.id,
  shareId: thing.id,
  thingtime: thing.thingtime,
  crystal: thing.crystal,
  extended: thing.extended ?? null,
  tags: thing.tags,
  ...(thing.targetId ? { targetId: thing.targetId } : {}),
  ...(thing.acl.length && !thing.acl.includes('tt:inherit') ? { acl: thing.acl } : {})
});

// Execution order inside a run: standalone things first (schemas before the
// data things that may cite them via crystal.schemaId), then target-attached
// things in dependency rounds so a comment never lands before its post.
export const orderOps = (ops: SyncOp[], destinationHas: (direction: 'push' | 'pull', id: string) => boolean): SyncOp[] => {
  const standalone = ops.filter((op) => !op.source.targetId);
  standalone.sort((a, b) => {
    const aSchema = a.source.thingtime.includes('schema') ? 0 : 1;
    const bSchema = b.source.thingtime.includes('schema') ? 0 : 1;
    return aSchema - bSchema;
  });

  const attached = ops.filter((op) => op.source.targetId);
  const ordered: SyncOp[] = [...standalone];
  const landed = new Set(standalone.map((op) => `${op.direction}:${op.source.id}`));
  let pending = attached;
  for (let round = 0; round < MAX_TARGET_ROUNDS && pending.length; round++) {
    const next: SyncOp[] = [];
    for (const op of pending) {
      const targetLanded =
        destinationHas(op.direction, op.source.targetId as string) ||
        landed.has(`${op.direction}:${op.source.targetId}`);
      if (targetLanded) {
        ordered.push(op);
        landed.add(`${op.direction}:${op.source.id}`);
      } else {
        next.push(op);
      }
    }
    if (next.length === pending.length) break; // no progress — unresolvable targets
    pending = next;
  }
  // unresolvable leftovers still run last (their target may exist but be
  // beyond the scan cap) — the destination decides, and a 404 is reported
  return [...ordered, ...pending];
};

export const runDeploymentSync = async (
  user: PublicUser,
  link: SavedDeploymentLink,
  options: { dryRun?: boolean } = {}
): Promise<SyncSummary | Fail> => {
  const dryRun = !!options.dryRun;
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const errors: string[] = [];
  const pushError = (message: string) => {
    if (errors.length < MAX_REPORTED_ERRORS) errors.push(message);
  };

  if (link.syncMode === 'off' && !link.pathRules.some((rule) => rule.mode !== 'off')) {
    return fail(400, 'This link’s sync is off — pick push, pull or two-way first');
  }

  // token-liveness + identity check before any data moves
  const remoteUser = await remoteMe(link.baseUrl, link.token);
  if (isFail(remoteUser)) return remoteUser;
  if (remoteUser.id !== link.remoteUserId) {
    return fail(409, 'That deployment’s token now belongs to a different account — re-link it');
  }

  let pushed = 0;
  let pulled = 0;
  let unchanged = 0;
  let conflictsResolved = 0;
  let planned = 0;
  let executed = 0;

  // ── profile ──────────────────────────────────────────────────────────────
  const profileMode = modeForProfile(link);
  if (profileMode !== 'off') {
    const localDoc = await findUserById(user.id);
    const local = localDoc ? toPublicUser(localDoc) : user;
    const localProfile = {
      displayName: local.displayName ?? null,
      bio: local.bio ?? null,
      avatarUrl: local.avatarUrl ?? null,
      bannerUrl: local.bannerUrl ?? null
    };
    const remoteProfile = {
      displayName: remoteUser.displayName ?? null,
      bio: remoteUser.bio ?? null,
      avatarUrl: remoteUser.avatarUrl ?? null,
      bannerUrl: remoteUser.bannerUrl ?? null
    };
    if (stableStringify(localProfile) === stableStringify(remoteProfile)) {
      unchanged += 1;
    } else {
      planned += 1;
      // profile fields carry no per-field timestamps, so two-way resolves in
      // favor of the deployment RUNNING the sync (local wins) — EXCEPT when the
      // local profile is entirely empty and the remote one isn't, where "local
      // wins" would blank a filled-in profile
      const localEmpty = Object.values(localProfile).every((value) => value === null);
      const direction: 'push' | 'pull' =
        profileMode === 'pull' ? 'pull' : profileMode === 'push' ? 'push' : localEmpty ? 'pull' : 'push';
      if (!dryRun) {
        if (direction === 'push') {
          const result = await remoteUpdateProfile(link.baseUrl, link.token, localProfile);
          if (isFail(result)) pushError(`profile push: ${result.error}`);
          else pushed += 1;
        } else {
          const result = await updateUserProfile(user.id, remoteProfile);
          if (result.ok === false) pushError(`profile pull: ${result.error}`);
          else pulled += 1;
        }
        executed += 1;
      }
    }
  }

  // ── things ───────────────────────────────────────────────────────────────
  const localScan = await collectLocalThings(user);
  if (isFail(localScan)) return localScan;
  const remoteScan = await collectRemoteThings(link);
  if (isFail(remoteScan)) return remoteScan;

  const localById = new Map(localScan.things.map((thing) => [thing.id, thing]));
  const remoteById = new Map(remoteScan.things.map((thing) => [thing.id, thing]));

  const ops: SyncOp[] = [];
  const allIds = new Set([...localById.keys(), ...remoteById.keys()]);
  for (const id of allIds) {
    const local = localById.get(id);
    const remote = remoteById.get(id);
    const mode = modeForThing(link, (local || remote)!.thingtime);
    if (mode === 'off') continue;

    if (local && !remote) {
      if (mode === 'push' || mode === 'two-way') ops.push({ direction: 'push', source: local, conflict: false });
      continue;
    }
    if (!local && remote) {
      if (mode === 'pull' || mode === 'two-way') ops.push({ direction: 'pull', source: remote, conflict: false });
      continue;
    }
    if (!local || !remote) continue;

    if (contentKey(local) === contentKey(remote)) {
      unchanged += 1;
      continue;
    }
    if (mode === 'push') {
      ops.push({ direction: 'push', source: local, conflict: false });
    } else if (mode === 'pull') {
      ops.push({ direction: 'pull', source: remote, conflict: false });
    } else {
      // two-way: both changed since they diverged — newest edit wins
      const localTime = Date.parse(local.updatedAt) || 0;
      const remoteTime = Date.parse(remote.updatedAt) || 0;
      if (localTime === remoteTime) {
        unchanged += 1; // indistinguishable — leave both alone rather than guess
        continue;
      }
      ops.push(
        localTime > remoteTime
          ? { direction: 'push', source: local, conflict: true }
          : { direction: 'pull', source: remote, conflict: true }
      );
    }
  }
  planned += ops.length;

  const ordered = orderOps(ops, (direction, id) =>
    direction === 'push' ? remoteById.has(id) : localById.has(id)
  );

  let opsSettled = 0; // ordered ops fully attempted this run (aborted op ≠ settled)
  if (!dryRun) {
    const viewer = viewerOf({ id: user.id, username: user.username });
    for (const op of ordered) {
      if (executed >= MAX_SYNC_OPS_PER_RUN) break;
      // the other half of the budget: ops left after this fires are reported as
      // `remaining`, same as ops left by MAX_SYNC_OPS_PER_RUN
      if (syncBudgetSpent(opsSettled, Date.now() - startedAtMs)) break;
      executed += 1;
      if (op.direction === 'push') {
        const result = await remotePutThing(link.baseUrl, link.token, putBodyFor(op.source));
        if (isFail(result)) {
          if (result.status === 429 || result.status === 401) {
            pushError(
              result.status === 429
                ? 'the linked deployment rate-limited the sync — run it again in a minute to continue'
                : `push stopped: ${result.error}`
            );
            break;
          }
          if (result.status === 409) unchanged += 1; // e.g. reaction already exists there
          else if (result.status === 404) {
            // an id can exist on the destination under ANOTHER account — a
            // per-deployment uniqueness collision, permanent for this thing
            pushError(`push ${op.source.id}: that id belongs to a different account over there — skipped`);
          } else pushError(`push ${op.source.id}: ${result.error}`);
          opsSettled += 1;
          continue;
        }
        pushed += 1;
        opsSettled += 1;
        if (op.conflict) conflictsResolved += 1;
      } else {
        const result = await upsertThing(user.id, putBodyFor(op.source) as any, viewer);
        if (result.ok === false) {
          if (result.status === 409) unchanged += 1;
          else if (result.status === 404) {
            // upsertThing answers 404 when the shareId exists here under a
            // different owner — same collision as the push case above
            pushError(`pull ${op.source.id}: that id belongs to a different account on this deployment — skipped`);
          } else pushError(`pull ${op.source.id}: ${result.error}`);
          opsSettled += 1;
          continue;
        }
        pulled += 1;
        opsSettled += 1;
        if (op.conflict) conflictsResolved += 1;
      }
    }
  }

  const remaining = dryRun ? planned : Math.max(0, ordered.length - opsSettled);

  return {
    mode: link.syncMode,
    dryRun,
    startedAt,
    finishedAt: new Date().toISOString(),
    scannedLocal: localScan.things.length,
    scannedRemote: remoteScan.things.length,
    planned,
    pushed,
    pulled,
    unchanged,
    conflictsResolved,
    remaining,
    truncatedScan: localScan.truncated || remoteScan.truncated,
    errors
  };
};
