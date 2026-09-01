import { json } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import {
  addUserDeploymentLink,
  getUserDeploymentLinks,
  removeUserDeploymentLink,
  updateUserDeploymentLink,
  MAX_DEPLOYMENT_PATH_RULES
} from '~/api/utils/auth/users';
import type { DeploymentLinkPathRule, DeploymentSyncMode, SavedDeploymentLink } from '~/api/utils/auth/users';
import {
  normalizeDeploymentBaseUrl,
  remoteLogin,
  remoteLogout,
  remoteMe,
  remoteMintLinkToken
} from '~/api/utils/deployments/remote';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { isFail } from '~/api/utils/things/things';

const MAX_BODY_BYTES = 64 * 1024;
const SYNC_MODES: DeploymentSyncMode[] = ['push', 'pull', 'two-way', 'off'];
// data paths: 'profile', 'things', or 'things/<kind>' (kind ids are lowercase
// slugs — same alphabet the schema registry uses)
const PATH_RULE_PATTERN = /^(profile|things(\/[a-z0-9_-]{1,40})?)$/;

// What the client sees: everything about a link EXCEPT its remote token.
const toPublicLink = (link: SavedDeploymentLink) => ({
  id: link.id,
  name: link.name,
  baseUrl: link.baseUrl,
  remoteUserId: link.remoteUserId,
  remoteUsername: link.remoteUsername,
  syncMode: link.syncMode,
  pathRules: link.pathRules,
  createdAt: link.createdAt,
  tokenExpiresAt: link.tokenExpiresAt,
  lastSyncAt: link.lastSyncAt,
  lastSyncSummary: link.lastSyncSummary
});

export { toPublicLink };

// best-effort exp claim read (NOT verification — the remote verifies) so the
// UI can warn before a login-derived 30-day token lapses
const tokenExpiryIso = (token: string): string | null => {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8'));
    return typeof payload?.exp === 'number' ? new Date(payload.exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
};

const sanitizePathRules = (value: unknown): DeploymentLinkPathRule[] | { error: string } => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return { error: 'pathRules must be a list' };
  if (value.length > MAX_DEPLOYMENT_PATH_RULES) {
    return { error: `At most ${MAX_DEPLOYMENT_PATH_RULES} path rules per link` };
  }
  const rules: DeploymentLinkPathRule[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const path = typeof entry?.path === 'string' ? entry.path.trim() : '';
    const mode = entry?.mode;
    if (!PATH_RULE_PATTERN.test(path)) {
      return { error: `"${path || '(empty)'}" isn’t a valid data path — use profile, things, or things/<kind>` };
    }
    if (!SYNC_MODES.includes(mode)) return { error: `Path rule for "${path}" needs a mode (push/pull/two-way/off)` };
    if (seen.has(path)) continue;
    seen.add(path);
    rules.push({ path, mode });
  }
  return rules;
};

// GET /api/v1/deployment-links — the caller's linked deployments (sanitized).
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const links = await getUserDeploymentLinks(user.id);
  return json({ ok: true, links: links.map(toPublicLink) });
};

