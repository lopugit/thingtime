import { json, readJsonBody } from '~/api/http';
import { agentReporting } from '~/api/utils/agents/reporting';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

export async function action({ request }: { request: Request }) {
  const limit = await enforceRateLimit(request, 'actions.run', null, { failClosed: true });
  if (!limit.allowed) return json({ ok: false, error: 'Too many reporting requests' }, rateLimitedResponseInit(limit));
  const result = await agentReporting(request, await readJsonBody(request, 96 * 1024));
  return json(result, { status: result.ok === false ? result.status : 200,
    headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' } });
}
