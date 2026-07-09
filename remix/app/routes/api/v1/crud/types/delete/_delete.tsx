import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { deleteType } from '~/api/utils/crud/types';

const MAX_BODY_BYTES = 16 * 1024;

// POST /api/v1/crud/types/delete — { id, archive? } — delete a caller-owned
// type, or archive it when records still exist.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const result = await deleteType(user, body);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, archived: result.archived });
};
