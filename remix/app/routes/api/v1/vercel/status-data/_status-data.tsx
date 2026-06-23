import { json } from '@vercel/remix';

import { getVercelDeploymentStatus, isVercelStatusEnabled } from '~/api/utils/vercel/status';

export const loader = async () => {
  if (!isVercelStatusEnabled()) {
    throw new Response('Not found', { status: 404 });
  }

  const status = await getVercelDeploymentStatus();
  return json(status);
};
