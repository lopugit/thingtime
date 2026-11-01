import { createHmac, timingSafeEqual } from 'node:crypto';

import { getSettingsCollection } from '../mongodb/collections';

// Vercel webhook → persisted deployment status (TODO item 5).
//
// Instead of every status request spending Vercel API calls (even when the
// deployment has been ready for days), Vercel pushes deployment lifecycle
// events to POST /api/v1/vercel/webhook. We persist the latest status per git
// branch in the shared `settings` collection, and getVercelDeploymentStatus
// serves terminal states (ready/error/canceled) straight from that document —
// the live Vercel API is only consulted mid-build (for phase/progress detail)
// or when no webhook data exists yet.
//
// The feature is opt-in via VERCEL_WEBHOOK_SECRET: when the secret is unset the
// webhook route 404s and the status path behaves exactly as before.

export type VercelWebhookBranchStatus = {
  branch: string;
  commitSha?: string;
  deploymentId?: string;
  deploymentUrl?: string;
  // Vercel inspector page for the deployment — the footer's build link
  inspectorUrl?: string;
  environment?: string;
  error?: string;
  // when Vercel emitted the event (payload.createdAt)
  eventAt: string;
  eventType: string;
  recordedAt: string;
  state: 'building' | 'ready' | 'error' | 'canceled';
  // carried across builds so the footer can show "last ready" while building
  lastReadyAt?: string;
  lastReadyUrl?: string;
};

const SETTINGS_KEY = 'vercelWebhookStatus';
const MAX_TRACKED_BRANCHES = 30;

export const isVercelWebhookConfigured = () => Boolean(process.env.VERCEL_WEBHOOK_SECRET?.trim());

// Vercel signs the RAW request body with HMAC-SHA1 (hex) in x-vercel-signature.
export const verifyVercelSignature = (rawBody: string, signature: string | null): boolean => {
  const secret = process.env.VERCEL_WEBHOOK_SECRET?.trim();
  if (!secret || !signature) return false;
  const expected = createHmac('sha1', secret).update(rawBody).digest('hex');
  const provided = signature.trim().toLowerCase();
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'));
  } catch {
    return false;
  }
};

const EVENT_STATES: Record<string, VercelWebhookBranchStatus['state']> = {
  'deployment.created': 'building',
  'deployment.succeeded': 'ready',
  // an existing deployment promoted to production is live → ready
  'deployment.promoted': 'ready',
  // older event name kept for compatibility with existing webhook configs
  'deployment.ready': 'ready',
  'deployment.error': 'error',
  'deployment.canceled': 'canceled'
};

const asString = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

const getBranchFromMeta = (meta: Record<string, unknown> | undefined): string | undefined =>
  asString(meta?.githubCommitRef) || asString(meta?.gitlabCommitRef) || asString(meta?.bitbucketCommitRef);

