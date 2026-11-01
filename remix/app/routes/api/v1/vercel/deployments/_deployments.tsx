import { json } from '~/api/http';

import {
  getVercelDeploymentsOverview,
  isVercelStatusEnabled,
  normaliseDeploymentBranchLimit,
  normaliseDeploymentHistoryLimit
} from '~/api/utils/vercel/status';

const getBranchLimitFromRequest = (request: Request) => {
  const url = new URL(request.url);

  return normaliseDeploymentBranchLimit(
    url.searchParams.get('branches') ||
      url.searchParams.get('branchLimit') ||
      url.searchParams.get('limit')
  );
};

const getHistoryLimitFromRequest = (request: Request) => {
  const url = new URL(request.url);

  return normaliseDeploymentHistoryLimit(
    url.searchParams.get('history') ||
      url.searchParams.get('historyLimit') ||
      url.searchParams.get('deploymentsPerBranch')
  );
};

const getDeployments = async ({ request }: { request: Request }) => {
  if (!isVercelStatusEnabled()) {
    throw new Response('Not found', { status: 404 });
  }

  const overview = await getVercelDeploymentsOverview({
    historyLimit: getHistoryLimitFromRequest(request),
    limit: getBranchLimitFromRequest(request)
  });

  return json(overview);
};

// GET /api/v1/vercel/deployments
export const loader = getDeployments;

// POST /api/v1/vercel/deployments keeps API tester parity with other status endpoints.
export const action = getDeployments;
