import { createHash, randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { getSettingsCollection } from '../mongodb/collections';
import { SCHEDULED_HTTP_JOBS, defaultPolicy, type Job, type JobPolicy } from './scheduledJobs';
import { automationSwitchEnabled } from './automationSwitchesStore';
import { scheduledJobSwitchId } from '../../../automation/automationSwitches';

const keyFor = (job: Job) => 'scheduled-job:' + job.id;
const idFor = (job: Job) => new ObjectId(createHash('sha256').update(keyFor(job)).digest().subarray(0, 12));
const duplicate = (error: unknown) => (error as { code?: number })?.code === 11000;
function policy(job: Job, row: Record<string, any> | undefined | null): JobPolicy {
  if (!row || row.revision == null) return defaultPolicy(job);
  if (typeof row.enabled !== 'boolean' || !Number.isInteger(row.hour) || row.hour < 0 || row.hour > 23 || typeof row.revision !== 'string')
    throw new Error('Invalid saved job schedule');
  return { id: job.id, enabled: row.enabled, hour: row.hour, revision: row.revision };
}
export async function readJobSchedules() {
  const db = await getSettingsCollection();
  const rows = await db.find({ key: { $in: SCHEDULED_HTTP_JOBS.map(keyFor) } }).toArray();
  return SCHEDULED_HTTP_JOBS.map(job => policy(job, rows.find(row => row.key === keyFor(job))));
}
export async function saveJobSchedule(actor: string, job: Job, input: JobPolicy) {
  const db = await getSettingsCollection();
  const revision = randomUUID();
  try {
    const r = await db.updateOne({ _id: idFor(job), key: keyFor(job), revision: input.revision },
      { $set: { revision, enabled: input.enabled, hour: input.hour, updatedBy: actor } }, { upsert: input.revision === null });
    return r.matchedCount + r.upsertedCount > 0;
  } catch (e) { if (duplicate(e)) return false; throw e; }
}
export function due(job: Job, settings: JobPolicy, now: Date) {
  return settings.enabled && now.getUTCHours() >= settings.hour &&
    (job.weekday === null || job.weekday === now.getUTCDay());
}
// An ambiguous or failed execution keeps its daily claim: jobs may have already
// sent mail or dispatched a workflow. Manual recovery uses the job's own tools.
export async function claimScheduledDay(job: Job, now: Date) {
  // The administrator's Automation switch is the master on/off for every
  // scheduled job; the job's own schedule (enabled + hour) applies only when on.
  if (!(await automationSwitchEnabled(scheduledJobSwitchId(job.id)))) return false;
  const db = await getSettingsCollection();
  const key = keyFor(job);
  const row = await db.findOne({ key });
  const saved = policy(job, row);
  if (!due(job, saved, now)) return false;
  const day = now.toISOString().slice(0, 10);
  if (row?.lastDay >= day) return false;
  try {
    const r = await db.updateOne({ _id: idFor(job), key, revision: saved.revision, $or: [{ lastDay: { $lt: day } }, { lastDay: null }] },
      { $set: { lastDay: day } }, { upsert: saved.revision === null });
    return r.matchedCount + r.upsertedCount > 0;
  } catch (e) { if (duplicate(e)) return false; throw e; }
}
