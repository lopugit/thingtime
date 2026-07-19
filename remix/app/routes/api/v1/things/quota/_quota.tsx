import { json, readJsonBody } from '~/api/http';

import { getCurrentServiceAccount } from '~/api/utils/auth/getCurrentServiceAccount';
import { getServiceQuotaStatus, mutateServiceQuota } from '~/api/utils/things/quota';
import { ServiceQuotaError } from '~/api/utils/things/quotaCore';

const MAX_BODY_BYTES = 16 * 1024;

const withQuotaErrors = async (operation: () => Promise<Response>): Promise<Response> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof ServiceQuotaError) {
      return json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    return json(
      { ok: false, error: 'Quota store is unavailable', code: 'QUOTA_UNAVAILABLE' },
      { status: 503 }
    );
  }
};

const authenticate = async (request: Request) => {
  const auth = await getCurrentServiceAccount(request);
  if (auth.ok === false) {
    return json({ ok: false, error: auth.error, code: auth.code }, { status: auth.status });
  }
  return auth.user;
};

// GET /api/v1/things/quota?key=... — current owner-scoped quota status.
export const loader = async ({ request }: { request: Request }) =>
  withQuotaErrors(async () => {
    const auth = await authenticate(request);
    if (auth instanceof Response) return auth;

    const key = new URL(request.url).searchParams.get('key');
    const status = await getServiceQuotaStatus(auth.id, key);
    return json({ ok: true, status });
  });

// POST /api/v1/things/quota — atomic reserve, permit, release, or reset.
export const action = async ({ request }: { request: Request }) =>
  withQuotaErrors(async () => {
    if (request.method.toUpperCase() !== 'POST') {
      return json(
        { ok: false, error: 'Method not allowed', code: 'INVALID_REQUEST' },
        { status: 405, headers: { Allow: 'GET, POST' } }
      );
    }

    const auth = await authenticate(request);
    if (auth instanceof Response) return auth;

    const body = await readJsonBody(request, MAX_BODY_BYTES);
    const result = await mutateServiceQuota(auth.id, body);
    if (result.operation === 'reserve') {
      return json({ ok: true, status: result.status, reservation: result.reservation });
    }
    if (result.operation === 'permit') {
      return json({ ok: true, status: result.status, permit: result.permit });
    }
    if (result.operation === 'release') {
      return json({ ok: true, status: result.status, release: result.release });
    }
    return json({ ok: true, status: result.status });
  });
