import { createHash } from 'node:crypto';
import { resolvePublicOrigin } from '../auth/publicOrigin';
import { getRequestMongoEndpoint } from '../mongodb/endpoint';

/** Private scope digest; endpoint credentials never enter the activity payload. */
export const backgroundTaskScopeFor = async (request: Request): Promise<string> =>
  createHash('sha256').update(JSON.stringify([resolvePublicOrigin(request).origin, await getRequestMongoEndpoint(request)])).digest('hex');
