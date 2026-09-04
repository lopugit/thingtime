import { json } from '~/api/http';
import { safeErrorText } from '~/api/utils/errors/safeError';
import {
  type BasicServiceHealthStatus,
  fetchRemoteJson,
  resolveStatusTarget,
  unavailableServiceStatus
} from '~/api/utils/health/statusTarget';
import { USER_STORAGE_ACCOUNTING_VERSION } from '~/api/utils/storage/storageCore';
import {
  getUserStorageAccountingReadiness,
  USER_STORAGE_ACCOUNTING_MIGRATION_ID
} from '~/api/utils/storage/userStorageReadiness';

const getLocalNitroStatus = async (origin: string): Promise<BasicServiceHealthStatus> => {
  try {
    const storageAccounting = await getUserStorageAccountingReadiness();
    const ready = storageAccounting.state === 'ready';
    return {
      ok: ready,
      service: 'nitro',
      state: ready ? 'ready' : 'degraded',
      label: ready ? 'Nitro API: ready' : 'Nitro API: storage migration required',
      checkedAt: new Date().toISOString(),
      origin,
      targetOrigin: origin,
      runtime: 'nitro',
      nodeEnv: process.env.NODE_ENV,
      storageAccounting
    };
  } catch (error) {
    return {
      ok: false,
      service: 'nitro',
      state: 'unavailable',
      label: 'Nitro API: storage readiness unavailable',
      checkedAt: new Date().toISOString(),
      origin,
      targetOrigin: origin,
      runtime: 'nitro',
      nodeEnv: process.env.NODE_ENV,
      error: safeErrorText(error, 'health: storage accounting readiness', 'Storage accounting readiness is unavailable'),
      storageAccounting: {
        state: 'unavailable',
        expectedVersion: USER_STORAGE_ACCOUNTING_VERSION,
        migrationId: USER_STORAGE_ACCOUNTING_MIGRATION_ID
      }
    };
  }
};

export const loader = async ({ request }: { request: Request }) => {
  const target = resolveStatusTarget(request);

  if (!target.isRemote) {
    return json(await getLocalNitroStatus(target.requestOrigin));
  }

  try {
    const { data, responseMs } = await fetchRemoteJson<BasicServiceHealthStatus>(
      target.targetOrigin,
      '/api/v1/health/nitro'
    );

    return json({
      ...data,
      responseMs: data.responseMs ?? responseMs,
      targetOrigin: target.targetOrigin
    });
  } catch (err) {
    return json(unavailableServiceStatus('nitro', target.targetOrigin, err));
  }
};

export const action = loader;
