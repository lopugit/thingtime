import { json } from '~/api/http';
import { safeErrorText } from '~/api/utils/errors/safeError';
import { fetchRemoteJson, resolveStatusTarget } from '~/api/utils/health/statusTarget';
import { getMongoStatus, type MongoConnectionStatus } from '~/api/utils/mongodb/status';

const unavailableMongoStatus = (error: unknown): MongoConnectionStatus => {
  return {
    connected: false,
    host: null,
    dbName: null,
    pingMs: null,
    collections: null,
    checkedAt: new Date().toISOString(),
    error: safeErrorText(error, 'health: remote mongodb status', 'Remote status unavailable')
  };
};

export const loader = async ({ request }: { request: Request }) => {
  const target = resolveStatusTarget(request);

  if (!target.isRemote) {
    return json(await getMongoStatus());
  }

  try {
    const { data } = await fetchRemoteJson<MongoConnectionStatus>(
      target.targetOrigin,
      '/api/v1/health/mongodb',
      '/api/v1/mongodb/status-data'
    );

    return json(data);
  } catch (err) {
    return json(unavailableMongoStatus(err));
  }
};

export const action = loader;
