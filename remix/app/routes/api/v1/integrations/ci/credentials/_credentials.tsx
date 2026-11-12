import { json } from '~/api/http';
import {
  claimLopuCredentialFetch,
  bootstrapLopuCredentialsIfEmpty,
  fetchLopuCredentialBundle,
  lopuCredentialVaultConfigured
} from '~/api/utils/ciControl/credentialVault';
import {
  LOPU_CREDENTIAL_FETCH_MAX_BYTES,
  normalizeBootstrapCredentials,
  normalizeCredentialPlatform,
  parseLopuCredentialFetchRequest
} from '~/api/utils/ciControl/credentialVaultCore';
import { verifyCiProviderRouteSignature } from '~/api/utils/ciControl/providerRouter';

const noStore = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' };

export const action = async ({ request }: { request: Request }) => {
  const secret = process.env.THINGTIME_CI_ROUTER_SECRET?.trim() ?? '';
  if (!secret || !lopuCredentialVaultConfigured()) {
    return json({ ok: false, error: 'Lopu credential delivery is not configured.' }, { status: 503, headers: noStore });
  }
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > LOPU_CREDENTIAL_FETCH_MAX_BYTES) {
    return json({ ok: false, error: 'Credential request is too large.' }, { status: 413, headers: noStore });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > LOPU_CREDENTIAL_FETCH_MAX_BYTES) {
    return json({ ok: false, error: 'Credential request is too large.' }, { status: 413, headers: noStore });
  }
  if (!verifyCiProviderRouteSignature(rawBody, request.headers.get('x-thingtime-ci-signature'), secret)) {
    return json({ ok: false, error: 'Invalid credential request signature.' }, { status: 403, headers: noStore });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: 'Invalid credential request.' }, { status: 400, headers: noStore });
  }
  const parsed = parseLopuCredentialFetchRequest(body, {
    repository: process.env.THINGTIME_GITHUB_REPOSITORY ?? 'lopugit/thingtime',
    allowedRefs: ['github-actions', 'develop', 'main']
  });
  if (!parsed) return json({ ok: false, error: 'Invalid or expired credential request.' }, { status: 400, headers: noStore });
  const platform = normalizeCredentialPlatform((body as Record<string, unknown>).platform ?? 'Anthropic');
  if (!platform) return json({ ok: false, error: 'Invalid credential platform.' }, { status: 400, headers: noStore });
  const bootstrapCredentials = normalizeBootstrapCredentials((body as Record<string, unknown>).bootstrapCredentials);
  if (!bootstrapCredentials) return json({ ok: false, error: 'Invalid bootstrap credentials.' }, { status: 400, headers: noStore });
  if (!(await claimLopuCredentialFetch(parsed))) {
    return json({ ok: false, error: 'Credential request was already used.' }, { status: 409, headers: noStore });
  }
  await bootstrapLopuCredentialsIfEmpty(bootstrapCredentials, 'github-actions[bot]');
  const credentials = await fetchLopuCredentialBundle(platform);
  return json({ ok: true, credentials }, { headers: noStore });
};