// Extract the fields we persist from a Vercel webhook envelope. Returns null
// for event types we don't track (they're still 200-acked by the route).
export const parseVercelWebhookEvent = (
  envelope: any
): { branch: string; next: Omit<VercelWebhookBranchStatus, 'lastReadyAt' | 'lastReadyUrl' | 'recordedAt'> } | null => {
  const eventType = asString(envelope?.type);
  const state = eventType ? EVENT_STATES[eventType] : undefined;
  if (!eventType || !state) return null;

  const deployment = envelope?.payload?.deployment;
  const meta = typeof deployment?.meta === 'object' && deployment?.meta !== null ? deployment.meta : undefined;
  const branch = getBranchFromMeta(meta);
  if (!branch) return null;

  const eventAtMs = Number(envelope?.createdAt);
  // `payload.url` is the same deployment host in envelopes that omit
  // `payload.deployment.url` — the CI Control receiver reads both for the same
  // reason (see ciControl/webhooks.ts). This URL is what
  // persistedStatusIsForDeployment matches on, so losing it downgrades failure
  // attribution to the commit SHA, which cannot separate same-SHA siblings.
  const rawUrl = asString(deployment?.url) || asString(envelope?.payload?.url);

  return {
    branch,
    next: {
      branch,
      commitSha: asString(meta?.githubCommitSha) || asString(meta?.gitlabCommitSha) || asString(meta?.bitbucketCommitSha),
      deploymentId: asString(deployment?.id) || asString(deployment?.uid),
      deploymentUrl: rawUrl ? (rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`) : undefined,
      // The webhook envelope carries the inspector page at `payload.links.deployment`.
      // `deployment.inspectorUrl` is a REST API field that webhook deliveries do
      // NOT include, so reading only that left buildPageUrl empty for every
      // webhook-fed status and dropped the footer's build link back to the
      // project-wide dashboard. Kept as a fallback for REST-shaped fixtures.
      inspectorUrl: asString(envelope?.payload?.links?.deployment) || asString(deployment?.inspectorUrl),
      environment: asString(envelope?.payload?.target) || undefined,
      error: state === 'error' ? asString(envelope?.payload?.errorMessage) || 'Deployment failed' : undefined,
      eventAt: Number.isFinite(eventAtMs) && eventAtMs > 0 ? new Date(eventAtMs).toISOString() : new Date().toISOString(),
      eventType,
      state
    }
  };
};

const loadDoc = async () => (await getSettingsCollection()).findOne({ key: SETTINGS_KEY });

// Out-of-order guard, kept pure so it is testable without a Mongo stand-in.
//
// An event for a DIFFERENT deployment is ignored when it is older than what we
// already hold (late delivery for a superseded build). For the SAME deployment,
// a terminal state always beats 'building'.
//
// That last rule must NOT be conditioned on the timestamp:
// parseVercelWebhookEvent falls back to `now` whenever an envelope carries no
// usable numeric createdAt, so a late-delivered deployment.created dates itself
// NEWER than the ready event it actually follows — and would then clobber a
// ready deployment back to 'building'. Decide on state first, clocks only as
// the tiebreaker.
export const shouldReplaceBranchStatus = (
  existing: Pick<VercelWebhookBranchStatus, 'deploymentId' | 'eventAt' | 'state'> | undefined,
  next: Pick<VercelWebhookBranchStatus, 'deploymentId' | 'eventAt' | 'state'>
): boolean => {
  if (!existing) return true;
  const older = Date.parse(next.eventAt) < Date.parse(existing.eventAt);
  const sameDeployment = Boolean(existing.deploymentId) && existing.deploymentId === next.deploymentId;
  if (!sameDeployment) return !older;

  const nextIsBuilding = next.state === 'building';
  const existingIsBuilding = existing.state === 'building';
  if (existingIsBuilding !== nextIsBuilding) return existingIsBuilding;
  return !older;
};

// Does a persisted entry describe the deployment that is serving THIS request?
//
// The store holds exactly one entry per branch, but a branch legitimately has
// several concurrent deployments: Thingtime builds one head SHA into both the
// generic Preview environment and the `develop` Custom Environment (see
// VERCEL_DEPLOYMENTS.md, "Develop-target PR previews"). Those siblings share
// this slot, so the last event to arrive wins regardless of which deployment
// the caller is running on.
//
// VERCEL_URL is unique per deployment, so it is the only signal that separates
// same-SHA siblings — prefer it, and fall back to the commit SHA only when a
// URL is missing on either side. Unknown on both counts is not identity.
export const persistedStatusIsForDeployment = (
  persisted: Pick<VercelWebhookBranchStatus, 'commitSha' | 'deploymentUrl'> | null | undefined,
  running: { commitSha?: string; deploymentUrl?: string }
): boolean => {
  if (!persisted) return false;
  if (running.deploymentUrl && persisted.deploymentUrl) return persisted.deploymentUrl === running.deploymentUrl;
  if (running.commitSha && persisted.commitSha) return persisted.commitSha === running.commitSha;
  return false;
};

// Persist one event, subject to the guard above.
export const recordVercelWebhookEvent = async (envelope: any): Promise<VercelWebhookBranchStatus | null> => {
  const parsed = parseVercelWebhookEvent(envelope);
  if (!parsed) return null;

  const { branch, next } = parsed;
  const doc = await loadDoc();
  const branches: Record<string, VercelWebhookBranchStatus> =
    doc?.branches && typeof doc.branches === 'object' ? { ...doc.branches } : {};
  const existing = branches[branch];

  if (existing && !shouldReplaceBranchStatus(existing, next)) return existing;

  const entry: VercelWebhookBranchStatus = {
    ...next,
    recordedAt: new Date().toISOString(),
    lastReadyAt: next.state === 'ready' ? next.eventAt : existing?.lastReadyAt,
    lastReadyUrl: next.state === 'ready' ? next.deploymentUrl : existing?.lastReadyUrl
  };
  branches[branch] = entry;

  // cap tracked branches so preview-branch churn can't grow the doc unbounded
  const keep = Object.values(branches)
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))
    .slice(0, MAX_TRACKED_BRANCHES);
  const capped: Record<string, VercelWebhookBranchStatus> = {};
  for (const item of keep) capped[item.branch] = item;

  await (await getSettingsCollection()).updateOne(
    { key: SETTINGS_KEY },
    { $set: { key: SETTINGS_KEY, branches: capped, updatedAt: new Date() } },
    { upsert: true }
  );

  return entry;
};

export const getPersistedBranchStatus = async (branch?: string): Promise<VercelWebhookBranchStatus | null> => {
  if (!branch) return null;
  try {
    const doc = await loadDoc();
    const entry = doc?.branches?.[branch];
    return entry && typeof entry === 'object' ? (entry as VercelWebhookBranchStatus) : null;
  } catch {
    // status is advisory — a store hiccup must never break the status endpoint
    return null;
  }
};
