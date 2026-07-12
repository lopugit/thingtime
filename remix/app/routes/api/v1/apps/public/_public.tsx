import { json } from '~/api/http';

import { appAllowsOrigin, findAppByClientId, normalizeAppOrigin, toEmbedApp } from '~/api/utils/apps/apps';
import { describeScopes, parseScopeParam } from '~/api/utils/apps/scopes';

// GET /api/v1/apps/public?clientId=…&origin=…&scope=… — anonymous lookup used
// by the authorize popup to render its consent screen. Returns the app's
// public face (clientId + name) plus the requested scopes as descriptor
// entries ({ id, title, description, required }) that the permissions
// selector renders — ONLY when the app exists and the origin is on its
// allowlist, so the popup can refuse to run for unregistered embedders before
// any login UI shows.
export const loader = async ({ request }: { request: Request }) => {
  const url = new URL(request.url);
  const clientId = (url.searchParams.get('clientId') || url.searchParams.get('client_id') || '').trim();
  const origin = normalizeAppOrigin(url.searchParams.get('origin'));

  if (!clientId) return json({ ok: false, error: 'clientId is required' }, { status: 400 });
  if (!origin) return json({ ok: false, error: 'origin must be a valid web origin' }, { status: 400 });

  const requested = parseScopeParam(url.searchParams.get('scope'));
  if (requested.ok === false) {
    return json({ ok: false, error: requested.error }, { status: 400 });
  }

  const app = await findAppByClientId(clientId);
  if (!app) return json({ ok: false, error: 'App not found' }, { status: 404 });

  if (!appAllowsOrigin(app, origin)) {
    return json({ ok: false, error: 'This origin is not on the app’s allowlist' }, { status: 403 });
  }

  return json({ ok: true, app: toEmbedApp(app), origin, scopes: describeScopes(requested.scopes) });
};
