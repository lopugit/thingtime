import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { listTypes, saveType } from '~/api/utils/crud/types';

// GET /api/v1/crud/types — list caller-visible type definitions (own types +
// public ones; anonymous callers see public types only).
export const loader = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  const types = await listTypes(user);
  return json({ ok: true, types });
};

// Type definitions are schema documents — small by design.
const MAX_BODY_BYTES = 64 * 1024;

// POST /api/v1/crud/types — { id?, key, name, description?, visibility?,
// fields, defaultAcl? } — create a type, or update a caller-owned one by id.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const result = await saveType(user, body);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, type: result.type });
};
