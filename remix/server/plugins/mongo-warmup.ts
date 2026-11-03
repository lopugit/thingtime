import { definePlugin } from 'nitro';
import { agentTestEnvironment } from '../../app/api/utils/agentTesting';
import { hasSelfHostedApiEnv } from '../utils/apiFallback';
import { getGatewaySettings } from '../../app/api/utils/deployment/environmentGateway';

import { ensureIndexes, warnIfTransactionsUnsupported } from '../../app/api/utils/mongodb/collections';

// Unconfigured self-hosted mode can prepare indexes in the background.
// Mutations still await durable readiness, while authentication reads remain
// available if required DDL fails. Explicit gateways initialize lazily below.
//
// An incomplete server must not connect or create indexes before the request
// guard can reject it. Explicit desktop bridges also skip local DB warmup.
export default definePlugin(() => {
  // A malformed isolated test must never connect or adopt remote storage.
  agentTestEnvironment();
  if (!hasSelfHostedApiEnv()) return;
  try {
    // Discovery can itself cold-start the alias target. Never recursively
    // discover/warm a configured gateway from its startup plugin. First
    // admitted DB access opens the pool; first mutation ensures its plan.
    if (getGatewaySettings()) return;
    void ensureIndexes().catch(() => {});
    void warnIfTransactionsUnsupported().catch(() => {});
  } catch {
    // A configured but unavailable database must not crash static serving.
  }
});
