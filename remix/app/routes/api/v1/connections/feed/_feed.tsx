import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { readConnectionsFeed } from '~/api/utils/connections/connections';
import { applyFeedFilters } from '~/api/utils/connections/filters';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

// GET /api/v1/connections/feed — sync + read the caller's connected
// third-party feeds as Thingtime posts (comments/reactions attach natively).
// Query: connection=<id> narrows to one connection (default: all), cursor,
// limit, sync=force bypasses the per-account sync cooldown. Each post gains
// `feedFilterMatches` from the caller's enabled AI feed filters.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(request.url);

  // `sync=force` deliberately bypasses the per-account sync cooldown, so it is
  // one of the reads here that can fan out to every connected provider on
  // demand. Without a bound, repeating it is unlimited outbound calls on a
  // shared third-party quota — so a forced sync spends the tight provider
  // budget while ordinary (stored-page) reads use the generous read budget.
  // `deepen=1` bypasses that same cooldown (connections.ts: canDeepen skips the
  // cooldown gate) and additionally asks each provider for MORE pages, so it
  // spends the provider budget too — the per-account depth cap bounds how long
  // one account keeps bypassing, but not how many accounts a caller can drive
  // per minute.
  const forced = url.searchParams.get('sync') === 'force';
  const deepen = url.searchParams.get('deepen') === '1';
  const spendsProviderQuota = forced || deepen;
  const limit = await enforceRateLimit(request, spendsProviderQuota ? 'connections.provider' : 'connections.read', `user:${user.id}`);
  if (!limit.allowed) {
    return json({ ok: false, error: 'Refreshing connected feeds very enthusiastically — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const result = await readConnectionsFeed(user, {
    connectionId: url.searchParams.get('connection'),
    cursor: url.searchParams.get('cursor'),
    limit: Number(url.searchParams.get('limit')) || undefined,
    forceSync: url.searchParams.get('sync') === 'force',
    // stale-while-revalidate: serve the stored page with NO provider fan-out;
    // the client re-requests without defer to sync in the background
    deferSync: url.searchParams.get('sync') === 'defer',
    // "I scrolled through what's here" — raise the sync depth and pull older
    deepen
  });
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  const { matchesByPostId, filters } = await applyFeedFilters(user.id, result.posts);
  const posts = result.posts.map((post) => ({ ...post, feedFilterMatches: matchesByPostId.get(post.id) || [] }));
  return json({
    ok: true,
    posts,
    nextCursor: result.nextCursor,
    connections: result.connections,
    synced: result.synced,
    filters
  });
};
