import { json } from '~/api/http';
import { safeErrorText } from '~/api/utils/errors/safeError';
import { fetchRemoteJson, resolveStatusTarget } from '~/api/utils/health/statusTarget';
import { getVercelDeploymentStatus, type VercelDeploymentStatus } from '~/api/utils/vercel/status';

const unavailableVercelStatus = (error: unknown): VercelDeploymentStatus => {
  return {
    configured: false,
    hasError: true,
    error: safeErrorText(error, 'health: remote vercel status', 'Remote status unavailable'),
    label: 'Vercel: status unavailable',
    state: 'unknown'
  };
};

export const loader = async ({ request }: { request: Request }) => {
  const target = resolveStatusTarget(request);

  if (!target.isRemote) {
    return json(await getVercelDeploymentStatus());
  }

  try {
    const { data } = await fetchRemoteJson<VercelDeploymentStatus>(
      target.targetOrigin,
      '/api/v1/health/vercel',
      '/api/v1/vercel/status'
    );

    return json(data);
  } catch (err) {
    return json(unavailableVercelStatus(err));
  }
};

export const action = loader;
