import { json } from '~/api/http';
import {
  type BasicServiceHealthStatus,
  fetchWithTimeout,
  resolveStatusTarget,
  unavailableServiceStatus
} from '~/api/utils/health/statusTarget';

const getFrontendStatus = async (origin: string): Promise<BasicServiceHealthStatus> => {
  const { response, responseMs, body: html } = await fetchWithTimeout(`${origin}/`, {
    headers: {
      Accept: 'text/html'
    },
    redirect: 'error'
  }, undefined, response => response.text());
  const content = html || '';
  const shellDetected =
    content.includes('<div id="root"></div>') ||
    content.includes('<div id="root"') ||
    content.includes('Thingtime');
  const ok = response.ok && shellDetected;

  return {
    ok,
    service: 'frontend',
    state: ok ? 'ready' : 'unavailable',
    label: ok ? 'Frontend: ready' : 'Frontend: unavailable',
    checkedAt: new Date().toISOString(),
    origin,
    targetOrigin: origin,
    responseMs,
    statusCode: response.status,
    bytes: content.length,
    shellDetected
  };
};

export const loader = async ({ request }: { request: Request }) => {
  const target = resolveStatusTarget(request);

  try {
    return json(await getFrontendStatus(target.targetOrigin));
  } catch (err) {
    return json(unavailableServiceStatus('frontend', target.targetOrigin, err));
  }
};

export const action = loader;
