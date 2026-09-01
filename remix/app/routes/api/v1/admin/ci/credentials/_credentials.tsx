import { json, readJsonBody } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import {
  createLopuCredential,
  deleteLopuCredential,
  listLopuCredentials,
  reorderLopuCredentials,
  rotateLopuCredential,
  setLopuCredentialEnabled
} from '~/api/utils/ciControl/credentialVault';

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' };

export const loader = ({ request }: { request: Request }) =>
  withAdminPrivateResponse(async () => {
    const gate = await requireAdmin(request);
    if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status, headers: privateHeaders });
    return json({ ok: true, ...(await listLopuCredentials()) }, { headers: privateHeaders });
  });

export const action = ({ request }: { request: Request }) =>
  withAdminPrivateResponse(async () => {
    const gate = await requireAdmin(request);
    if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status, headers: privateHeaders });
    const body = await readJsonBody(request, 40 * 1024);
    try {
      switch (body?.action) {
        case 'create':
          await createLopuCredential(body, gate.user.id);
          break;
        case 'rotate':
          await rotateLopuCredential(body.id, body.value);
          break;
        case 'set-enabled':
          await setLopuCredentialEnabled(body.id, body.enabled);
          break;
        case 'reorder':
          await reorderLopuCredentials(body.order);
          break;
        case 'delete':
          await deleteLopuCredential(body.id);
          break;
        default:
          return json({ ok: false, error: 'Choose a supported credential action.' }, { status: 400, headers: privateHeaders });
      }
      return json({ ok: true, ...(await listLopuCredentials()) }, { headers: privateHeaders });
    } catch (error) {
      return json(
        { ok: false, error: error instanceof Error ? error.message : 'Credential change failed.' },
        { status: 409, headers: privateHeaders }
      );
    }
  });
