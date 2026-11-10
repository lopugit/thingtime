import { json, readJsonBody } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { viewerOf } from '~/api/utils/things/things';
import { listSubspaceEmbeds, mutateSubspaceEmbed } from '~/api/utils/subspaces/embeds';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  const params = new URL(request.url).searchParams;
  const result = await listSubspaceEmbeds(viewerOf(user), { id: params.get('id'), region: params.get('region'), cursor: params.get('cursor') });
  return json(result, { status: result.ok === false ? result.status : 200, headers: { 'Cache-Control': 'private, no-store' } });
};
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const limit = await enforceRateLimit(request, 'subspaces.write', `user:${user.id}`);
  if (!limit.allowed) return json({ ok: false, error: 'Slow down a little 🌸' }, rateLimitedResponseInit(limit));
  const body = await readJsonBody(request, 64 * 1024);
  const result = await mutateSubspaceEmbed(viewerOf(user), body || {});
  return json(result, { status: result.ok === false ? result.status : 200 });
};
