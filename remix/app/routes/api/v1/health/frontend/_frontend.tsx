import { json } from '~/api/http';
import {
  type BasicServiceHealthStatus,
  fetchWithTimeout,
  resolveStatusTarget,
  unavailableServiceStatus
} from '~/api/utils/health/statusTarget';

const getFrontendStatus = async (origin: string): Promise<BasicServiceHealthStatus> => {
  const { response, responseMs } = await fetchWithTimeout(`${origin}/`, {
    headers: {
      Accept: 'text/html'
    },
    redirect: 'follow'
  });
  const html = await response.text();
  const shellDetected =
    html.includes('<div id="root"></div>') ||
    html.includes('<div id="root"') ||
    html.includes('Thingtime');
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
    bytes: html.length,
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
