import { defineHandler } from 'nitro/h3';
import { agentTestRefusal } from '../../../app/api/utils/agentTesting';

import { rootDataResponse } from '../../../app/root-data.server';
import { proxyApiRequestToFallback, shouldProxyApiToFallback } from '../../utils/apiFallback';

export default defineHandler((event) => {
  const refused = agentTestRefusal();
  if (refused) return refused;
  if (shouldProxyApiToFallback(event.req)) {
    return proxyApiRequestToFallback(event.req);
  }

  return rootDataResponse(event.req);
});
