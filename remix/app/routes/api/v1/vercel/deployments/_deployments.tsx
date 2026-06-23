import { json } from '@vercel/remix';

import {
  getVercelDeploymentsOverview,
  isVercelStatusEnabled,
  normaliseDeploymentBranchLimit
} from '~/api/utils/vercel/status';

const getBranchLimitFromRequest = (request: Request) => {
  const url = new URL(request.url);

  return normaliseDeploymentBranchLimit(
    url.searchParams.get('branches') ||
      url.searchParams.get('branchLimit') ||
      url.searchParams.get('limit')
  );
};

const getDeployments = async ({ request }: { request: Request }) => {
  if (!isVercelStatusEnabled()) {
    throw new Response('Not found', { status: 404 });
  }

  const overview = await getVercelDeploymentsOverview({
    limit: getBranchLimitFromRequest(request)
  });

  return json(overview);
};

// GET /api/v1/vercel/deployments
export const loader = getDeployments;

// POST /api/v1/vercel/deployments keeps API tester parity with other status endpoints.
export const action = getDeployments;
