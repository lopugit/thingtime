import { json } from '@vercel/remix';

import { getVercelDeploymentsOverview, isVercelStatusEnabled } from '~/api/utils/vercel/status';

const getDeployments = async () => {
  if (!isVercelStatusEnabled()) {
    throw new Response('Not found', { status: 404 });
  }

  const overview = await getVercelDeploymentsOverview();
  return json(overview);
};

// GET /api/v1/vercel/deployments
export const loader = getDeployments;

// POST /api/v1/vercel/deployments keeps API tester parity with other status endpoints.
export const action = getDeployments;
