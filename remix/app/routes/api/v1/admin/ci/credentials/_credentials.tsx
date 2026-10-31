import { resetAiProviderProbeCache } from '~/api/utils/ai/providerProbe';
import { json, readJsonBody } from '~/api/http';
import { withAdminPrivateResponse } from '~/api/utils/admin/adminResponse';
import { deriveWebAuthnParams } from '~/api/utils/auth/passkeys';
import { requireAdmin } from '~/api/utils/auth/requireAdmin';
import {
  createLopuCredential,
  importConfiguredOpenAiCredential,
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

export const createCredentialAction =
  (deps = { requireAdmin, importConfiguredOpenAiCredential, listLopuCredentials, resetAiProviderProbeCache }) =>
  ({ request }: { request: Request }) =>
    withAdminPrivateResponse(async () => {
      const gate = await deps.requireAdmin(request);
      if ('error' in gate) return json({ ok: false, error: gate.error.message }, { status: gate.error.status, headers: privateHeaders });
      const body = await readJsonBody(request, 40 * 1024);
      try {
        switch (body?.action) {
          case 'import-configured-openai':
            if (
              request.method !== 'POST' ||
              request.headers.get('Origin') !== deriveWebAuthnParams(request).origin ||
              request.headers.get('Sec-Fetch-Site') === 'cross-site'
            )
              return json({ ok: false, error: 'Same-origin POST required.' }, { status: 403, headers: privateHeaders });
            await deps.importConfiguredOpenAiCredential(gate.user.id);
            break;
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
        deps.resetAiProviderProbeCache();
        return json({ ok: true, ...(await deps.listLopuCredentials()) }, { headers: privateHeaders });
      } catch (error) {
        return json(
          {
            ok: false,
            error:
              body?.action === 'import-configured-openai'
                ? 'OpenAI import failed. Check the server key and vault configuration; existing credentials were preserved.'
                : error instanceof Error
                ? error.message
                : 'Credential change failed.'
          },
          { status: 409, headers: privateHeaders }
        );
      }
    });

export const action = createCredentialAction();
