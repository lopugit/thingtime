export const SCHEDULED_HTTP_JOBS = [
  { id: 'invites-expire', path: '/api/v1/auth/invites/expire', name: 'Expire invitations', hour: 0, weekday: null },
  { id: 'recordings-run', path: '/api/v1/lopu/recordings/run', name: 'Process recordings and scheduled work', hour: 1, weekday: null },
  { id: 'attachments-cleanup', path: '/api/v1/attachments/cleanup', name: 'Clean up attachments', hour: 2, weekday: null },
  { id: 'moderation-sweep', path: '/api/v1/moderation/sweep', name: 'Sweep moderation', hour: 3, weekday: null },
  { id: 'peers-sync', path: '/api/v1/peers/sync', name: 'Synchronize peers', hour: 4, weekday: null },
  { id: 'email-weekly-summary', path: '/api/v1/notifications/email/weekly-summary', name: 'Send weekly email summaries', hour: 21, weekday: 0 },
  { id: 'models-sync', path: '/api/v1/ai/models/sync', name: 'Synchronize AI model catalogue', hour: 3, weekday: null },
  { id: 'backups-run', path: '/api/v1/backups/run', name: 'Dispatch backup recovery', hour: 5, weekday: null },
  { id: 'observations-cleanup', path: '/api/v1/devices/observations/cleanup', name: 'Clean up device observations', hour: 6, weekday: null },
] as const;

export type Job = typeof SCHEDULED_HTTP_JOBS[number];
export type JobPolicy = { id: string; enabled: boolean; hour: number; revision: string | null };
export const defaultPolicy = (job: Job): JobPolicy => ({ id: job.id, enabled: true, hour: job.hour, revision: null });
