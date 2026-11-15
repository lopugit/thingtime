import { createHash } from 'node:crypto';
import { scheduledRunExecution, sanitizeScheduledRunSummary, type ScheduledRunSummary, type ScheduledRunCorrelation } from './scheduledRunContext';
import { randomUUID, timingSafeEqual } from 'node:crypto';
export { currentScheduledRunCorrelation, recordScheduledPassResult, type ScheduledRunCorrelation, type ScheduledRunSummary } from './scheduledRunContext';

// Fixed executable jobs, not user-supplied paths, names, or payloads. Keep the
// exact set covered against vercel.json so new scheduled routes cannot vanish.
export const SCHEDULED_HTTP_JOBS = [
  { path: '/api/v1/auth/invites/expire', name: 'Expire invitations' },
  { path: '/api/v1/lopu/recordings/run', name: 'Process recordings and scheduled work' },
  { path: '/api/v1/attachments/cleanup', name: 'Clean up attachments' },
  { path: '/api/v1/moderation/sweep', name: 'Sweep moderation' },
  { path: '/api/v1/peers/sync', name: 'Synchronize peers' },
  { path: '/api/v1/notifications/email/weekly-summary', name: 'Send weekly email summaries' },
  { path: '/api/v1/ai/models/sync', name: 'Synchronize AI model catalogue' },
  { path: '/api/v1/backups/run', name: 'Dispatch backup recovery' },
  { path: '/api/v1/devices/observations/cleanup', name: 'Clean up device observations' }
] as const;

export type ScheduledRunStatus = 'started' | 'completed' | 'failed' | 'cancelled';
export type ScheduledRunEvent = {
  runId: string;
  jobName: typeof SCHEDULED_HTTP_JOBS[number]['name'];
  path: typeof SCHEDULED_HTTP_JOBS[number]['path'];
  status: ScheduledRunStatus;
  httpCode: number | null;
  startedAt: string;
  observedAt: string;
  parentRunId?: string;
  scope?: 'scheduled-pass' | 'workflow';
  summary?: ScheduledRunSummary;
};
export type ScheduledRunDelivery = 'recorded' | 'unavailable' | 'disabled' | 'unconfigured';
export type ScheduledRunSink = (event: Readonly<ScheduledRunEvent>) => Promise<void | ScheduledRunDelivery>;

// Same exact CRON_SECRET bearer contract as the registered cron routes. A
// normal session, administrator POST, HEAD or arbitrary route is never admitted.
export const isScheduledCronAuthorized = (request: Pick<Request, 'method' | 'headers'>, secret: string | undefined): boolean => {
  if (request.method !== 'GET' || !secret?.trim()) return false;
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  const actual = Buffer.from(request.headers.get('Authorization') ?? '', 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

// Reporting failure does not change or retry the actual work. The caller can
// inspect this safe delivery result; raw sink errors are never returned/logged.
export const deliverScheduledRunEvent = async (event: ScheduledRunEvent, sink?: ScheduledRunSink): Promise<ScheduledRunDelivery> => {
  if (!sink) return 'unavailable';
  try { const result=await sink(Object.freeze({ ...event })); return typeof result==='string' ? result : 'recorded'; }
  catch { return 'unavailable'; }
};

export const createScheduledRunReporter = (dependencies: {
  sink?: ScheduledRunSink;
  getSecret?: () => string | undefined;
  now?: () => Date;
  runId?: () => string;
} = {}) => {
  const now = dependencies.now ?? (() => new Date());
  return async (request: Pick<Request, 'method' | 'headers' | 'signal'>, path: string, handler: () => Promise<Response>): Promise<Response> => {
    const job = SCHEDULED_HTTP_JOBS.find((entry) => entry.path === path);
    if (!job || !isScheduledCronAuthorized(request, (dependencies.getSecret ?? (() => process.env.CRON_SECRET))())) return handler();
    const runId = (dependencies.runId ?? randomUUID)();
    const startedAt = now().toISOString();
    let finished = false;
    const context={correlation:{runId,jobName:job.name,path:job.path,startedAt},summary:undefined as ScheduledRunSummary|undefined};
    const emit = async (status: ScheduledRunStatus, httpCode: number | null) => {
      const delivery=await deliverScheduledRunEvent({runId,jobName:job.name,path:job.path,status,httpCode,startedAt,observedAt:now().toISOString(),scope:'scheduled-pass',...(context.summary?{summary:context.summary}:{})},dependencies.sink);
      if (delivery==='unavailable' || delivery==='unconfigured') console.warn(JSON.stringify({event:'scheduled-run-reporting',runId,path:job.path,status,delivery}));
      return delivery;
    };
    const finish = async (status: ScheduledRunStatus, httpCode: number | null) => {
      if (finished) return;
      finished = true;
      await emit(status==='completed'&&['partial-failure','failed'].includes(context.summary?.outcome??'')?'failed':status, httpCode);
    };
    const startDelivery=await emit('started', null);
    const responseHeaders=(response:Response)=>{
      const headers=new Headers(response.headers);
      headers.set('X-Thingtime-Scheduled-Run-Id',runId);
      headers.set('X-Thingtime-Run-Start-Reporting',startDelivery);
      return headers;
    };
    let response: Response;
    try { response = await scheduledRunExecution.run(context,handler); }
    catch (error) {
      await finish(request.signal.aborted ? 'cancelled' : 'failed', error instanceof Response ? error.status : 500);
      throw error;
    }
    const outcome = response.status >= 400 ? 'failed' : 'completed';
    if (!response.body) { await finish(request.signal.aborted ? 'cancelled' : outcome, response.status); return new Response(null,{status:response.status,statusText:response.statusText,headers:responseHeaders(response)}); }

    // Do not clone/drain/parse the body. Peers and other streaming handlers do
    // their work while consumed. Terminal reporting is awaited by read/cancel,
    // with no detached promises and no prefetch that could manufacture success.
    const reader = response.body.getReader();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await scheduledRunExecution.run(context,()=>reader.read());
          if (result.done) {
            await finish(cancelled || request.signal.aborted ? 'cancelled' : outcome, response.status);
            controller.close();
          } else controller.enqueue(result.value);
        } catch (error) {
          await finish(request.signal.aborted ? 'cancelled' : 'failed', response.status);
          controller.error(error);
        }
      },
      async cancel(reason) {
        cancelled = true;
        try { await reader.cancel(reason); }
        finally { await finish('cancelled', response.status); }
      }
    }, { highWaterMark: 0 });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: responseHeaders(response) });
  };
};

export const reportScheduledChildRun = async (correlation:ScheduledRunCorrelation|undefined,childId:string,status:ScheduledRunStatus,summary?:ScheduledRunSummary):Promise<void> => {
 if(!correlation)return;
 const hash=createHash('sha256').update(correlation.runId).update('\0').update(childId).digest('hex');
 const runId=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
 const {platformScheduledRunSink}=await import('./platformReporting');
 const event:ScheduledRunEvent={...correlation,runId,parentRunId:correlation.runId,scope:'workflow',status,httpCode:null,observedAt:new Date().toISOString(),...(summary?{summary:sanitizeScheduledRunSummary(summary)}:{})};
 const delivery=await deliverScheduledRunEvent(event,platformScheduledRunSink);
 if(delivery==='unavailable'||delivery==='unconfigured')console.warn(JSON.stringify({event:'scheduled-run-reporting',runId,parentRunId:correlation.runId,path:correlation.path,status,delivery}));
};
