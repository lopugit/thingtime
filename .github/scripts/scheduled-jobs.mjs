import { createHmac } from 'node:crypto';
import { origin, requireOperation } from './deployment-profiles.mjs';

const paths = [
  '/api/v1/auth/invites/expire', '/api/v1/lopu/recordings/run',
  '/api/v1/attachments/cleanup', '/api/v1/moderation/sweep',
  '/api/v1/peers/sync', '/api/v1/notifications/email/weekly-summary',
  '/api/v1/ai/models/sync', '/api/v1/backups/run', '/api/v1/devices/observations/cleanup'
];

await requireOperation('api.admin-job-schedules', '/api/v1/admin/job-schedules', 'GET');
const secret = process.env.THINGTIME_CI_ROUTER_SECRET;
if (!secret) throw new Error('Missing scheduler identity');
for (const path of paths) {
  const timestamp = new Date().toISOString();
  const message = ['thingtime-scheduled-job-v1', 'GET', origin, path, timestamp].join('\n');
  try {
    const response = await fetch(origin + path, {
      redirect: 'error', signal: AbortSignal.timeout(300000),
      headers: {
        'x-thingtime-schedule-time': timestamp,
        'x-thingtime-ci-signature': 'sha256=' + createHmac('sha256', secret).update(message).digest('hex')
      }
    });
    // Avoid emitting private job results in public Actions logs.
    await response.body?.cancel();
    if (!response.ok) throw new Error('HTTP ' + response.status);
    console.log(path, response.status);
  } catch (error) {
    console.error(path, error.message);
    process.exitCode = 1;
  }
}
