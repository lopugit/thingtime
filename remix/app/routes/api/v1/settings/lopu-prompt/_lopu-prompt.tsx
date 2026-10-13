import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { getUserLopuInstructions, setUserLopuInstructions } from '~/api/utils/auth/users';
import { getLopuBasePrompt, setLopuBasePrompt } from '~/api/utils/settings/lopuPromptSettings';
import { LopuPromptConflictError, validateLopuBasePrompt, validateLopuInstructions, validatePromptRevision } from '~/api/utils/lopu/promptSettingsCore';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';

const headers = { 'Cache-Control': 'no-store' };
const defaults = { getCurrentUser, getUserLopuInstructions, setUserLopuInstructions, getLopuBasePrompt, setLopuBasePrompt, enforceRateLimit };
export const createLopuPromptHandlers = (deps: typeof defaults) => {
  const respond = (body: unknown, status = 200) => json(body, { status, headers });
  const handler = async ({ request }: { request: Request }) => {
    if (!['GET', 'HEAD', 'POST'].includes(request.method)) return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { ...headers, Allow: 'GET, POST' } });
    const user = await deps.getCurrentUser(request);
    const viewer = user?.accountKind !== 'service' ? user : null;
    const writing = request.method === 'POST';
    if (writing && !viewer) return respond({ ok: false, error: 'Sign in to change Lopu instructions.' }, 401);
    const limit = await deps.enforceRateLimit(request, 'settings.lopu-prompt', viewer ? `user:${viewer.id}` : null, { failClosed: writing });
    if (!limit.allowed) return json({ ok: false, error: 'Too many requests. Try again shortly.' }, { ...rateLimitedResponseInit(limit), headers: { ...rateLimitedResponseInit(limit).headers, ...headers } });
    if (!writing) {
      const [base, personal] = await Promise.all([deps.getLopuBasePrompt(), viewer ? deps.getUserLopuInstructions(viewer.id) : { revision: null, instructions: [] }]);
      return respond({ ok: true, base, personal });
    }
    const unsupported = requireJsonContentType(request);
    if (unsupported) return unsupported;
    try {
      const body: any = await readJsonBody(request, 96 * 1024);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return respond({ ok: false, error: 'Expected a settings object.' }, 400);
      // No caller-supplied account id: personal settings always belong to the session.
      if ('userId' in body || 'ownerId' in body) return respond({ ok: false, error: 'Personal instructions belong to the signed-in account.' }, 400);
      if (body.scope === 'base') {
        if (!viewer!.isAdmin) return respond({ ok: false, error: 'Admins only' }, 403);
        const base = await deps.setLopuBasePrompt(validateLopuBasePrompt(body.basePrompt), validatePromptRevision(body.revision), viewer!.id);
        return respond({ ok: true, base });
      }
      if (body.scope !== 'personal') return respond({ ok: false, error: 'Choose personal or base settings.' }, 400);
      const personal = await deps.setUserLopuInstructions(viewer!.id, validateLopuInstructions(body.instructions), validatePromptRevision(body.revision));
      return respond({ ok: true, personal });
    } catch (error) {
      if (error instanceof LopuPromptConflictError) return respond({ ok: false, error: error.message }, 409);
      if (error instanceof TypeError) return respond({ ok: false, error: error.message }, 400);
      throw error;
    }
  };
  return { loader: handler, action: handler };
};
const handlers = createLopuPromptHandlers(defaults);
export const loader = handlers.loader;
export const action = handlers.action;
