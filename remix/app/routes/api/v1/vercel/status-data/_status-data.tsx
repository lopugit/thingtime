import { json } from '@vercel/remix';

import { getVercelDeploymentStatus } from '~/api/utils/vercel/status';

export const loader = async () => {
  const status = await getVercelDeploymentStatus();
  return json(status);
};
