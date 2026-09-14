import { json } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { listErrorLogs } from '~/api/utils/errors/errorLogs';

export const loader = async ({ request }: { request: Request }) => withAdminPrivateResponse(async () => {
  const gate = await requireAdmin(request);
  if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
  const params = new URL(request.url).searchParams;
  try { return json({ ok: true, ...await listErrorLogs({ q: params.get('q') || '', before: params.get('before') || '' }) }); }
  catch (error) {
    if (error instanceof TypeError && error.message === 'Invalid error log cursor') return json({ ok: false, error: 'Invalid error log cursor' }, { status: 400 });
    return json({ ok: false, error: 'Error logs are temporarily unavailable' }, { status: 503 });
  }
});
