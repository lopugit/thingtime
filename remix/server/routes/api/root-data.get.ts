import { defineHandler } from 'nitro/h3';

import { rootDataResponse } from '../../../app/root-data.server';
import { hasSelfHostedApiEnv, proxyApiRequestToFallback, shouldProxyApiToFallback, unavailableLocalApiResponse } from '../../utils/apiFallback';

export default defineHandler((event) => {
  if (shouldProxyApiToFallback(event.req)) {
    return proxyApiRequestToFallback(event.req);
  }

  if (!hasSelfHostedApiEnv()) return unavailableLocalApiResponse();

  return rootDataResponse(event.req);
});
