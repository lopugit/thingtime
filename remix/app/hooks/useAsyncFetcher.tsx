import { aiTaskFetch } from '~/components/Lopu/aiTasks.client';
import { useCallback, useRef, useState } from 'react';

import { createApiFailure, readApiResponsePayload } from './apiFailure';
import { recordApiCall } from './apiRequestLog';
import { changesRootIdentity, rootIdentity } from '../utils/rootIdentity';
import { useDataPlane } from './useDataPlane';
import { EXPECTED_DATA_PLANE_HEADER } from '../utils/dataPlane';
import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';

export function useAsyncFetcher() {
  const dataPlane = useDataPlane();
  const planeRef = useRef(dataPlane); planeRef.current = dataPlane;
  const [defaultOpts, setDefaultOpts] = useState({
    method: 'POST',
    encType: 'application/json'
  });

  const submit = useCallback(
    async (
      data,
      opts: { action: string; method?: string; encType?: string; signal?: AbortSignal; errorContext?: string; expectedActor?: string; expectedDataPlane?: string | null }
    ) => {
      const nextOpts = { ...defaultOpts, ...opts };
      const headers = new Headers();
      // Capture before capability negotiation: a delayed action from a retired
      // view must never be retargeted to a newly selected database.
      const expectedPlane = nextOpts.expectedDataPlane === undefined ? planeRef.current : nextOpts.expectedDataPlane;
      if (expectedPlane) {
        await requireThingtimeCapability('api.mongodb-endpoint', '1.1.0');
        headers.set(EXPECTED_DATA_PLANE_HEADER, expectedPlane);
      }
      if (nextOpts.expectedActor) headers.set('X-Thingtime-Expected-Actor', nextOpts.expectedActor);
      let body: BodyInit | undefined;

      if (nextOpts.encType === 'application/json') {
        headers.set('Content-Type', 'application/json');
        body = JSON.stringify(data || {});
      } else {
        const formData = new FormData();
        Object.entries(data || {}).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            formData.set(key, String(value));
          }
        });
        body = formData;
      }

      // DevKit request log: every mutation is timed + recorded (body is
      // redacted by the recorder before it is stored)
      const loggedBody = nextOpts.encType === 'application/json' ? data || {} : undefined;
      const method = nextOpts.method || 'POST';
      const started = performance.now();
      let response: Response;
      try {
        response = await aiTaskFetch(nextOpts.action, {
          method,
          credentials: 'include',
          headers,
          body,
          signal: nextOpts.signal
        });
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError';
        recordApiCall({
          at: Date.now(),
          method,
          url: nextOpts.action,
          status: 0,
          ok: false,
          aborted,
          durationMs: Math.round(performance.now() - started),
          body: loggedBody
        });
        if (aborted) throw error;
        throw createApiFailure({ cause: error, action: nextOpts.errorContext, method });
      }
      recordApiCall({
        at: Date.now(),
        method,
        url: nextOpts.action,
        status: response.status,
        ok: response.ok,
        durationMs: Math.round(performance.now() - started),
        body: loggedBody
      });
      const payload = await readApiResponsePayload(response, {
        action: nextOpts.errorContext,
        method
      });

      if (!response.ok) {
        if (response.status === 409 && payload?.code === 'DATA_PLANE_CHANGED') {
          rootIdentity.changed(); window.dispatchEvent(new Event('thingtime:root-data-refresh'));
        }
        throw createApiFailure({
          payload,
          status: response.status,
          retryAfter: response.headers.get('Retry-After'),
          action: nextOpts.errorContext,
          method
        });
      }

      if (changesRootIdentity(nextOpts.action, payload, method)) rootIdentity.changed();
      return payload;
    },
    [defaultOpts]
  );

  return { submit, setDefaultOpts };
}
