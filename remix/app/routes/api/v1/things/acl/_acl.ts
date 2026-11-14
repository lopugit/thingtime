import { JSON_BODY_WITHOUT_APPLICATION_LIMIT, json, readJsonBody, requireJsonContentType } from '~/api/http';
import { isSameOriginAttachmentRequest, withAttachmentPrivateResponse } from '~/api/utils/attachments/attachmentResponses';
import { actorPat, actorUser, resolveActor } from '~/api/utils/auth/resolveActor';
import { enforceRateLimit, rateLimitedResponseInit } from '~/api/utils/rateLimit/enforce';
import { grantThingAclEntries, removeThingAclEntries, listThingAclEntries, viewerOf } from '~/api/utils/things/things';

const ref = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
export const createThingAclHandler = (dependencies = {
  resolveActor, enforceRateLimit, grantThingAclEntries, removeThingAclEntries, listThingAclEntries
}) => async ({ request }: { request: Request }) => withAttachmentPrivateResponse(async () => {
  const mutation = request.method === 'POST';
  if (!mutation && request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, POST' } });
  const site = request.headers.get('Sec-Fetch-Site')?.toLowerCase();
  if (!isSameOriginAttachmentRequest(request) || (site && site !== 'same-origin' && site !== 'none'))
    return json({ ok: false, error: 'Use the same Thingtime origin' }, { status: 403 });
  if (mutation) {
    const invalid = requireJsonContentType(request);
    if (invalid) return invalid;
  }
  const actor = await dependencies.resolveActor(request, { thingsScope: mutation ? 'things.update' : 'things.read' });
  if (actor instanceof Response) return actor;
  if (actor.kind === 'app' || (actor.kind === 'pat' && actor.cors))
    return json({ ok: false, error: 'Thing ACL management is unavailable to apps' }, { status: 403 });
  const user = actorUser(actor);
  if (!user) return json({ ok: false, error: 'Sign in to manage your Thing access' }, { status: 401 });
  const viewer = viewerOf(user, actorPat(actor));
  const rate = await dependencies.enforceRateLimit(request, mutation ? 'things.write' : 'things.read', `user:${user.id}`, { failClosed: true });
  if (!rate.allowed) return json({ ok: false, error: 'Thing access management is unavailable or rate limited' }, rateLimitedResponseInit(rate));
  const params = new URL(request.url).searchParams;
  let result;
  if (mutation) {
    if (params.size) return json({ ok: false, error: 'Use a JSON ACL mutation without query parameters' }, { status: 400 });
    const body = await readJsonBody(request, JSON_BODY_WITHOUT_APPLICATION_LIMIT);
    if (!body || !ref(body.id) || !['add', 'remove'].includes(body.operation) || !Array.isArray(body.entries) || !body.entries.every(ref) ||
      (body.family !== undefined && !['audience', 'token'].includes(body.family)) ||
      (body.expectedAclRevision !== undefined && body.expectedAclRevision !== null && !ref(body.expectedAclRevision)) ||
      Object.keys(body).some(key => !['id', 'operation', 'entries', 'expectedAclRevision', 'family'].includes(key)))
      return json({ ok: false, error: 'Supply an exact Thing ID, add/remove operation and ACL entries' }, { status: 400 });
    result = await (body.operation === 'add' ? dependencies.grantThingAclEntries : dependencies.removeThingAclEntries)(viewer, body.id, body.entries,
      { ...(body.expectedAclRevision === undefined ? {} : { expectedAclRevision: body.expectedAclRevision }), ...(body.family ? { family: body.family } : {}) });
    if (result.ok) return json(body.family === 'token'
      ? { ok: true, id: body.id, family: 'token', acl: result.doc.tokenAcl || [], aclRevision: result.doc.tokenAclRevision ?? null, aclEntryCount: result.doc.tokenAclEntryCount ?? 0 }
      : { ok: true, id: body.id, acl: result.doc.acl, aclRevision: result.doc.aclRevision ?? null, aclEntryCount: result.doc.aclEntryCount ?? result.doc.acl.length });
  } else {
    if ([...params.keys()].some(key => !['id', 'cursor', 'limit', 'family'].includes(key) || params.getAll(key).length !== 1) || !ref(params.get('id')) ||
      (params.has('family') && !['audience', 'token'].includes(params.get('family')!)) ||
      (params.has('limit') && (!/^[1-9]\d*$/.test(params.get('limit')!) || !Number.isSafeInteger(Number(params.get('limit'))))))
      return json({ ok: false, error: 'Invalid exact Thing ACL page request' }, { status: 400 });
    result = await dependencies.listThingAclEntries(viewer, params.get('id')!, {
      ...(params.has('family') ? { family: params.get('family') as 'audience' | 'token' } : {}),
      cursor: params.get('cursor') ?? undefined, limit: params.has('limit') ? Number(params.get('limit')) : undefined
    });
    if (result.ok) return json(result);
  }
  return json({ ok: false, error: result.error }, { status: result.status });
});

export const loader = createThingAclHandler();
export const action = loader;
