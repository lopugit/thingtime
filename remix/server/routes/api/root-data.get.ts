import { defineHandler } from 'nitro/h3';

import { rootDataResponse } from '../../../app/root-data.server';
import { proxyApiRequestToFallback, shouldProxyApiToFallback } from '../../utils/apiFallback';

export default defineHandler((event) => {
  if (shouldProxyApiToFallback(event.req)) {
    return proxyApiRequestToFallback(event.req);
  }

  return rootDataResponse(event.req);
});
