import { json, readJsonBody, requireJsonContentType } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import { getPreviewRetention, setPreviewRetention } from '~/api/utils/ciControl/previewRetention';
import { PreviewRetentionConflict } from '~/api/utils/ciControl/previewRetentionCore';

type Dependencies = { requireAdmin: typeof requireAdmin; get: typeof getPreviewRetention; set: typeof setPreviewRetention };
export const createPreviewRetentionHandlers = (deps: Dependencies) => {
  const handle = (write: boolean) => ({ request }: { request: Request }) => withAdminPrivateResponse(async () => {
    if (request.method !== (write ? 'POST' : 'GET')) return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
    const gate = await deps.requireAdmin(request);
    if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status });
    try {
      if (!write) return json({ ok: true, ...await deps.get() });
      const contentTypeError = requireJsonContentType(request);
      if (contentTypeError) return contentTypeError;
      const body = await readJsonBody(request, 16 * 1024);
      if (!(body?.expectedRevision === null || typeof body?.expectedRevision === 'string')) return json({ ok: false, error: 'Include the saved revision.' }, { status: 400 });
      return json({ ok: true, ...await deps.set(body.policy, body.expectedRevision, gate.user.id) });
    } catch (error) {
      if (error instanceof Response) throw error;
      // Only a submitted policy is the caller's fault. A stored policy this
      // deployment cannot validate (corruption, or a newer saved version) is
      // unavailable, not a 400: cleanup must preserve deployments.
      const status = error instanceof PreviewRetentionConflict ? 409 : write && error instanceof TypeError ? 400 : 503;
      return json({ ok: false, error: status === 503 ? 'Preview retention settings are unavailable. Cleanup must preserve deployments.' : (error as Error).message }, { status });
    }
  });
  return { loader: handle(false), action: handle(true) };
};
export const { loader, action } = createPreviewRetentionHandlers({ requireAdmin, get: getPreviewRetention, set: setPreviewRetention });
