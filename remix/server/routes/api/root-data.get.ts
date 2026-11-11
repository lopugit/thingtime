import { defineHandler } from 'nitro/h3';
import { agentTestRefusal } from '../../../app/api/utils/agentTesting';
import { isNativeHomeSelected, runNativeHomeRequest } from '../../utils/nativeHomeRuntime';

import { rootDataResponse } from '../../../app/root-data.server';
import { hasSelfHostedApiEnv, proxyApiRequestToFallback, shouldProxyApiToFallback, unavailableLocalApiResponse } from '../../utils/apiFallback';

export default defineHandler((event) => {
  const refused = agentTestRefusal();
  if (refused) return refused;
  if (isNativeHomeSelected()) return runNativeHomeRequest(event.req, { method: event.req.method.toUpperCase(), path: 'root-data' }, runtime =>
    rootDataResponse(event.req, { dataPlane: runtime.publicDataPlane, dataEnvironment: null }));
  if (shouldProxyApiToFallback(event.req)) {
    return proxyApiRequestToFallback(event.req);
  }

  if (!hasSelfHostedApiEnv()) return unavailableLocalApiResponse();

  return rootDataResponse(event.req);
});
