import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { searchRecords } from '~/api/utils/crud/search';

const respond = async (user: Awaited<ReturnType<typeof getCurrentUser>>, input: any) => {
  const result = await searchRecords(user, input);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, records: result.records, nextCursor: result.nextCursor });
};

// GET /api/v1/crud/search?q=&typeId=&fields=&cursor=&limit= — search permitted
// records. Auth optional; results always filter by acl.searchKeys.
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  const params = new URL(request.url).searchParams;
  return respond(user, {
    q: params.get('q') ?? undefined,
    typeId: params.get('typeId') ?? undefined,
    fields: params.get('fields') ?? undefined,
    cursor: params.get('cursor'),
    limit: params.get('limit')
  });
};

const MAX_BODY_BYTES = 64 * 1024;

// POST /api/v1/crud/search — same operation with a JSON body for complex
// filters: { q, typeId, fields?, cursor?, limit? }.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  return respond(user, body || {});
};
