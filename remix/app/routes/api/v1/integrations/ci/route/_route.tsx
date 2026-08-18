import { json } from '~/api/http';
import {
  parseCiProviderRouteRequest,
  routeCiProviderRequest,
  verifyCiProviderRouteSignature
} from '~/api/utils/ciControl/providerRouter';

const MAX_ROUTE_BYTES = 64 * 1024;

export const action = async ({ request }: { request: Request }) => {
  const secret = process.env.THINGTIME_CI_ROUTER_SECRET ?? '';
  if (!secret) return json({ ok: false, error: 'CI provider routing is not configured' }, { status: 503 });
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_ROUTE_BYTES) return json({ ok: false, error: 'Route payload is too large' }, { status: 413 });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_ROUTE_BYTES) {
    return json({ ok: false, error: 'Route payload is too large' }, { status: 413 });
  }
  if (!verifyCiProviderRouteSignature(rawBody, request.headers.get('x-thingtime-ci-signature'), secret)) {
    return json({ ok: false, error: 'Invalid route signature' }, { status: 403 });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: 'Invalid route payload' }, { status: 400 });
  }
  const routeRequest = parseCiProviderRouteRequest(body);
  if (!routeRequest) return json({ ok: false, error: 'Invalid or expired route request' }, { status: 400 });
  const result = await routeCiProviderRequest(routeRequest);
  return json({ ok: true, ...result }, { status: 202 });
};
