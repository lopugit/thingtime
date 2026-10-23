import { json } from '~/api/http';

import { getVercelDeploymentStatus, isVercelStatusEnabled } from '~/api/utils/vercel/status';

// GET /api/v1/vercel/status
export const loader = async () => {
  if (!isVercelStatusEnabled()) {
    throw new Response('Not found', { status: 404 });
  }

  const status = await getVercelDeploymentStatus();
  return json(status);
};

// POST /api/v1/vercel/status keeps API tester parity with other status endpoints.
export const action = async () => {
  if (!isVercelStatusEnabled()) {
    throw new Response('Not found', { status: 404 });
  }

  const status = await getVercelDeploymentStatus();
  return json(status);
};