// POST   /api/v1/deployment-links — link an account on another deployment.
//   { baseUrl, name?, token }                     paste an existing token
//   { baseUrl, name?, username, password }        log in over there (may answer
//                                                 { requiresOtp, challenge })
//   { baseUrl, name?, challenge, code }           complete the 2FA step
// PATCH  /api/v1/deployment-links — { id, name?, syncMode?, pathRules? }
// DELETE /api/v1/deployment-links — { id } (best-effort remote sign-out)
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) return json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'Payload too large' }, { status: 413 });
  }

  const method = request.method.toUpperCase();

  // fail-closed: POST/DELETE dial a caller-supplied host (see the
  // mongodb.endpoint precedent) — nothing there may run unthrottled.
  //
  // PATCH is charged separately because it dials nothing: it edits a link the
  // caller already holds, entirely inside their own secure blob. The settings
  // pane sends one PATCH per sync-mode tap (optimistic, see
  // useLinkedDeployments) and one per path-rule save, so on the 10-per-5-minute
  // dial budget an ordinary configuring session runs out — and because the
  // budget is shared, the 429 lands on linking and unlinking too.
  const limitKey = method === 'PATCH' ? 'deployments.update' : 'deployments.link';
  const limit = await enforceRateLimit(request, limitKey, `user:${user.id}`, { failClosed: true });
  if (!limit.allowed) {
    return json({ ok: false, error: 'You’re doing that too fast — take a breather 🌸' }, rateLimitedResponseInit(limit));
  }

  const body = await request.json().catch(() => ({}));

  if (method === 'POST') {
    const baseUrl = normalizeDeploymentBaseUrl(body?.baseUrl);
    if (isFail(baseUrl)) return json({ ok: false, error: baseUrl.error }, { status: baseUrl.status });

    let token: string | null = null;
    let obtainedViaLogin = false;
    if (typeof body?.token === 'string' && body.token.trim()) {
      token = body.token.trim();
    } else if (
      (typeof body?.username === 'string' && typeof body?.password === 'string') ||
      (typeof body?.challenge === 'string' && typeof body?.code === 'string')
    ) {
      const login = await remoteLogin(baseUrl, {
        username: body.username,
        password: body.password,
        challenge: body.challenge,
        code: body.code
      });
      if (isFail(login)) return json({ ok: false, error: login.error }, { status: login.status });
      if ('requiresOtp' in login) {
        return json({ ok: true, requiresOtp: true, challenge: login.challenge, expiresAt: login.expiresAt });
      }
      token = login.token;
      obtainedViaLogin = true;
    } else {
      return json(
        { ok: false, error: 'Provide a token, or a username + password for that deployment' },
        { status: 400 }
      );
    }

    const remoteUser = await remoteMe(baseUrl, token);
    if (isFail(remoteUser)) return json({ ok: false, error: remoteUser.error }, { status: remoteUser.status });

    // upgrade to a non-expiring deployment-link token when the remote supports
    // it; a login-derived session is revoked after a successful swap (a pasted
    // token might be in use elsewhere, so it is left alone)
    let tokenExpiresAt = tokenExpiryIso(token);
    const minted = await remoteMintLinkToken(baseUrl, token);
    if (minted) {
      if (obtainedViaLogin) void remoteLogout(baseUrl, token).catch(() => {});
      token = minted.token;
      tokenExpiresAt = null;
    }

    const name =
      typeof body?.name === 'string' && body.name.trim()
        ? body.name.trim().slice(0, 60)
        : new URL(baseUrl).host;

    const rules = sanitizePathRules(body?.pathRules);
    if ('error' in rules) return json({ ok: false, error: rules.error }, { status: 400 });

    const syncMode: DeploymentSyncMode = SYNC_MODES.includes(body?.syncMode) ? body.syncMode : 'two-way';

    const added = await addUserDeploymentLink(user.id, {
      name,
      baseUrl,
      token,
      tokenExpiresAt,
      remoteUserId: remoteUser.id,
      remoteUsername: remoteUser.username,
      syncMode,
      pathRules: rules
    });
    if (added.ok === false) return json({ ok: false, error: added.error }, { status: 400 });
    const links = await getUserDeploymentLinks(user.id);
    return json({ ok: true, link: toPublicLink(added.link), links: links.map(toPublicLink) }, { status: 201 });
  }

  if (method === 'PATCH') {
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!id) return json({ ok: false, error: 'Link id is required' }, { status: 400 });

    const patch: Record<string, any> = {};
    if (body?.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) {
        return json({ ok: false, error: 'Name can’t be empty' }, { status: 400 });
      }
      patch.name = body.name.trim().slice(0, 60);
    }
    if (body?.syncMode !== undefined) {
      if (!SYNC_MODES.includes(body.syncMode)) {
        return json({ ok: false, error: 'syncMode must be push, pull, two-way or off' }, { status: 400 });
      }
      patch.syncMode = body.syncMode;
    }
    if (body?.pathRules !== undefined) {
      const rules = sanitizePathRules(body.pathRules);
      if ('error' in rules) return json({ ok: false, error: rules.error }, { status: 400 });
      patch.pathRules = rules;
    }

    const updated = await updateUserDeploymentLink(user.id, id, patch);
    if (!updated) return json({ ok: false, error: 'Link not found' }, { status: 404 });
    return json({ ok: true, link: toPublicLink(updated) });
  }

  if (method === 'DELETE') {
    const id = typeof body?.id === 'string' ? body.id : new URL(request.url).searchParams.get('id') || '';
    if (!id) return json({ ok: false, error: 'Link id is required' }, { status: 400 });
    const removed = await removeUserDeploymentLink(user.id, id);
    if (!removed) return json({ ok: false, error: 'Link not found' }, { status: 404 });
    // best-effort: revoke the remote session so the stored token dies with the
    // link (an unreachable remote just lets it age out on its own expiry)
    await remoteLogout(removed.baseUrl, removed.token).catch(() => {});
    const links = await getUserDeploymentLinks(user.id);
    return json({ ok: true, links: links.map(toPublicLink) });
  }

  return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, POST, PATCH, DELETE' } });
};
