import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { deleteAlgorithm } from '~/api/utils/algorithms/algorithms';

// POST /api/v1/algorithms/delete — { id } — delete one of the caller's
// algorithms (clears the active pointer if it pointed at it).
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await readJsonBody(request, 64 * 1024);
  const result = await deleteAlgorithm(user.id, body.id);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true });
};
