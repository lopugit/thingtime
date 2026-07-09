import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { deleteRecord } from '~/api/utils/crud/records';

const MAX_BODY_BYTES = 16 * 1024;

// POST /api/v1/crud/records/delete — { id } — soft-delete a record (admin or
// owner only). Deleted records disappear from read/list/search immediately.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const result = await deleteRecord(user, body);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true });
};
