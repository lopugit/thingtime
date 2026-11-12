import { json } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { reconcileGitHubRepository } from '~/api/utils/ciControl/githubClient';

export const action = ({ request }: { request: Request }) =>
  withAdminPrivateResponse(async () => {
    const gate = await requireAdmin(request);
    if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
    try {
      return json(await reconcileGitHubRepository(gate.user.id));
    } catch {
      return json(
        { ok: false, error: 'GitHub reconciliation failed. Existing dashboard history was preserved.' },
        { status: 502 }
      );
    }
  });
