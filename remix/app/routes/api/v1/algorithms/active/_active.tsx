import { json, readJsonBody } from '~/api/http';

import { getCurrentUser } from '~/api/utils/auth/getCurrentUser';
import { setActiveAlgorithm } from '~/api/utils/algorithms/algorithms';

// POST /api/v1/algorithms/active — { algorithmId: string | null } — switch the
// caller's active feed algorithm (null = Latest / chronological).
export const action = async ({ request }: { request: Request }) => {
  const user = await getCurrentUser(request);
  if (!user) {
    return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await readJsonBody(request, 64 * 1024);
  const result = await setActiveAlgorithm(user.id, body.algorithmId ?? null);

  if (result.ok === false) {
    return json({ ok: false, error: result.error }, { status: result.status });
  }
  return json({ ok: true, activeAlgorithmId: result.activeAlgorithmId });
};
