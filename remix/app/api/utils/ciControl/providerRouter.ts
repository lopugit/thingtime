import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  isCiWorkflowKey,
  type CiWorkflowKey
} from './automationPolicy';
import {
  dispatchCiWorkflow,
  githubAppConfigured,
  repositoryName
} from './githubClient';
import {
  claimCiDispatchRoute,
  getCiAutomationPolicy,
  recordCiEvent
} from './store';

const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;
const MAX_INPUTS = 20;

export type CiProviderRouteRequest = {
  workflow: CiWorkflowKey;
  deliveryKey: string;
  actorId: string;
  requestedAt: Date;
  inputs: Record<string, string | boolean>;
};

const bounded = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const equalText = (left: string, right: string) => {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

export const verifyCiProviderRouteSignature = (rawBody: string, signature: string | null, secret: string) => {
  if (!secret || !signature) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
  return equalText(signature, expected);
};

export const parseCiProviderRouteRequest = (value: unknown, now = Date.now()): CiProviderRouteRequest | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!isCiWorkflowKey(body.workflow)) return null;
  const deliveryKey = bounded(body.deliveryKey, 300);
  const actorId = bounded(body.actorId, 180) || 'github-actions[bot]';
  const requestedAt = new Date(bounded(body.requestedAt, 80));
  if (!deliveryKey || !Number.isFinite(requestedAt.getTime())) return null;
  if (Math.abs(now - requestedAt.getTime()) > MAX_CLOCK_SKEW_MS) return null;
  if (!body.inputs || typeof body.inputs !== 'object' || Array.isArray(body.inputs)) return null;
  const entries = Object.entries(body.inputs as Record<string, unknown>);
  if (entries.length > MAX_INPUTS) return null;
  const inputs: Record<string, string | boolean> = {};
  for (const [key, input] of entries) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) return null;
    if (typeof input === 'boolean') inputs[key] = input;
    else if (typeof input === 'string') inputs[key] = input.slice(0, 300);
    else return null;
  }
  return { workflow: body.workflow, deliveryKey, actorId, requestedAt, inputs };
};

const vercelEnvironmentConfigured = () =>
  githubAppConfigured() &&
  Boolean(
    process.env.VERCEL_OIDC_TOKEN ||
      process.env.VERCEL === '1' ||
      (process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID && process.env.VERCEL_TEAM_ID)
  );

export const routeCiProviderRequest = async (request: CiProviderRouteRequest) => {
  const repository = repositoryName();
  const policy = await getCiAutomationPolicy(repository, request.workflow);
  if (!policy.enabled) {
    return { execute: false as const, executionProvider: policy.executionProvider, disabled: true as const };
  }
  if (policy.executionProvider === 'github-actions') {
    return { execute: true as const, executionProvider: 'github-actions' as const };
  }
  if (!policy.vercelSupported || !vercelEnvironmentConfigured()) {
    await recordCiEvent({
      provider: 'thingtime',
      repository,
      deliveryId: `provider-fallback:${request.deliveryKey}`,
      eventType: 'provider_fallback',
      action: request.workflow,
      actor: request.actorId,
      statusFrom: 'vercel-sandbox',
      statusTo: 'github-actions',
      occurredAt: request.requestedAt,
      data: { reason: policy.vercelSupported ? 'vercel runner not configured' : 'workflow unsupported on Vercel' }
    });
    return {
      execute: true as const,
      executionProvider: 'github-actions' as const,
      fallback: true as const
    };
  }

  const claim = await claimCiDispatchRoute({
    repository,
    workflow: request.workflow,
    deliveryKey: request.deliveryKey,
    actorId: request.actorId,
    occurredAt: request.requestedAt
  });
  if (!claim.claimed) {
    if (claim.status === 'failed') {
      return {
        execute: true as const,
        executionProvider: 'github-actions' as const,
        fallback: true as const,
        duplicate: true as const
      };
    }
    return {
      execute: false as const,
      executionProvider: 'vercel-sandbox' as const,
      duplicate: true as const,
      dispatchId: claim.id
    };
  }

  try {
    const dispatch = await dispatchCiWorkflow({
      workflow: request.workflow,
      inputs: request.inputs,
      actorId: request.actorId,
      externalId: claim.externalId,
      requestedAt: request.requestedAt
    });
    return {
      execute: false as const,
      executionProvider: 'vercel-sandbox' as const,
      dispatchId: dispatch.dispatchId,
      workflowRunId: dispatch.workflowRunId
    };
  } catch {
    // The native GitHub run is already waiting for this response. Falling
    // back preserves automation while the failed Vercel attempt remains
    // visible in the immutable CI event history.
    return {
      execute: true as const,
      executionProvider: 'github-actions' as const,
      fallback: true as const,
      dispatchId: claim.id
    };
  }
};
