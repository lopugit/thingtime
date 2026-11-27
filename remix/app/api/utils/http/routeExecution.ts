// The per-endpoint request pipeline shared by every API runtime: Nitro on Vercel
// and local/desktop (`server/routes/api/[...].ts`) and the Cloudflare API Worker
// (`cloudflare/api`). Keep endpoint behaviour here, not in either runtime's entry,
// so one handler runs the same way everywhere.

import { dispatchScheduledRequest } from '../automation/scheduledDispatch';
import { platformScheduledRunSink } from '../automation/platformReporting';
import { createScheduledRunReporter } from '../automation/scheduledRunReporting';
import { enforceExpectedActor } from '../auth/expectedActor';
import { getCurrentUser } from '../auth/getCurrentUser';
import { recordErrorLog, withErrorLogRequest } from '../errors/errorLogs';
import { storageFailureCode, storageFailureFromResponse } from '../errors/storageFailure';
import { runWithMongoConnectionFeature } from '../mongodb/connectionTracker';
import { publishMongoConnectionSnapshots } from '../mongodb/connectionInventory';
import { enforceExpectedDataPlane } from '../mongodb/dataPlane';
import { getRequestMongoEndpoint, runWithMongoEndpoint } from '../mongodb/endpoint';
import { StorageMutationError } from '../storage/storageCore';
import { scheduleUserStorageRecovery } from '../storage/userStorageRecovery';

export type ApiRouteModule = {
  loader?: (args: { request: Request; params?: Record<string, string> }) => Promise<unknown> | unknown;
  action?: (args: { request: Request; params?: Record<string, string> }) => Promise<unknown> | unknown;
};

export const jsonResponse = (value: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
  }

  return new Response(JSON.stringify(value), {
    ...init,
    headers
  });
};

export const normalizeResponse = (value: unknown) => {
  if (value instanceof Response) {
    return value;
  }

  if (value && typeof value === 'object' && 'body' in value && ('status' in value || 'headers' in value)) {
    const legacy = value as {
      status?: number;
      headers?: HeadersInit;
      body?: unknown;
    };

    return new Response(JSON.stringify(legacy.body ?? null), {
      status: legacy.status || 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...(legacy.headers as Record<string, string> | undefined)
      }
    });
  }

  return jsonResponse(value ?? null);
};

// The private-post sink is supplied by the platform reporting integration.
const reportScheduledRequest = createScheduledRunReporter({ sink: platformScheduledRunSink });

export type ExecuteApiRouteInput = {
  request: Request;
  /** Registry path without the `/api/` prefix, e.g. `v1/automation/switches`. */
  path: string;
  method: string;
  loadModule: () => Promise<ApiRouteModule>;
  signal: AbortSignal;
  /**
   * Runs a request marked `X-Thingtime-Background-Id` as a background task. A
   * runtime without background tasks leaves it out, and such requests get 409
   * so the router can send them to a runtime that has them.
   */
  startBackgroundTask?: (request: Request, run: (request: Request) => Promise<Response>) => Promise<Response>;
};

export async function executeApiRoute({ request, path, method, loadModule, signal, startBackgroundTask }: ExecuteApiRouteInput): Promise<Response> {
  const { getApiDocByPath } = await import('../../../docs/apiDocs');
  return runWithMongoConnectionFeature(getApiDocByPath(path)?.group, () => withErrorLogRequest('/api/' + path, method, async () => {
  try {
  const route = await loadModule();
  const handler = method === 'GET' || method === 'HEAD' ? route.loader : route.action;

  if (!handler) {
    return new Response('Method not allowed', {
      status: 405,
      headers: {
        Allow: [route.loader ? 'GET' : undefined, route.action ? 'POST' : undefined].filter(Boolean).join(', ')
      }
    });
  }

  // Establish the request's MongoDB endpoint context (the `tt_mongo` session
  // cookie / `x-tt-mongo-url` header — see api/utils/mongodb/endpoint.ts) so
  // the data plane below the handler resolves the session's active endpoint.
  // Admin routes are exempt: migrations and other admin writes must always
  // operate on the home deployment, never on an override DB.
  const selectedEndpoint = await getRequestMongoEndpoint(request);
  const dataPlaneFailure = enforceExpectedDataPlane(request, selectedEndpoint);
  if (dataPlaneFailure) return dataPlaneFailure;
  const mongoEndpoint = path.startsWith('v1/admin/') ? null : selectedEndpoint;

  try {
		const response = await runWithMongoEndpoint(mongoEndpoint, async () => {
      const identityFailure = await enforceExpectedActor(request, getCurrentUser);
      if (identityFailure) return identityFailure;
      if (request.headers.has('X-Thingtime-Background-Id')) {
        if (request.headers.has('X-Thingtime-Schedule-Time')) return new Response(null, { status: 403 });
        if (!startBackgroundTask) return jsonResponse({ ok: false, error: 'Background tasks run on another Thingtime runtime.' }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } });
        return startBackgroundTask(request, async backgroundRequest => normalizeResponse(await handler({ request: backgroundRequest })));
      }
      try {
        return dispatchScheduledRequest(request, '/api/' + path, scheduledRequest =>
          reportScheduledRequest(scheduledRequest, '/api/' + path, async () => normalizeResponse(await handler({ request: scheduledRequest }))));
      } finally {
        // Source/queue transactions have finished before the recovery worker
        // opens its own transaction. Durable jobs also survive a lost request.
        if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
          try {
            const actor = await getCurrentUser(request);
            if (actor) scheduleUserStorageRecovery(actor.id);
          } catch { /* Scheduler discovery remains the durable fallback. */ }
        }
      }
    });
    if (!signal.aborted && response.status >= 500 && path !== 'v1/admin/error-logs') {
      const code = await storageFailureFromResponse(response);
      await recordErrorLog(new Error(code ? 'Storage accounting requires recovery' : 'HTTP request returned a server error'), { source: code ? 'storage-accounting' : 'http-response', status: response.status, code });
    }
    return response;
  } catch (err) {
    if (err instanceof Response) {
      return err;
    }
		if (err instanceof StorageMutationError) {
      if (!signal.aborted && err.status >= 500) await recordErrorLog(new Error('Storage accounting requires recovery'), { source: 'storage-accounting', status: err.status, code: storageFailureCode(err.message) ?? (err.code === 'storage_invariant' ? 'STORAGE_INVARIANT' : 'STORAGE_ACCOUNTING_UNAVAILABLE') });
			return jsonResponse({ ok: false, error: err.message }, { status: err.status });
		}

    throw err;
  }
  } catch (error) {
    if (!signal.aborted && !(error instanceof Response) && path !== 'v1/admin/error-logs') await recordErrorLog(error, { source: 'http-unhandled', status: 500 });
    throw error;
  } finally {
    // Request-bound telemetry only. Health/discovery and proxy returns do not
    // warm clients or schedule polling; publication reuses an existing home pool.
    if (!signal.aborted && !path.startsWith('v1/health') && !path.startsWith('v1/mongodb/status') && path !== 'v1/capabilities') {
      try { await publishMongoConnectionSnapshots(); } catch { /* Telemetry must never replace an API response. */ }
    }
  }
  }));
}
