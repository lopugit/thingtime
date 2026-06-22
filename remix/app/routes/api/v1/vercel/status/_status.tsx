import { json } from '@vercel/remix';

import { getVercelDeploymentStatus } from '~/api/utils/vercel/status';

// GET /api/v1/vercel/status
export const loader = async () => {
  const status = await getVercelDeploymentStatus();
  return json(status);
};

// POST /api/v1/vercel/status keeps API tester parity with other status endpoints.
export const action = async () => {
  const status = await getVercelDeploymentStatus();
  return json(status);
};
