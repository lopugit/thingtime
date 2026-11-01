// CI control-plane retention policy — PURE (no mongo/node imports) so the
// colocated node --test unit tests load it without a bundler.
//
// Why retention exists at all: the ci-event / ci-workflow-run firehose is
// machine-written telemetry (every GitHub workflow_job delivery is a row), and
// measured in production it reached ~200,000 events + ~70,000 job rows PER DAY.
// Unbounded, that is millions of rows a month in a collection whose only
// readers are the admin CI dashboard (newest 200–500 events, newest 250 runs)
// and the per-parent history drawer. Current-state entities (repository,
// feature, branch, pull request, automation/preview policies, dispatch claims,
// feature stacks) are bounded by the repository's real cardinality and never
// expire.
//
// Every retained row carries a root `expiresAt` Date; the ciControl TTL index
// (collections.ts createCiControlIndexes) reaps it. Entities refresh their
// expiry on every accepted update, so a job that is still receiving deliveries
// keeps its window from its LAST update, not its first.

export const CI_RETENTION_ENV = {
  event: 'THINGTIME_CI_EVENT_RETENTION_DAYS',
  job: 'THINGTIME_CI_JOB_RETENTION_DAYS',
  activity: 'THINGTIME_CI_ACTIVITY_RETENTION_DAYS'
} as const;

export const DEFAULT_CI_RETENTION_DAYS = {
  // append-only status history: the dashboard shows the newest 200–500
  event: 14,
  // per-job current-state rows (ci-workflow-run with a `job:` externalId) —
  // 80% of all workflow-run rows in production, never linked from anywhere
  job: 30,
  // top-level workflow runs, deployments, previews
  activity: 90
} as const;

// Hard ceiling on any configured window: ten years is "effectively forever"
// while still keeping the field a real Date the TTL index can reason about.
export const MAX_CI_RETENTION_DAYS = 3650;

export type CiRetentionClass = 'event' | 'job' | 'activity' | 'permanent';

export type CiRetentionPolicy = {
  // null = keep forever (an explicit `0` opts a class out of expiry)
  eventDays: number | null;
  jobDays: number | null;
  activityDays: number | null;
};

const parseDays = (raw: string | undefined, fallback: number): number | null => {
  if (raw === undefined || raw === null) return fallback;
  const text = String(raw).trim();
  if (!text) return fallback;
  if (!/^\d+$/.test(text)) return fallback;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) return fallback;
  if (parsed === 0) return null;
  return Math.min(MAX_CI_RETENTION_DAYS, parsed);
};

export const ciRetentionPolicy = (env: Record<string, string | undefined> = process.env): CiRetentionPolicy => ({
  eventDays: parseDays(env[CI_RETENTION_ENV.event], DEFAULT_CI_RETENTION_DAYS.event),
  jobDays: parseDays(env[CI_RETENTION_ENV.job], DEFAULT_CI_RETENTION_DAYS.job),
  activityDays: parseDays(env[CI_RETENTION_ENV.activity], DEFAULT_CI_RETENTION_DAYS.activity)
});

// Which retention window a ci-* row belongs to. `externalId` distinguishes a
// workflow_job projection (`job:<id>`) from a top-level workflow run.
export const ciRetentionClass = (kind: string, externalId?: string | null): CiRetentionClass => {
  if (kind === 'ci-event') return 'event';
  if (kind === 'ci-workflow-run') return typeof externalId === 'string' && externalId.startsWith('job:') ? 'job' : 'activity';
  if (kind === 'ci-deployment' || kind === 'ci-preview') return 'activity';
  return 'permanent';
};

const daysFor = (policy: CiRetentionPolicy, retentionClass: CiRetentionClass): number | null => {
  switch (retentionClass) {
    case 'event':
      return policy.eventDays;
    case 'job':
      return policy.jobDays;
    case 'activity':
      return policy.activityDays;
    default:
      return null;
  }
};

const DAY_MS = 24 * 60 * 60 * 1000;

// The root expiresAt for a row of `kind`, measured from `base` (its latest
// accepted update). null = permanent — the writer must $unset any stale stamp.
export const ciExpiresAt = (
  kind: string,
  externalId: string | null | undefined,
  base: Date,
  policy: CiRetentionPolicy = ciRetentionPolicy()
): Date | null => {
  const days = daysFor(policy, ciRetentionClass(kind, externalId));
  if (days === null) return null;
  const baseMs = base instanceof Date && Number.isFinite(base.getTime()) ? base.getTime() : Date.now();
  return new Date(baseMs + days * DAY_MS);
};

// Operator-facing summary (admin CI snapshot + docs): the effective windows.
export const describeCiRetention = (policy: CiRetentionPolicy = ciRetentionPolicy()) => ({
  eventDays: policy.eventDays,
  jobDays: policy.jobDays,
  activityDays: policy.activityDays,
  env: { ...CI_RETENTION_ENV }
});
