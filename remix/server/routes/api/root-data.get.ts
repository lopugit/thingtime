import { defineHandler } from 'nitro/h3';
import { agentTestRefusal } from '../../../app/api/utils/agentTesting';
import { isNativeHomeSelected, nativeHomeUnavailableResponse } from '../../utils/nativeHomeRuntime';

import { rootDataResponse } from '../../../app/root-data.server';
import { hasSelfHostedApiEnv, proxyApiRequestToFallback, shouldProxyApiToFallback, unavailableLocalApiResponse } from '../../utils/apiFallback';

export default defineHandler((event) => {
  const refused = agentTestRefusal();
  if (refused) return refused;
  if (isNativeHomeSelected()) return nativeHomeUnavailableResponse('NATIVE_HOME_OPERATION_UNAVAILABLE');
  if (shouldProxyApiToFallback(event.req)) {
    return proxyApiRequestToFallback(event.req);
  }

  if (!hasSelfHostedApiEnv()) return unavailableLocalApiResponse();

  return rootDataResponse(event.req);
});
