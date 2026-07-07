import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { getOwnedAlgorithmWeights } from '~/api/utils/algorithms/algorithms';
import { getFeed, type PostType, type PostVisibility } from '~/api/utils/things/things';

const csv = (value: string | null): string[] =>
  (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const isoDate = (value: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

// GET /api/v1/things/feed?types=&circles=&from=&to=&algorithm=<id|latest>&cursor=&limit=
// The public feed. Works logged out (public posts only). With `algorithm`
// omitted the viewer's active algorithm applies; 'latest' forces chronological.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  const url = new URL(request.url);
  const params = url.searchParams;

  const algorithmParam = (params.get('algorithm') || '').trim();
  let weights = null;
  if (user && algorithmParam !== 'latest') {
    const algorithmId = algorithmParam || user.activeFeedAlgorithmId;
    if (algorithmId) {
      weights = await getOwnedAlgorithmWeights(user.id, algorithmId);
      if (!weights && algorithmParam) {
        return json({ ok: false, error: 'Algorithm not found' }, { status: 404 });
      }
    }
  }

  const result = await getFeed(user ? user.id : null, {
    types: csv(params.get('types')) as PostType[],
    circles: csv(params.get('circles')) as PostVisibility[],
    from: isoDate(params.get('from')),
    to: isoDate(params.get('to')),
    cursor: params.get('cursor'),
    limit: Number(params.get('limit')) || undefined,
    weights
  });

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, posts: result.posts, nextCursor: result.nextCursor, ranked: result.ranked });
};
