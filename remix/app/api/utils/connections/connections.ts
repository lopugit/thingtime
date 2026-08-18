import type { Binary } from 'mongodb';

import { fromBin, toBin } from '../auth/users';
import { getHomeThingsCollection, getThingsCollection } from '../mongodb/collections';
import { chronoCursorClause, parseChronoCursor, toPublicPosts, viewerOf, type PublicPost } from '../things/things';
import {
  connectionProviderById,
  oauthCredsFor,
  publicProviders,
  resolveYoutubeChannelQuery,
  sanitizeChannelList,
  youtubeApiKey,
  FEED_FETCH_LIMIT,
  MAX_FEED_PAGES,
  MAX_VIRTUAL_CHANNELS,
  type ConnectionProvider,
  type ExternalFeedItem,
  type OAuthTokens,
  type ResolvedExternalAccount,
  type YoutubeChannelRef
} from './providers';
import { fail, sha48, type Fail } from './shared';
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

export const EXTERNAL_ACCOUNT_KIND = 'external-account';
export const EXTERNAL_LINK_KIND = 'external-account-link';
export const EXTERNAL_POST_KIND = 'external-post';

const MAX_LINKS_PER_USER = 50;
// FUNDAMENTALS §3 bound: each linked user of a personal account adds one acl
// grant to that account's posts, so linkers-per-account must be finite for the
// embedded acl array to stay bounded. (The long-term §3-clean evolution is
// relational per-(post, member) grant docs.)
const MAX_LINKS_PER_ACCOUNT = 100;
// don't hammer providers: a per-account fetch at most once per window; reads
// inside the window serve the already-synced posts
const SYNC_COOLDOWN_MS = 60_000;
const DEFAULT_FEED_PAGE = 20;
const MAX_FEED_PAGE = 50;

export const externalAccountShareId = (provider: string, providerAccountId: string): string =>
  `ext-account-${sha48([provider, providerAccountId])}`;

export const externalLinkShareId = (userId: string, accountShareId: string): string =>
  `ext-link-${sha48([userId, accountShareId])}`;

// namespace defaults to the provider id; providers surfacing the same
// underlying content share one namespace (both YouTube providers → 'youtube')
// so the same video stays ONE post no matter how it arrived
export const externalPostShareId = (namespace: string, externalId: string): string =>
  `ext-post-${sha48([namespace, externalId])}`;

const postNamespaceOf = (provider: ConnectionProvider): string => provider.postNamespace || provider.id;

type SessionUser = { id: string; username: string };

// --- secure token blob ------------------------------------------------------
// OAuth token responses live under the account's root `secure` field as ONE
// BinData blob (users.ts precedent: the $** wildcard text index tokenizes
// string fields only, so a binary blob is entirely unsearchable). Never in
// crystal, never projected, never sent to a client. Last connector wins —
// several Thingtime users linking the same external account share its
// freshest credentials, exactly like the shared profile crystal.
type ConnectionSecurePayload = { tokens?: OAuthTokens | null };

// shared builder from auth/users.ts — nothing hand-rolls the binary encoding
const packConnectionSecure = (payload: ConnectionSecurePayload): Binary => toBin(JSON.stringify(payload));

const unpackConnectionSecure = (value: unknown): ConnectionSecurePayload => {
  const raw = fromBin(value as any);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as ConnectionSecurePayload) : {};
  } catch {
    return {};
  }
};

const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

// --- projections ------------------------------------------------------------

export type PublicConnection = {
  id: string; // the link's shareId — the handle every management call takes
  provider: string;
  providerName: string;
  providerIcon: string;
  contentVisibility: 'public' | 'personal';
  auth: 'none' | 'oauth2';
  account: {
    id: string;
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    profileUrl: string | null;
  };
  // youtube virtual-subscription connections carry their managed channel list
  channels?: YoutubeChannelRef[];
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
  auth: provider?.oauth ? 'oauth2' : 'none',
  account: {
    id: String(accountDoc?.shareId || linkDoc?.crystal?.accountId || ''),
    handle: String(accountDoc?.crystal?.handle || ''),
    displayName: String(accountDoc?.crystal?.displayName || ''),
    avatarUrl: typeof accountDoc?.crystal?.avatarUrl === 'string' ? accountDoc.crystal.avatarUrl : null,
    profileUrl: typeof accountDoc?.crystal?.profileUrl === 'string' ? accountDoc.crystal.profileUrl : null
  },
  ...(provider?.id === 'youtube' ? { channels: sanitizeChannelList(accountDoc?.crystal?.config?.channels) } : {}),
  lastSyncedAt: accountDoc?.crystal?.lastSyncedAt instanceof Date ? accountDoc.crystal.lastSyncedAt.toISOString() : null,
  lastSyncError: typeof accountDoc?.crystal?.lastSyncError === 'string' && accountDoc.crystal.lastSyncError ? accountDoc.crystal.lastSyncError : null,
  createdAt: linkDoc?.createdAt instanceof Date ? linkDoc.createdAt.toISOString() : null
});

