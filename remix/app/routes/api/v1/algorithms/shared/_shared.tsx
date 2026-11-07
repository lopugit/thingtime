import { json } from '~/api/http';

import { getSharedAlgorithmPreview } from '~/api/utils/algorithms/algorithms';

// GET /api/v1/algorithms/shared?id=<shareId> — the "try my feed brain 🧠"
// share-link preview (claude-todo/10). Public and anonymous, but it only
// resolves algorithms whose owner explicitly flipped shared:true, and it never
// returns weights or interests — just identity + training size, enough for
// the branch prompt. Unknown, unshared, and private ids all 404 identically.
export const loader = async ({ request }: { request: Request }) => {
  const id = new URL(request.url).searchParams.get('id') || '';
  const preview = await getSharedAlgorithmPreview(id);
  if (!preview) {
    return json({ ok: false, error: 'Algorithm not found' }, { status: 404 });
  }
  return json({ ok: true, algorithm: preview });
};
