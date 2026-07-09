import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { updateRecord } from '~/api/utils/crud/records';

const MAX_BODY_BYTES = 256 * 1024;

// POST /api/v1/crud/records/update — { id, values, expectedVersion? } —
// update values on a writable record (optimistic concurrency when
// expectedVersion is passed).
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const result = await updateRecord(user, body);
  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, record: result.record });
};