export const listProviders = () => publicProviders();

// --- connect / list / unlink ------------------------------------------------

// Shared by the fields-based connect AND the OAuth callback: upsert the
// (possibly shared) external account — sealing fresh OAuth tokens into its
// secure blob when given — then the caller's link. Idempotent end to end.
export const upsertAccountAndLink = async (
  user: SessionUser,
  provider: ConnectionProvider,
  account: ResolvedExternalAccount,
  tokens?: OAuthTokens | null
): Promise<{ ok: true; connection: PublicConnection; alreadyLinked: boolean } | Fail> => {
  const home = await getHomeThingsCollection();
  const accountShareId = externalAccountShareId(provider.id, account.providerAccountId);
  const linkId = externalLinkShareId(user.id, accountShareId);

  // idempotent reconnects (incl. SSO token reseals) must never trip the caps —
  // only creating a NEW link counts against them
  const existingLink = await home.findOne({ shareId: linkId, thingtime: EXTERNAL_LINK_KIND }, { projection: { _id: 1 } });
  if (!existingLink) {
    const [userLinks, accountLinks] = await Promise.all([
      home.countDocuments({ thingtime: EXTERNAL_LINK_KIND, ownerId: user.id }),
      home.countDocuments({ thingtime: EXTERNAL_LINK_KIND, 'crystal.accountId': accountShareId })
    ]);
    if (userLinks >= MAX_LINKS_PER_USER) return fail(400, `You can hold at most ${MAX_LINKS_PER_USER} connections`);
    if (accountLinks >= MAX_LINKS_PER_ACCOUNT) {
      return fail(400, `That external account is already linked by ${MAX_LINKS_PER_ACCOUNT} Thingtime accounts — its limit is reached`);
    }
  }

  // server-side-mutable config (the virtual channel list) merges on reconnect
  // instead of being replaced, so re-connecting can never wipe managed state
  const existingAccount: any = provider.mergeConfig
    ? await home.findOne({ shareId: accountShareId, thingtime: EXTERNAL_ACCOUNT_KIND }, { projection: { 'crystal.config': 1 } })
    : null;
  const config =
    provider.mergeConfig && existingAccount?.crystal?.config
      ? provider.mergeConfig(existingAccount.crystal.config, account.config)
      : account.config;
  // display fields derive from the MERGED state, not the fresh resolve
  let handle = account.handle;
  let avatarUrl = account.avatarUrl;
  if (provider.id === 'youtube') {
    const channels = sanitizeChannelList(config.channels);
    handle = `${channels.length} channel${channels.length === 1 ? '' : 's'}`;
    avatarUrl = channels[0]?.thumbnail || null;
  }

  const now = new Date();
  // account first (shared across all linking users — refresh the public
  // profile crystal and, for SSO, the sealed tokens on every connect;
  // identity only on insert)
  await home.updateOne(
    { shareId: accountShareId, thingtime: EXTERNAL_ACCOUNT_KIND },
    {
      $set: {
        'crystal.displayName': account.displayName,
        'crystal.handle': handle,
        'crystal.avatarUrl': avatarUrl,
        'crystal.profileUrl': account.profileUrl,
        'crystal.config': config,
        // a fresh sign-in clears any stale reconnect-needed state
        ...(tokens ? { secure: packConnectionSecure({ tokens }), 'crystal.lastSyncError': null } : {}),
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

export const connectProvider = async (
  user: SessionUser,
  input: { provider?: unknown; fields?: unknown }
): Promise<{ ok: true; connection: PublicConnection; alreadyLinked: boolean } | Fail> => {
  const provider = connectionProviderById(input.provider);
  if (!provider) return fail(400, 'Unknown provider');
  // SSO providers never take fields — point at the OAuth flow whether or not
  // their credentials are configured yet
  if (provider.oauth) {
    return fail(400, `${provider.name} links through its own sign-in — use POST /api/v1/connections/oauth/begin`);
  }
  if (!provider.configured()) return fail(400, `${provider.name} is not configured on this deployment yet`);

  const rawFields = input.fields && typeof input.fields === 'object' && !Array.isArray(input.fields) ? (input.fields as Record<string, unknown>) : {};
  const fields: Record<string, string> = {};
  for (const field of provider.fields) {
    const value = rawFields[field.key];
    if (typeof value === 'string' && value.trim()) fields[field.key] = value.trim().slice(0, 1500);
    else if (field.required) return fail(400, `${field.label} is required`);
  }

  if (!provider.resolveAccount) return fail(400, `${provider.name} cannot be connected with form fields`);
  const resolved = await provider.resolveAccount(fields, { userId: user.id });
  if (resolved.ok === false) return resolved;
  // credential providers exchange the typed secret for session tokens —
  // sealed into the secure blob exactly like an OAuth token response
  return upsertAccountAndLink(user, provider, resolved.account, resolved.account.tokens || null);
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
  const accountId = String(link?.crystal?.accountId || '');
  if (accountId) {
    // membership IS the authorization: revoke this member's acl grants from
    // the account's personal posts. (If they still read them through ANOTHER
    // link whose account also sources a post, ensureViewerGrant re-grants on
    // their next read of that connection.)
    const provider = connectionProviderById(link?.crystal?.provider);
    if (provider?.contentVisibility === 'personal') {
      const things = await getThingsCollection();
      const grant = `${ACL_USER_PREFIX}${user.username.toLowerCase()}`;
      await things.updateMany(
        { thingtime: EXTERNAL_POST_KIND, sourceIds: accountId, acl: grant },
        { $pull: { acl: grant } }
      );
    }
    // last link gone → retire the shared account thing (and any credentials in
    // its secure blob); synced external posts stay — they are inert public/
    // granted content other users' comments may hang off
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
// Feed ordering rides createdAt; provider dates are attacker-influenced, so
// clamp them to a sane window — a pre-1970 (or far-future) stamp would mint
// cursors the pager rejects and loop pagination forever.
const PUBLISHED_AT_FLOOR = Date.parse('1990-01-01T00:00:00Z');
const clampPublishedAt = (value: Date | null, now: Date): Date => {
  const ms = value?.getTime();
  if (ms === undefined || !Number.isFinite(ms)) return now;
  if (ms < PUBLISHED_AT_FLOOR) return new Date(PUBLISHED_AT_FLOOR);
  if (ms > now.getTime() + 24 * 3600 * 1000) return now;
  return value as Date;
};

const upsertExternalPosts = async (
  provider: ConnectionProvider,
  accountShareId: string,
  items: ExternalFeedItem[],
  viewerGrant: string | null
): Promise<number> => {
  if (!items.length) return 0;
  const things = await getThingsCollection();
  const now = new Date();
  const namespace = postNamespaceOf(provider);
  // one post, many sources: the SAME video/post reached through a second
  // account (another user's virtual channel list, a real subscription,
  // another subreddit multi …) lists every source and stays ONE doc —
  // comments and reactions unify on it. One membership object serves the
  // main path AND the race retry so the two can never diverge.
  const membership = {
    sourceIds: accountShareId,
    ...(viewerGrant && provider.contentVisibility === 'personal' ? { acl: viewerGrant } : {})
  };
  const operations = items.map((item) => {
    const shareId = externalPostShareId(namespace, item.externalId);
    const publishedAt = clampPublishedAt(item.publishedAt, now);
    const baseAcl = provider.contentVisibility === 'public' ? [ACL_ALL] : viewerGrant ? [viewerGrant] : [];
    return {
      updateOne: {
        // latest fetch wins by design (each sync fetches CURRENT provider
        // state), so no source-timestamp guard — a guard against wall-clock
        // time was vacuous and clock-skew could silently drop whole batches
        filter: { shareId, thingtime: EXTERNAL_POST_KIND },
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
          $addToSet: membership,
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
    // Only a batch whose EVERY write error is a duplicate-key race (two
    // linked users syncing the same account at once) is benign; a mixed batch
    // hides real failures behind err.code (which mirrors the FIRST error).
    const writeErrors = Array.isArray(err?.writeErrors) ? err.writeErrors : null;
    const benign = writeErrors ? writeErrors.every((error: any) => error?.code === 11000) : err?.code === 11000;
    if (!benign) throw err;
    const shareIds = items.map((item) => externalPostShareId(namespace, item.externalId));
    await things.updateMany({ shareId: { $in: shareIds }, thingtime: EXTERNAL_POST_KIND }, { $addToSet: membership });
    return 0;
  }
};

// Personal-visibility accounts grant each linked viewer on THEIR reads, not
// only on the fetch that first synced a post — the fetch cooldown is shared
// per account, so a second linked user's read may skip the fetch entirely and
// must still earn its acl grants. Indexed, idempotent, usually matches zero.
const ensureViewerGrant = async (accountShareId: string, viewerGrant: string) => {
  const things = await getThingsCollection();
  // membership truth is the sourceIds array (crystal.accountId is a last-
  // writer-wins display field a multi-source post may have flipped)
  await things.updateMany(
    { thingtime: EXTERNAL_POST_KIND, sourceIds: accountShareId, acl: { $ne: viewerGrant } },
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

// Unseal, and when near expiry re-mint, an SSO account's tokens. Refreshed
// tokens persist back into the secure blob so every linked user benefits.
const liveTokensFor = async (provider: ConnectionProvider, accountDoc: any): Promise<OAuthTokens | null> => {
  if (!provider.oauth && provider.auth !== 'credential') return null;
  const tokens = unpackConnectionSecure(accountDoc?.secure).tokens || null;
  if (!tokens?.accessToken) return null;
  const expiresAt = tokens.expiresAt ? Date.parse(tokens.expiresAt) : NaN;
  // an unknown expiry counts as expiring — providers with a refresh grant get
  // a chance to mint a token whose lifetime we DO know
  const expiring = !Number.isFinite(expiresAt) || expiresAt - Date.now() < TOKEN_REFRESH_MARGIN_MS;
  const refreshFn = provider.oauth?.refreshTokens ?? provider.refreshTokens;
  if (!expiring || !refreshFn) return tokens;
  // credential providers (Bluesky sessions) refresh with the token pair
  // alone; OAuth refresh grants additionally need the client credentials
  const creds = provider.oauth ? oauthCredsFor(provider) : { clientId: '', clientSecret: '' };
  if (!creds) return tokens;
  const refreshed = await refreshFn(tokens, creds);
  if (!refreshed) return tokens; // expired + unrefreshable → the fetch's 401 surfaces "reconnect"
  const home = await getHomeThingsCollection();
  // compare-and-set on the exact blob we read: providers that ROTATE refresh
  // tokens (TikTok) invalidate the used one, so a lost concurrent-refresh race
  // must never clobber the winner's fresh rotation with a dead token
  const result = await home.updateOne(
    { shareId: String(accountDoc.shareId), thingtime: EXTERNAL_ACCOUNT_KIND, secure: accountDoc.secure },
    { $set: { secure: packConnectionSecure({ tokens: refreshed }), updatedAt: new Date() } }
  );
  if (result.matchedCount === 0) {
    // another refresh won — serve the winner's tokens
    const current = await home.findOne({ shareId: String(accountDoc.shareId), thingtime: EXTERNAL_ACCOUNT_KIND }, { projection: { secure: 1 } });
    return unpackConnectionSecure(current?.secure).tokens || refreshed;
  }
  return refreshed;
};

export const readConnectionsFeed = async (
  user: SessionUser,
  query: { connectionId?: string | null; cursor?: string | null; limit?: number; forceSync?: boolean; deepen?: boolean; deferSync?: boolean }
): Promise<ConnectionsFeedResult | Fail> => {
  const pairs = await linksWithAccounts(user.id, query.connectionId || null);
  if (query.connectionId && !pairs.length) return fail(404, 'Connection not found');

  const viewerGrant = `${ACL_USER_PREFIX}${user.username.toLowerCase()}`;
  const synced: ConnectionsFeedResult['synced'] = [];

  // sync pass — per account, cooldown-gated, bounded concurrency. Deepening
  // ("fetch older — I scrolled through what's here") raises the account's
  // stored page depth and bypasses the cooldown for this pass. deferSync
  // skips the pass entirely: the serverless-safe stale-while-revalidate read
  // (the client paints the stored page instantly, then re-requests without
  // defer so the provider fan-out never blocks first paint — background work
  // after the response is not reliable on serverless, so the revalidate is a
  // second REQUEST, not a dangling promise).
  const linkedPairs = pairs.filter(({ account }) => !!account);
  const syncTargets = query.deferSync ? [] : linkedPairs;
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
        const storedDepth = Math.min(Math.max(1, Number(account?.crystal?.syncDepth) || 1), MAX_FEED_PAGES);
        // deepening only bypasses the cooldown while it can actually go
        // deeper — at the cap it degrades to a normal cooldown-gated read so
        // a scroll-happy client can't hammer providers
        const canDeepen = !!query.deepen && storedDepth < MAX_FEED_PAGES;
        const pages = canDeepen ? storedDepth + 1 : storedDepth;
        const lastSyncedAt = account?.crystal?.lastSyncedAt instanceof Date ? account.crystal.lastSyncedAt.getTime() : 0;
        if (!query.forceSync && !canDeepen && Date.now() - lastSyncedAt < SYNC_COOLDOWN_MS) {
          synced.push({ connectionId, provider: provider.id, fetched: 0, skipped: true, error: null });
          return;
        }
        const tokens = await liveTokensFor(provider, account);
        const fetched = await provider.fetchFeed(
          { providerAccountId: String(account?.crystal?.providerAccountId || ''), config: account?.crystal?.config || {} },
          { limit: FEED_FETCH_LIMIT, tokens, pages }
        );
        if (fetched.ok === false) {
          await markAccountSync(String(account.shareId), fetched.error);
          synced.push({ connectionId, provider: provider.id, fetched: 0, skipped: false, error: fetched.error });
          return;
        }
        const written = await upsertExternalPosts(provider, String(account.shareId), fetched.items, viewerGrant);
        await markAccountSync(String(account.shareId), null);
        if (canDeepen) {
          const home = await getHomeThingsCollection();
          await home.updateOne(
            { shareId: String(account.shareId), thingtime: EXTERNAL_ACCOUNT_KIND },
            { $set: { 'crystal.syncDepth': pages } }
          );
        }
        synced.push({ connectionId, provider: provider.id, fetched: written, skipped: false, error: null });
      })
    );
  }

  // read pass — membership (the link) IS the authorization: only linked
  // accounts' posts are queried, newest first
  const accountIds = linkedPairs.map(({ account }) => String(account.shareId));
  let posts: PublicPost[] = [];
  let nextCursor: string | null = null;
  if (accountIds.length) {
    const limit = Math.min(Math.max(1, query.limit || DEFAULT_FEED_PAGE), MAX_FEED_PAGE);
    // membership rides the root sourceIds array ONLY (every sync stamps it,
    // and a second representation would defeat the partial index — the $or it
    // replaces forced a whole-partition scan since index-union subplanning
    // only applies to a rooted $or)
    const match: Record<string, any> = { thingtime: EXTERNAL_POST_KIND, sourceIds: { $in: accountIds } };
    // the shared chrono-cursor grammar from things.ts — one parser, one format
    const parsed = parseChronoCursor(query.cursor);
    const pageMatch = parsed ? { $and: [match, chronoCursorClause(parsed)] } : match;
    const things = await getThingsCollection();
    const docs: any[] = await things
      .find(pageMatch)
      .sort({ createdAt: -1, shareId: 1 })
      .limit(limit + 1)
      .toArray();
    const page = docs.slice(0, limit);
    const last = page[page.length - 1];
    const lastMs = last ? new Date(last.createdAt).getTime() : NaN;
    // never mint a cursor the parser would reject (dates are clamped at
    // upsert, but pre-clamp rows must not wedge pagination into a loop)
    nextCursor = docs.length > limit && last && Number.isFinite(lastMs) && lastMs > 0 ? `${lastMs}_${last.shareId}` : null;

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

// --- virtual YouTube subscriptions (ytsubber-style) --------------------------
// The user's Thingtime-managed channel list: search (Data API when a key is
// configured), then add/remove channels on the per-user virtual account. The
// first add auto-creates the connection, so "Subscribe" works from a search
// result with nothing linked yet.

export const searchYoutubeChannels = async (query: unknown) => {
  const result = await resolveYoutubeChannelQuery(typeof query === 'string' ? query : '');
  if (result.ok === false) return result;
  return { ok: true as const, channels: result.channels, via: result.via, searchConfigured: !!youtubeApiKey() };
};

export const updateYoutubeChannels = async (
  user: SessionUser,
  input: { add?: unknown; remove?: unknown }
): Promise<{ ok: true; connection: PublicConnection; channels: YoutubeChannelRef[] } | Fail> => {
  const provider = connectionProviderById('youtube');
  if (!provider) return fail(500, 'The YouTube provider is unavailable');

  const removeId = typeof input.remove === 'string' ? input.remove.trim() : '';
  let addChannel: YoutubeChannelRef | null = null;
  if (input.add !== undefined && input.add !== null) {
    // a search result passes {id,title,thumbnail}; free text resolves here
    if (typeof input.add === 'object' && typeof (input.add as any).id === 'string') {
      const [sanitized] = sanitizeChannelList([input.add]);
      if (!sanitized) return fail(400, 'add must carry a valid YouTube channel id');
      addChannel = sanitized;
    } else if (typeof input.add === 'string' && input.add.trim()) {
      const resolved = await resolveYoutubeChannelQuery(input.add);
      if (resolved.ok === false) return resolved;
      if (!resolved.channels.length) return fail(404, 'No channel matched that input');
      addChannel = resolved.channels[0];
    } else {
      return fail(400, 'add must be a channel reference or a search string');
    }
  }
  if (!addChannel && !removeId) return fail(400, 'Nothing to change — pass add and/or remove');

  // the per-user virtual account; first add auto-creates the connection
  const accountShareId = externalAccountShareId(provider.id, `subs:${user.id}`);
  const home = await getHomeThingsCollection();
  let accountDoc: any = await home.findOne({ shareId: accountShareId, thingtime: EXTERNAL_ACCOUNT_KIND });
  if (!accountDoc) {
    if (!addChannel) return fail(404, 'No YouTube channel list yet — add a channel first');
    const created = await upsertAccountAndLink(user, provider, {
      providerAccountId: `subs:${user.id}`,
      displayName: 'My YouTube channels',
      handle: '0 channels',
      avatarUrl: null,
      profileUrl: null,
      config: { channels: [] }
    });
    if (created.ok === false) return created;
    accountDoc = await home.findOne({ shareId: accountShareId, thingtime: EXTERNAL_ACCOUNT_KIND });
  }

  let channels = sanitizeChannelList(accountDoc?.crystal?.config?.channels);
  if (removeId) channels = channels.filter((channel) => channel.id !== removeId);
  if (addChannel && !channels.some((channel) => channel.id === addChannel!.id)) {
    if (channels.length >= MAX_VIRTUAL_CHANNELS) {
      return fail(400, `You can follow at most ${MAX_VIRTUAL_CHANNELS} channels in one list`);
    }
    channels = sanitizeChannelList([...channels, addChannel]);
  }

  await home.updateOne(
    { shareId: accountShareId, thingtime: EXTERNAL_ACCOUNT_KIND },
    {
      $set: {
        'crystal.config.channels': channels,
        'crystal.handle': `${channels.length} channel${channels.length === 1 ? '' : 's'}`,
        'crystal.avatarUrl': channels[0]?.thumbnail || null,
        // a changed list should sync fresh on the next read
        'crystal.lastSyncedAt': null,
        updatedAt: new Date()
      }
    }
  );

  const linkId = externalLinkShareId(user.id, accountShareId);
  const [linkDoc, refreshedAccount] = await Promise.all([
    home.findOne({ shareId: linkId, thingtime: EXTERNAL_LINK_KIND }),
    home.findOne({ shareId: accountShareId, thingtime: EXTERNAL_ACCOUNT_KIND })
  ]);
  if (!linkDoc) return fail(404, 'No YouTube connection found for this account');
  return { ok: true, connection: toPublicConnection(linkDoc, refreshedAccount, provider), channels };
};
