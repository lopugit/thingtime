import { json } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { getPreviewRetention } from '~/api/utils/ciControl/previewRetention';
import { validPreviewRetentionRead } from '~/api/utils/ciControl/previewRetentionCore';
import { verifyCiProviderRouteSignature } from '~/api/utils/ciControl/providerRouter';

type Dependencies = { get: typeof getPreviewRetention; secret: () => string; repository: () => string };
export const createControllerPreviewRetentionHandler = (deps: Dependencies) => ({ request }: { request: Request }) => withAdminPrivateResponse(async () => {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
  const secret = deps.secret();
  if (!secret) return json({ ok: false, error: 'Controller authentication is unavailable.' }, { status: 503 });
  if (Number(request.headers.get('content-length')) > 4096) return json({ ok: false, error: 'Request too large' }, { status: 413 });
  // A missing or false Content-Length must not allow an unsigned caller to
  // buffer an unbounded stream before authentication.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  if (reader) for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > 4096) {
      await reader.cancel().catch(() => {});
      return json({ ok: false, error: 'Request too large' }, { status: 413 });
    }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks, received).toString('utf8');
  if (!verifyCiProviderRouteSignature(raw, request.headers.get('x-thingtime-ci-signature'), secret)) return json({ ok: false, error: 'Invalid controller signature.' }, { status: 403 });
  const repository = deps.repository();
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ ok: false, error: 'Invalid request' }, { status: 400 }); }
  if (!validPreviewRetentionRead(body, repository)) return json({ ok: false, error: 'Invalid repository, controller ref or request time.' }, { status: 400 });
  try { return json({ ok: true, repository, policy: (await deps.get()).policy }); }
  catch { return json({ ok: false, error: 'Policy unavailable. Preserve deployments.' }, { status: 503 }); }
});
export const action = createControllerPreviewRetentionHandler({ get: getPreviewRetention, secret: () => process.env.THINGTIME_CI_ROUTER_SECRET?.trim() ?? '', repository: () => process.env.THINGTIME_GITHUB_REPOSITORY?.trim() || 'lopugit/thingtime' });
