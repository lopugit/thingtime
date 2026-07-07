import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { updateAlgorithm } from '~/api/utils/algorithms/algorithms';

// POST /api/v1/algorithms/update — { id, name?, emoji? } — rename/restyle an algorithm.
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await readJsonBody(request, 64 * 1024);
  const result = await updateAlgorithm(user.id, body);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, algorithm: result.algorithm });
};
