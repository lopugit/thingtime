import { createHash } from 'node:crypto';

import { getHomeThingsCollection, getThingsCollection } from '../mongodb/collections';
import { toPublicPosts, viewerOf, type PublicPost } from '../things/things';
import {
  connectionProviderById,
  publicProviders,
  FEED_FETCH_LIMIT,
  type ConnectionProvider,
  type ExternalFeedItem,
  type ResolvedExternalAccount
} from './providers';
import { ACL_ALL, ACL_OWNER, ACL_USER_PREFIX, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';

// Third-party app connections (FUNDAMENTALS.md §3). Three protected kinds:
//
//   • `external-account` — ONE thing per (provider, external identity), shared
//     by every Thingtime account that links it (deterministic shareId). Profile
//     metadata lives in crystal; future OAuth tokens live in the root `secure`
//     BinData blob, never crystal. HOME-pinned: a custom data-plane endpoint
//     can never capture identities or credentials.
//   • `external-account-link` — the many-to-many join: this Thingtime user ↔
//     that external account. ownerId = the linking user. HOME-pinned.
//   • `external-post` — one synced feed item, deterministic `ext-post-…`
//     shareId so re-syncs are idempotent upserts (CI-store pattern, including
//     the source-timestamp not-older guard). Lives on the DATA plane so
//     Thingtime comments/reactions attach to it by targetId exactly like any
//     native post, and /post/:id permalinks resolve. Public-content providers
//     write tt:all posts; personal-algorithm providers grant each linked user
//     individually (tt:user/<username>, refreshed on every sync).
//
// The `ext-` shareId prefix is reserved in sanitizeShareId so clients can
// never squat a sync destination, and all three kinds are PROTECTED_THINGTIME
// so generic CRUD can't forge links (privilege escalation) or mutate synced
// content.

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export const EXTERNAL_ACCOUNT_KIND = 'external-account';
export const EXTERNAL_LINK_KIND = 'external-account-link';
export const EXTERNAL_POST_KIND = 'external-post';

const MAX_LINKS_PER_USER = 50;
// don't hammer providers: a per-account fetch at most once per window; reads
// inside the window serve the already-synced posts
const SYNC_COOLDOWN_MS = 60_000;
const DEFAULT_FEED_PAGE = 20;
const MAX_FEED_PAGE = 50;

const sha48 = (parts: string[]): string => {
  const hash = createHash('sha256');
  parts.forEach((part, index) => {
    if (index) hash.update('\0');
    hash.update(part);
  });
  return hash.digest('hex').slice(0, 48);
};

export const externalAccountShareId = (provider: string, providerAccountId: string): string =>
  `ext-account-${sha48([provider, providerAccountId])}`;

export const externalLinkShareId = (userId: string, accountShareId: string): string =>
  `ext-link-${sha48([userId, accountShareId])}`;

export const externalPostShareId = (provider: string, externalId: string): string =>
  `ext-post-${sha48([provider, externalId])}`;

type SessionUser = { id: string; username: string };

// --- projections ------------------------------------------------------------

export type PublicConnection = {
  id: string; // the link's shareId — the handle every management call takes
  provider: string;
  providerName: string;
  providerIcon: string;
  contentVisibility: 'public' | 'personal';
  account: {
    id: string;
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    profileUrl: string | null;
  };
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  createdAt: string | null;
};

const toPublicConnection = (linkDoc: any, accountDoc: any, provider: ConnectionProvider | null): PublicConnection => ({
  id: String(linkDoc?.shareId || ''),
  provider: String(linkDoc?.crystal?.provider || ''),
  providerName: provider?.name || String(linkDoc?.crystal?.provider || ''),
  providerIcon: provider?.icon || '🔌',
  contentVisibility: provider?.contentVisibility === 'personal' ? 'personal' : 'public',
  account: {
    id: String(accountDoc?.shareId || linkDoc?.crystal?.accountId || ''),
    handle: String(accountDoc?.crystal?.handle || ''),
    displayName: String(accountDoc?.crystal?.displayName || ''),
    avatarUrl: typeof accountDoc?.crystal?.avatarUrl === 'string' ? accountDoc.crystal.avatarUrl : null,
    profileUrl: typeof accountDoc?.crystal?.profileUrl === 'string' ? accountDoc.crystal.profileUrl : null
  },
  lastSyncedAt: accountDoc?.crystal?.lastSyncedAt instanceof Date ? accountDoc.crystal.lastSyncedAt.toISOString() : null,
  lastSyncError: typeof accountDoc?.crystal?.lastSyncError === 'string' && accountDoc.crystal.lastSyncError ? accountDoc.crystal.lastSyncError : null,
  createdAt: linkDoc?.createdAt instanceof Date ? linkDoc.createdAt.toISOString() : null
});

export const listProviders = () => publicProviders();

// --- connect / list / unlink ------------------------------------------------

export const connectProvider = async (
  user: SessionUser,
  input: { provider?: unknown; fields?: unknown }
): Promise<{ ok: true; connection: PublicConnection; alreadyLinked: boolean } | Fail> => {
  const provider = connectionProviderById(input.provider);
  if (!provider) return fail(400, 'Unknown provider');
  if (!provider.configured()) return fail(400, `${provider.name} is not configured on this deployment yet`);

  const rawFields = input.fields && typeof input.fields === 'object' && !Array.isArray(input.fields) ? (input.fields as Record<string, unknown>) : {};
  const fields: Record<string, string> = {};
  for (const field of provider.fields) {
    const value = rawFields[field.key];
    if (typeof value === 'string' && value.trim()) fields[field.key] = value.trim().slice(0, 1500);
    else if (field.required) return fail(400, `${field.label} is required`);
  }

  const home = await getHomeThingsCollection();
  const existingCount = await home.countDocuments({ thingtime: EXTERNAL_LINK_KIND, ownerId: user.id });
  if (existingCount >= MAX_LINKS_PER_USER) return fail(400, `You can hold at most ${MAX_LINKS_PER_USER} connections`);

  const resolved = await provider.resolveAccount(fields);
  if (resolved.ok === false) return resolved;

  const account = resolved.account;
  const accountShareId = externalAccountShareId(provider.id, account.providerAccountId);
  const linkId = externalLinkShareId(user.id, accountShareId);
  const now = new Date();

  // account first (shared across all linking users — refresh the public
  // profile crystal on every connect, identity only on insert)
  await home.updateOne(
    { shareId: accountShareId, thingtime: EXTERNAL_ACCOUNT_KIND },
    {
      $set: {
        'crystal.displayName': account.displayName,
        'crystal.handle': account.handle,
        'crystal.avatarUrl': account.avatarUrl,
        'crystal.profileUrl': account.profileUrl,
        'crystal.config': account.config,
        updatedAt: now
      },
      $setOnInsert: {
        schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
        shareId: accountShareId,
        thingtime: [EXTERNAL_ACCOUNT_KIND],
        'crystal.provider': provider.id,
        'crystal.providerAccountId': account.providerAccountId,
        ownerId: 'system',
        acl: [],
        storageClass: 'control',
        targetId: null,
        tags: [],
        createdAt: now
      }
    },
    { upsert: true }
  );

  let alreadyLinked = true;
  try {
    const linked = await home.updateOne(
      { shareId: linkId, thingtime: EXTERNAL_LINK_KIND },
      {
        $setOnInsert: {
          schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
          shareId: linkId,
          thingtime: [EXTERNAL_LINK_KIND],
          crystal: {
            provider: provider.id,
            accountId: accountShareId,
            userId: user.id,
            username: user.username
          },
          ownerId: user.id,
          acl: [ACL_OWNER],
          storageClass: 'control',
          targetId: null,
          tags: [],
          createdAt: now,
          updatedAt: now
        }
      },
      { upsert: true }
    );
    alreadyLinked = linked.upsertedCount === 0;
  } catch (err: any) {
    if (err?.code !== 11000) throw err; // lost the upsert race — link exists
  }

  const [linkDoc, accountDoc] = await Promise.all([
    home.findOne({ shareId: linkId, thingtime: EXTERNAL_LINK_KIND }),
    home.findOne({ shareId: accountShareId, thingtime: EXTERNAL_ACCOUNT_KIND })
  ]);
  return { ok: true, connection: toPublicConnection(linkDoc, accountDoc, provider), alreadyLinked };
};

const linksWithAccounts = async (userId: string, linkId?: string | null) => {
  const home = await getHomeThingsCollection();
  const linkMatch: Record<string, any> = { thingtime: EXTERNAL_LINK_KIND, ownerId: userId };
  if (linkId) linkMatch.shareId = linkId;
  const links = await home.find(linkMatch).sort({ createdAt: 1 }).toArray();
  const accountIds = [...new Set(links.map((link: any) => String(link?.crystal?.accountId || '')).filter(Boolean))];
  const accounts = accountIds.length
    ? await home.find({ shareId: { $in: accountIds }, thingtime: EXTERNAL_ACCOUNT_KIND }).toArray()
    : [];
  const accountsById = new Map(accounts.map((doc: any) => [String(doc.shareId), doc]));
  return links.map((link: any) => ({ link, account: accountsById.get(String(link?.crystal?.accountId || '')) || null }));
};

export const listConnections = async (user: SessionUser): Promise<{ ok: true; connections: PublicConnection[] }> => {
  const pairs = await linksWithAccounts(user.id);
  return {
    ok: true,
    connections: pairs.map(({ link, account }) =>
      toPublicConnection(link, account, connectionProviderById(link?.crystal?.provider))
    )
  };
};

export const unlinkConnection = async (
  user: SessionUser,
  input: { id?: unknown }
): Promise<{ ok: true; removed: boolean } | Fail> => {
  const linkId = typeof input.id === 'string' ? input.id.trim() : '';
  if (!linkId) return fail(400, 'id (the connection id) is required');
  const home = await getHomeThingsCollection();
  const link: any = await home.findOne({ shareId: linkId, thingtime: EXTERNAL_LINK_KIND, ownerId: user.id });
  if (!link) return fail(404, 'Connection not found');
  await home.deleteOne({ shareId: linkId, thingtime: EXTERNAL_LINK_KIND, ownerId: user.id });
  // last link gone → retire the shared account thing (and any credentials in
  // its secure blob); synced external posts stay — they are inert public/
  // granted content other users' comments may hang off
  const accountId = String(link?.crystal?.accountId || '');
  if (accountId) {
    const remaining = await home.countDocuments({ thingtime: EXTERNAL_LINK_KIND, 'crystal.accountId': accountId });
    if (remaining === 0) {
      await home.deleteOne({ shareId: accountId, thingtime: EXTERNAL_ACCOUNT_KIND });
    }
  }
  return { ok: true, removed: true };
};

// --- feed sync + read -------------------------------------------------------

const composePostText = (item: ExternalFeedItem): string => {
  const title = (item.title || '').trim();
  const body = (item.text || '').trim();
  if (title && body) return `${title}\n\n${body}`;
  return title || body || (item.url ? item.url : '');
};

// Idempotent upsert of one provider item as an external-post thing — the CI
// current-state pattern: $set refreshes content guarded by source timestamp,
// $setOnInsert stamps identity. Personal-visibility posts additionally
// $addToSet the syncing viewer's grant so every linked user earns access on
// their own sync (and never anyone else).
const upsertExternalPosts = async (
  provider: ConnectionProvider,
  accountShareId: string,
  items: ExternalFeedItem[],
  viewerGrant: string | null
): Promise<number> => {
  if (!items.length) return 0;
  const things = await getThingsCollection();
  const now = new Date();
  const operations = items.map((item) => {
    const shareId = externalPostShareId(provider.id, item.externalId);
    const publishedAt = item.publishedAt || now;
    const baseAcl = provider.contentVisibility === 'public' ? [ACL_ALL] : viewerGrant ? [viewerGrant] : [];
    return {
      updateOne: {
        filter: {
          shareId,
          thingtime: EXTERNAL_POST_KIND,
          $or: [{ 'crystal.sourceUpdatedAt': { $lte: now } }, { 'crystal.sourceUpdatedAt': { $exists: false } }]
        },
        update: {
          $set: {
            'crystal.type': 'text',
            'crystal.text': composePostText(item),
            'crystal.images': item.images,
            'crystal.provider': provider.id,
            'crystal.externalId': item.externalId,
            'crystal.accountId': accountShareId,
            'crystal.publishedAt': publishedAt,
            'crystal.sourceUpdatedAt': now,
            extended: {
              external: {
                provider: provider.id,
                providerName: provider.name,
                providerIcon: provider.icon,
                externalId: item.externalId,
                url: item.url,
                title: item.title,
                author: item.author,
                stats: item.stats,
                publishedAt: publishedAt.toISOString()
              }
            },
            updatedAt: now
          },
          ...(viewerGrant && provider.contentVisibility === 'personal' ? { $addToSet: { acl: viewerGrant } } : {}),
          $setOnInsert: {
            schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
            shareId,
            thingtime: [EXTERNAL_POST_KIND],
            ownerId: 'system',
            ...(provider.contentVisibility === 'personal' ? {} : { acl: baseAcl }),
            storageClass: 'control',
            targetId: null,
            tags: [],
            // feed ordering rides createdAt like every other things surface
            createdAt: publishedAt
          }
        },
        upsert: true
      }
    };
  });
  try {
    const result = await things.bulkWrite(operations as any, { ordered: false });
    return (result.upsertedCount || 0) + (result.modifiedCount || 0);
  } catch (err: any) {
    // duplicate-key races (two linked users syncing the same account at once)
    // mean the other sync landed the doc — the $addToSet grant retries below
    if (err?.code !== 11000 && !err?.writeErrors?.every?.((error: any) => error?.code === 11000)) throw err;
    if (viewerGrant && provider.contentVisibility === 'personal') {
      const shareIds = items.map((item) => externalPostShareId(provider.id, item.externalId));
      await things.updateMany(
        { shareId: { $in: shareIds }, thingtime: EXTERNAL_POST_KIND },
        { $addToSet: { acl: viewerGrant } }
      );
    }
    return 0;
  }
};

// Personal-visibility accounts grant each linked viewer on THEIR reads, not
// only on the fetch that first synced a post — the fetch cooldown is shared
// per account, so a second linked user's read may skip the fetch entirely and
// must still earn its acl grants. Indexed, idempotent, usually matches zero.
const ensureViewerGrant = async (accountShareId: string, viewerGrant: string) => {
  const things = await getThingsCollection();
  await things.updateMany(
    { thingtime: EXTERNAL_POST_KIND, 'crystal.accountId': accountShareId, acl: { $ne: viewerGrant } },
    { $addToSet: { acl: viewerGrant } }
  );
};

const markAccountSync = async (accountShareId: string, error: string | null) => {
  const home = await getHomeThingsCollection();
  await home.updateOne(
    { shareId: accountShareId, thingtime: EXTERNAL_ACCOUNT_KIND },
    { $set: { 'crystal.lastSyncedAt': new Date(), 'crystal.lastSyncError': error, updatedAt: new Date() } }
  );
};

export type ConnectionsFeedResult = {
  ok: true;
  posts: PublicPost[];
  nextCursor: string | null;
  connections: PublicConnection[];
  synced: { connectionId: string; provider: string; fetched: number; skipped: boolean; error: string | null }[];
};

export const readConnectionsFeed = async (
  user: SessionUser,
  query: { connectionId?: string | null; cursor?: string | null; limit?: number; forceSync?: boolean }
): Promise<ConnectionsFeedResult | Fail> => {
  const pairs = await linksWithAccounts(user.id, query.connectionId || null);
  if (query.connectionId && !pairs.length) return fail(404, 'Connection not found');

  const viewerGrant = `${ACL_USER_PREFIX}${user.username.toLowerCase()}`;
  const synced: ConnectionsFeedResult['synced'] = [];

  // sync pass — per account, cooldown-gated, bounded concurrency
  const syncTargets = pairs.filter(({ account }) => !!account);
  const CONCURRENCY = 4;
  for (let start = 0; start < syncTargets.length; start += CONCURRENCY) {
    await Promise.all(
      syncTargets.slice(start, start + CONCURRENCY).map(async ({ link, account }) => {
        const provider = connectionProviderById(account?.crystal?.provider);
        const connectionId = String(link.shareId);
        if (!provider) {
          synced.push({ connectionId, provider: String(account?.crystal?.provider || ''), fetched: 0, skipped: true, error: 'Unknown provider' });
          return;
        }
        if (provider.contentVisibility === 'personal') {
          await ensureViewerGrant(String(account.shareId), viewerGrant);
        }
        const lastSyncedAt = account?.crystal?.lastSyncedAt instanceof Date ? account.crystal.lastSyncedAt.getTime() : 0;
        if (!query.forceSync && Date.now() - lastSyncedAt < SYNC_COOLDOWN_MS) {
          synced.push({ connectionId, provider: provider.id, fetched: 0, skipped: true, error: null });
          return;
        }
        const fetched = await provider.fetchFeed(
          { providerAccountId: String(account?.crystal?.providerAccountId || ''), config: account?.crystal?.config || {} },
          { limit: FEED_FETCH_LIMIT }
        );
        if (fetched.ok === false) {
          await markAccountSync(String(account.shareId), fetched.error);
          synced.push({ connectionId, provider: provider.id, fetched: 0, skipped: false, error: fetched.error });
          return;
        }
        const written = await upsertExternalPosts(provider, String(account.shareId), fetched.items, viewerGrant);
        await markAccountSync(String(account.shareId), null);
        synced.push({ connectionId, provider: provider.id, fetched: written, skipped: false, error: null });
      })
    );
  }

  // read pass — membership (the link) IS the authorization: only linked
  // accounts' posts are queried, newest first
  const accountIds = syncTargets.map(({ account }) => String(account.shareId));
  let posts: PublicPost[] = [];
  let nextCursor: string | null = null;
  if (accountIds.length) {
    const limit = Math.min(Math.max(1, query.limit || DEFAULT_FEED_PAGE), MAX_FEED_PAGE);
    const match: Record<string, any> = { thingtime: EXTERNAL_POST_KIND, 'crystal.accountId': { $in: accountIds } };
    const cursorMatch = typeof query.cursor === 'string' ? query.cursor.match(/^(\d{1,16})_(.+)$/) : null;
    if (cursorMatch) {
      const ts = new Date(Number(cursorMatch[1]));
      match.$or = [{ createdAt: { $lt: ts } }, { createdAt: ts, shareId: { $gt: cursorMatch[2] } }];
    }
    const things = await getThingsCollection();
    const docs: any[] = await things
      .find(match)
      .sort({ createdAt: -1, shareId: 1 })
      .limit(limit + 1)
      .toArray();
    const page = docs.slice(0, limit);
    const last = page[page.length - 1];
    nextCursor = docs.length > limit && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null;

    // toPublicPosts surfaces the third-party author from extended.external
    // (same path the /post/:id permalink uses)
    posts = await toPublicPosts(page as any, viewerOf({ id: user.id, username: user.username }));
  }

  return {
    ok: true,
    posts,
    nextCursor,
    connections: pairs.map(({ link, account }) => toPublicConnection(link, account, connectionProviderById(link?.crystal?.provider))),
    synced
  };
};
