import { createHmac, timingSafeEqual } from 'node:crypto';

import { ensureIndexes, getSettingsCollection } from '../mongodb/collections';

// Webhook-pushed deployment status (TODO 5): Vercel calls
// POST /api/v1/vercel/webhook on deployment lifecycle events, we persist the
// latest event per branch in the `settings` collection (singleton docs keyed
// by `key`), and getVercelDeploymentStatus serves that instead of spending
// Vercel API calls polling for a build that isn't happening. Polling remains
// the fallback while no webhook has ever been received (webhook not yet
// configured) and the progress source while a build is actively running.

export type VercelWebhookState = 'queued' | 'ready' | 'error' | 'canceled';

export type VercelWebhookDeploymentStatus = {
  branch?: string;
  commitSha?: string;
  deploymentId?: string;
  environment?: string;
  // Vercel's event timestamp (ms) — used to drop out-of-order deliveries.
  eventAt: number;
  eventType: string;
  inspectorUrl?: string;
  receivedAt: string;
  state: VercelWebhookState;
  url?: string;
};

const SETTINGS_KEY_PREFIX = 'vercelWebhookStatus';

// Non-terminal states go stale: if the 'ready'/'error' delivery for a build
// was lost, a forever-'queued' doc must not pin the footer — fall back to
// polling once the event is old enough that the build has certainly settled.
const NON_TERMINAL_STALE_MS = 30 * 60 * 1000;

const EVENT_STATE_MAP: Record<string, VercelWebhookState> = {
  'deployment.created': 'queued',
  'deployment.succeeded': 'ready',
  'deployment.ready': 'ready',
  'deployment.promoted': 'ready',
  'deployment.error': 'error',
  'deployment.canceled': 'canceled'
};

export const isVercelWebhookEnabled = () => Boolean(process.env.VERCEL_WEBHOOK_SECRET?.trim());

// Vercel signs the raw request body with the webhook secret (HMAC-SHA1 hex in
// the x-vercel-signature header).
export const verifyVercelWebhookSignature = (rawBody: string, signature: string | null): boolean => {
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

const getString = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

const settingsKeyForBranch = (branch?: string) =>
  branch ? `${SETTINGS_KEY_PREFIX}:branch:${branch}` : `${SETTINGS_KEY_PREFIX}:unknown-branch`;

export const normaliseVercelWebhookEvent = (payload: any): VercelWebhookDeploymentStatus | null => {
  const eventType = getString(payload?.type);
  if (!eventType) return null;

  const state = EVENT_STATE_MAP[eventType];
  if (!state) return null; // not a deployment lifecycle event we track — ignore

  const deployment = payload?.payload?.deployment ?? {};
  const meta = deployment?.meta ?? {};
  const rawUrl = getString(deployment?.url);
  const eventAt = typeof payload?.createdAt === 'number' ? payload.createdAt : Date.now();

  return {
    branch: getString(meta?.githubCommitRef) || getString(meta?.gitlabCommitRef) || getString(meta?.bitbucketCommitRef),
    commitSha: getString(meta?.githubCommitSha) || getString(meta?.gitlabCommitSha) || getString(meta?.bitbucketCommitSha),
    deploymentId: getString(deployment?.id),
    environment: getString(payload?.payload?.target) || undefined,
    eventAt,
    eventType,
    inspectorUrl: getString(deployment?.inspectorUrl) || getString(payload?.payload?.links?.deployment),
    receivedAt: new Date().toISOString(),
    state,
    url: rawUrl ? (rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`) : undefined
  };
};

export const recordVercelWebhookEvent = async (
  payload: any
): Promise<{ recorded: boolean; eventType?: string; state?: VercelWebhookState }> => {
  const status = normaliseVercelWebhookEvent(payload);
  if (!status) return { recorded: false, eventType: getString(payload?.type) };

  await ensureIndexes();
  const settings = await getSettingsCollection();
  const key = settingsKeyForBranch(status.branch);

  try {
    // Deliveries can arrive out of order (retries, parallel lambdas): only let
    // an event through if nothing newer is already stored. When the filter
    // misses because a newer doc exists, the upsert insert collides with the
    // unique `key` index — that duplicate-key error IS the stale-event branch.
    await settings.updateOne(
      { key, $or: [{ eventAt: { $exists: false } }, { eventAt: { $lte: status.eventAt } }] },
      { $set: { ...status, key } },
      { upsert: true }
    );
  } catch (err: any) {
    if (err?.code !== 11000) throw err;
    return { recorded: false, eventType: status.eventType, state: status.state };
  }

  return { recorded: true, eventType: status.eventType, state: status.state };
};

export const getVercelWebhookStatusForBranch = async (
  branch?: string
): Promise<VercelWebhookDeploymentStatus | null> => {
  if (!branch) return null;

  const settings = await getSettingsCollection();
  const doc = await settings.findOne({ key: settingsKeyForBranch(branch) });
  if (!doc?.state || typeof doc.eventAt !== 'number') return null;

  const isTerminal = doc.state === 'ready' || doc.state === 'error' || doc.state === 'canceled';
  if (!isTerminal && Date.now() - doc.eventAt > NON_TERMINAL_STALE_MS) return null;

  const { _id, key, ...status } = doc;
  return status as VercelWebhookDeploymentStatus;
};
