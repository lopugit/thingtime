import { verifyCiProviderRouteSignature } from '../ciControl/providerRouter';
import { SCHEDULED_HTTP_JOBS } from './scheduledJobs';
import { isScheduledCronAuthorized } from './scheduledRunReporting';
import { withVerifiedScheduledRequest } from './scheduledJobSecret';
import { claimScheduledDay } from './jobSchedules';

const empty = (status: number) => new Response(null, { status, headers: { 'Cache-Control': 'private, no-store' } });
export function signedJobValid(request: Request, path: string, now: Date, secret: string) {
  const url = new URL(request.url);
  const timestamp = request.headers.get('X-Thingtime-Schedule-Time') || '';
  const instant = Date.parse(timestamp);
  if (request.method !== 'GET' || url.protocol !== 'https:' || url.pathname !== path || url.search ||
      !Number.isFinite(instant) || Math.abs(now.getTime() - instant) > 60_000) return false;
  return verifyCiProviderRouteSignature(['thingtime-scheduled-job-v1', 'GET', url.origin, path, timestamp].join('\n'),
    request.headers.get('X-Thingtime-CI-Signature'), secret);
}
export async function dispatchScheduledRequest(request: Request, path: string, run: (request: Request) => Promise<Response>) {
  const job = SCHEDULED_HTTP_JOBS.find(entry => entry.path === path);
  if (!job) return run(request);
  const signed = request.headers.has('X-Thingtime-Schedule-Time');
  const now = new Date();
  if (signed) {
    if (!signedJobValid(request, path, now, process.env.THINGTIME_CI_ROUTER_SECRET?.trim() || '')) return empty(401);
  } else if (!isScheduledCronAuthorized(request, process.env.CRON_SECRET)) return run(request);
  if (request.headers.has('cookie') || request.headers.has('x-tt-mongo-url') ||
      request.headers.has('X-Thingtime-Background-Id')) return empty(403);
  if (!(await claimScheduledDay(job, now))) return empty(204);
  return signed ? withVerifiedScheduledRequest(request, run) : run(request);
}
