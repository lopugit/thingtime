import { json } from '~/api/http';
import {
  type BasicServiceHealthStatus,
  fetchRemoteJson,
  resolveStatusTarget,
  unavailableServiceStatus
} from '~/api/utils/health/statusTarget';

const getLocalNitroStatus = (origin: string): BasicServiceHealthStatus => {
  return {
    ok: true,
    service: 'nitro',
    state: 'ready',
    label: 'Nitro API: ready',
    checkedAt: new Date().toISOString(),
    origin,
    targetOrigin: origin,
    runtime: 'nitro',
    nodeEnv: process.env.NODE_ENV
  };
};

export const loader = async ({ request }: { request: Request }) => {
  const target = resolveStatusTarget(request);

  if (!target.isRemote) {
    return json(getLocalNitroStatus(target.requestOrigin));
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
