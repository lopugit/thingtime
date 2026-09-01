import { createHash } from 'node:crypto';

import { getHomeThingsCollection } from '../mongodb/collections';
import {
  CI_AUTOMATION_DEFINITIONS,
  ciAutomationDefinition,
  defaultCiAutomationPolicy,
  isCiExecutionProvider,
  type CiAutomationPolicy,
  type CiExecutionProvider,
  type CiWorkflowKey
} from './automationPolicy';
import type { CiPreviewEnvironment, CiPreviewPolicy } from './previewPolicyCore';
import {
  CI_DASHBOARD_UPDATED_SORT,
  ciDashboardFieldFilter,
  ciDashboardKindFilter,
  ciDashboardReadLimit
} from './dashboardQueryCore';
import { CI_CONTROL_THINGTIME, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';

export const CI_THINGTIME = CI_CONTROL_THINGTIME;

export type CiThingtime = (typeof CI_THINGTIME)[number];
export type CiProvider = 'github' | 'vercel' | 'thingtime';

export type CiEntityInput = {
  kind: Exclude<CiThingtime, 'ci-event'>;
  provider: CiProvider;
  repository: string;
  externalId: string;
  title: string;
  status: string;
  url?: string | null;
  parentId?: string | null;
  occurredAt?: string | Date | null;
  data?: Record<string, unknown>;
};

export type CiEventInput = {
  provider: CiProvider;
  repository: string;
  deliveryId: string;
  eventType: string;
  action?: string | null;
  parentId?: string | null;
  actor?: string | null;
  statusFrom?: string | null;
  statusTo?: string | null;
  occurredAt?: string | Date | null;
  data?: Record<string, unknown>;
};

const boundedText = (value: unknown, max = 500): string => {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
};

const dateFrom = (value: unknown, fallback = new Date()): Date => {
  const parsed = value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : fallback;
};

const stableShareId = (key: string): string =>
  `ci-${createHash('sha256').update(key).digest('hex').slice(0, 48)}`;

export const ciEntityKey = (input: Pick<CiEntityInput, 'provider' | 'repository' | 'kind' | 'externalId'>): string =>
  [input.provider, input.repository, input.kind, input.externalId].map((part) => boundedText(part, 300)).join(':');

const publicCrystal = (doc: any) => {
  const crystal = doc?.crystal && typeof doc.crystal === 'object' ? doc.crystal : {};
  return {
    id: String(doc?.shareId ?? ''),
    kind: String(Array.isArray(doc?.thingtime) ? doc.thingtime[0] ?? '' : doc?.thingtime ?? ''),
    parentId: typeof doc?.parentId === 'string' ? doc.parentId : null,
    createdAt: doc?.createdAt instanceof Date ? doc.createdAt.toISOString() : doc?.createdAt ?? null,
    updatedAt: doc?.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc?.updatedAt ?? null,
    ...crystal,
    sourceUpdatedAt:
      crystal.sourceUpdatedAt instanceof Date
        ? crystal.sourceUpdatedAt.toISOString()
        : crystal.sourceUpdatedAt ?? null
  };
};

export const recordCiEvent = async (input: CiEventInput): Promise<{ id: string; inserted: boolean }> => {
  const things = await getHomeThingsCollection();
  const eventKey = [
    input.provider,
    input.repository,
    'ci-event',
    boundedText(input.deliveryId, 300),
    boundedText(input.parentId ?? 'repository', 180)
  ].join(':');
  const shareId = stableShareId(eventKey);
  const occurredAt = dateFrom(input.occurredAt);
  const now = new Date();
  try {
    const result = await things.updateOne(
      { shareId, thingtime: 'ci-event' },
      {
        $setOnInsert: {
          schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
          shareId,
          thingtime: ['ci-event'],
          crystal: {
            provider: input.provider,
            repository: boundedText(input.repository, 300),
            deliveryId: boundedText(input.deliveryId, 300),
            eventType: boundedText(input.eventType, 120),
            action: boundedText(input.action, 120) || null,
            actor: boundedText(input.actor, 180) || null,
            statusFrom: boundedText(input.statusFrom, 120) || null,
            statusTo: boundedText(input.statusTo, 120) || null,
            occurredAt,
            data: input.data ?? {}
          },
          ownerId: 'system',
          acl: [],
          storageClass: 'control',
          parentId: input.parentId ?? null,
          targetId: null,
          tags: [],
          createdAt: now,
          updatedAt: now
        }
      },
      { upsert: true }
    );
    return { id: shareId, inserted: result.upsertedCount > 0 };
  } catch (error: any) {
    if (error?.code === 11000) return { id: shareId, inserted: false };
    throw error;
  }
};

export const upsertCiEntity = async (
  input: CiEntityInput,
  event?: Omit<CiEventInput, 'parentId' | 'statusFrom' | 'statusTo'>
): Promise<{ id: string; changed: boolean; ignoredAsOlder: boolean }> => {
  const things = await getHomeThingsCollection();
  const entityKey = ciEntityKey(input);
  const shareId = stableShareId(entityKey);
  const occurredAt = dateFrom(input.occurredAt);
  const now = new Date();
  const current = await things.findOne(
    { shareId, thingtime: input.kind },
    { projection: { 'crystal.status': 1, 'crystal.sourceUpdatedAt': 1 } }
  );
  const currentUpdatedAt = dateFrom(current?.crystal?.sourceUpdatedAt, new Date(0));
  let ignoredAsOlder = !!current && currentUpdatedAt.getTime() > occurredAt.getTime();
  const previousStatus = boundedText(current?.crystal?.status, 120) || null;
  const nextStatus = boundedText(input.status, 120) || 'unknown';

  if (!ignoredAsOlder) {
    const filter = current
      ? {
          shareId,
          thingtime: input.kind,
          $or: [
            { 'crystal.sourceUpdatedAt': { $lte: occurredAt } },
            { 'crystal.sourceUpdatedAt': { $exists: false } }
          ]
        }
      : { shareId, thingtime: input.kind };
    const update = {
      $set: {
        crystal: {
          ...(input.data ?? {}),
          provider: input.provider,
          repository: boundedText(input.repository, 300),
          externalId: boundedText(input.externalId, 300),
          entityKey,
          title: boundedText(input.title, 500),
          status: nextStatus,
          url: boundedText(input.url, 1500) || null,
          sourceUpdatedAt: occurredAt
        },
        parentId: input.parentId ?? null,
        updatedAt: now
      },
      $setOnInsert: {
        schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
        shareId,
        thingtime: [input.kind],
        ownerId: 'system',
        acl: [],
        storageClass: 'control',
        targetId: null,
        tags: [],
        createdAt: now
      }
    };
    try {
      const result = await things.updateOne(filter, update, { upsert: !current });
      ignoredAsOlder = result.matchedCount === 0 && result.upsertedCount === 0;
    } catch (error: any) {
      if (error?.code !== 11000 || current) throw error;
      // Another delivery inserted the deterministic entity between the read
      // and upsert. Retry as an update with the provider-time guard so an
      // older event can never win that race.
      const result = await things.updateOne(
        {
          shareId,
          thingtime: input.kind,
          $or: [
            { 'crystal.sourceUpdatedAt': { $lte: occurredAt } },
            { 'crystal.sourceUpdatedAt': { $exists: false } }
          ]
        },
        update,
        { upsert: false }
      );
      ignoredAsOlder = result.matchedCount === 0;
    }
  }

  if (event) {
    await recordCiEvent({
      ...event,
      parentId: shareId,
      statusFrom: previousStatus,
      statusTo: ignoredAsOlder ? previousStatus : nextStatus,
      data: { ...(event.data ?? {}), ignoredAsOlder }
    });
  }

  return {
    id: shareId,
    changed: !ignoredAsOlder && previousStatus !== nextStatus,
    ignoredAsOlder
  };
};

export const listCiPreviewPolicies = async (repository: string): Promise<CiPreviewPolicy[]> => {
  const rows = await readKind('ci-preview-policy', 500, repository);
  return rows
    .filter((row: any) => row.repository === repository)
    .map((row: any) => ({
      id: String(row.id),
      prNumber: Number(row.prNumber),
      repository: String(row.repository),
      develop: row.develop === true,
      production: row.production === true,
      headSha: typeof row.headSha === 'string' ? row.headSha : null,
      headRef: typeof row.headRef === 'string' ? row.headRef : null,
      updatedAt: typeof row.sourceUpdatedAt === 'string' ? row.sourceUpdatedAt : null,
      updatedBy: typeof row.updatedBy === 'string' ? row.updatedBy : null
    }))
    .filter((row) => Number.isSafeInteger(row.prNumber) && row.prNumber > 0);
};

export const setCiPreviewPolicy = async (input: {
  repository: string;
  prNumber: number;
  environment: CiPreviewEnvironment;
  enabled: boolean;
  headSha: string;
  headRef: string;
  actorId: string;
}): Promise<CiPreviewPolicy> => {
  const current = (await listCiPreviewPolicies(input.repository)).find((policy) => policy.prNumber === input.prNumber);
  const develop = input.environment === 'develop' ? input.enabled : current?.develop === true;
  const production = input.environment === 'production' ? input.enabled : current?.production === true;
  const occurredAt = new Date();
  const entity = await upsertCiEntity({
    kind: 'ci-preview-policy',
    provider: 'thingtime',
    repository: input.repository,
    externalId: String(input.prNumber),
    title: `PR #${input.prNumber} preview environments`,
    status: develop || production ? 'enabled' : 'disabled',
    occurredAt,
    data: {
      prNumber: input.prNumber,
      develop,
      production,
      headSha: input.headSha,
      headRef: input.headRef,
      updatedBy: boundedText(input.actorId, 180)
    }
  });
  return {
    id: entity.id,
    prNumber: input.prNumber,
    repository: input.repository,
    develop,
    production,
    headSha: input.headSha,
    headRef: input.headRef,
    updatedAt: occurredAt.toISOString(),
    updatedBy: boundedText(input.actorId, 180)
  };
};

const readKind = async (kind: CiThingtime, limit: number, repository: string) => {
  const things = await getHomeThingsCollection();
  const docs = await things
    .find(ciDashboardKindFilter(kind, repository))
    .sort(CI_DASHBOARD_UPDATED_SORT)
    .limit(limit)
    .toArray();
  return docs.map(publicCrystal);
};

const countCiDashboardStats = async (repository: string) => {
  const things = await getHomeThingsCollection();
  const [openPullRequests, conflicting, activeRuns, readyPreviews] = await Promise.all([
    things.countDocuments(ciDashboardFieldFilter('ci-pull-request', repository, 'state', ['OPEN', 'open'])),
    things.countDocuments(
      ciDashboardFieldFilter('ci-pull-request', repository, 'status', [
        'conflicting',
        'CONFLICTING',
        'dirty',
        'DIRTY',
        'blocked',
        'BLOCKED'
      ])
    ),
    things.countDocuments(
      ciDashboardFieldFilter('ci-workflow-run', repository, 'status', [
        'queued',
        'QUEUED',
        'requested',
        'REQUESTED',
        'waiting',
        'WAITING',
        'in_progress',
        'IN_PROGRESS',
        'pending',
        'PENDING'
      ])
    ),
    things.countDocuments(
      ciDashboardFieldFilter('ci-preview', repository, 'status', [
        'ready',
        'READY',
        'success',
        'SUCCESS',
        'succeeded',
        'SUCCEEDED'
      ])
    )
  ]);
  return { openPullRequests, conflicting, activeRuns, readyPreviews };
};

const policyFromEntity = (workflow: CiWorkflowKey, entity: any | null): CiAutomationPolicy => {
  const fallback = defaultCiAutomationPolicy(workflow);
  if (!entity) return fallback;
  const executionProvider = isCiExecutionProvider(entity.executionProvider)
    ? entity.executionProvider
    : fallback.executionProvider;
  return {
    ...fallback,
    executionProvider,
    enabled: entity.enabled !== false,
    sourceUpdatedAt: typeof entity.sourceUpdatedAt === 'string' ? entity.sourceUpdatedAt : null,
    updatedBy: typeof entity.updatedBy === 'string' ? entity.updatedBy : null
  };
};

export const listCiAutomationPolicies = async (repository: string): Promise<CiAutomationPolicy[]> => {
  const things = await getHomeThingsCollection();
  const docs = await things
    .find({ thingtime: 'ci-automation', 'crystal.repository': boundedText(repository, 300) })
    .limit(CI_AUTOMATION_DEFINITIONS.length)
    .toArray();
  const entities = new Map(
    docs.map((doc) => {
      const entity = publicCrystal(doc);
      return [String(entity.externalId ?? ''), entity];
    })
  );
  return CI_AUTOMATION_DEFINITIONS.map((definition) =>
    policyFromEntity(definition.key, entities.get(definition.key) ?? null)
  );
};

export const getCiAutomationPolicy = async (
  repository: string,
  workflow: CiWorkflowKey
): Promise<CiAutomationPolicy> => {
  const things = await getHomeThingsCollection();
  const doc = await things.findOne({
    thingtime: 'ci-automation',
    'crystal.repository': boundedText(repository, 300),
    'crystal.externalId': workflow
  });
  return policyFromEntity(workflow, doc ? publicCrystal(doc) : null);
};

export const setCiAutomationPolicy = async (input: {
  repository: string;
  workflow: CiWorkflowKey;
  executionProvider: CiExecutionProvider;
  enabled: boolean;
  actorId: string;
}): Promise<CiAutomationPolicy> => {
  const definition = ciAutomationDefinition(input.workflow);
  if (input.executionProvider === 'vercel-sandbox' && !definition.vercelSupported) {
    throw new Error('This automation requires a GitHub-hosted runner');
  }
  const occurredAt = new Date();
  const entity = await upsertCiEntity(
    {
      kind: 'ci-automation',
      provider: 'thingtime',
      repository: input.repository,
      externalId: input.workflow,
      title: definition.title,
      status: input.enabled ? 'enabled' : 'disabled',
      occurredAt,
      data: {
        workflowKey: input.workflow,
        executionProvider: input.executionProvider,
        enabled: input.enabled,
        vercelSupported: definition.vercelSupported,
        updatedBy: boundedText(input.actorId, 180)
      }
    },
    {
      provider: 'thingtime',
      repository: input.repository,
      deliveryId: `automation-policy:${input.workflow}:${occurredAt.toISOString()}`,
      eventType: 'automation_policy',
      action: 'updated',
      actor: input.actorId,
      occurredAt,
      data: { executionProvider: input.executionProvider, enabled: input.enabled }
    }
  );
  const things = await getHomeThingsCollection();
  const saved = await things.findOne({ shareId: entity.id, thingtime: 'ci-automation' });
  return policyFromEntity(input.workflow, saved ? publicCrystal(saved) : null);
};

export const claimCiDispatchRoute = async (input: {
  repository: string;
  workflow: CiWorkflowKey;
  deliveryKey: string;
  actorId: string;
  occurredAt: Date;
}): Promise<{ id: string; externalId: string; claimed: boolean; status: string }> => {
  const things = await getHomeThingsCollection();
  const externalId = `automatic:${input.workflow}:${boundedText(input.deliveryKey, 300)}`;
  const shareId = stableShareId(
    ciEntityKey({ provider: 'thingtime', repository: input.repository, kind: 'ci-dispatch', externalId })
  );
  const now = new Date();
  const result = await things.updateOne(
    { shareId, thingtime: 'ci-dispatch' },
    {
      $setOnInsert: {
        schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
        shareId,
        thingtime: ['ci-dispatch'],
        crystal: {
          provider: 'thingtime',
          repository: boundedText(input.repository, 300),
          externalId,
          entityKey: ciEntityKey({
            provider: 'thingtime',
            repository: input.repository,
            kind: 'ci-dispatch',
            externalId
          }),
          title: `Automatic dispatch ${input.workflow}`,
          status: 'routing',
          url: null,
          sourceUpdatedAt: input.occurredAt,
          workflow: input.workflow,
          actorId: boundedText(input.actorId, 180),
          deliveryKey: boundedText(input.deliveryKey, 300)
        },
        ownerId: 'system',
        acl: [],
        storageClass: 'control',
        parentId: null,
        targetId: null,
        tags: [],
        createdAt: now,
        updatedAt: now
      }
    },
    { upsert: true }
  );
  if (result.upsertedCount > 0) return { id: shareId, externalId, claimed: true, status: 'routing' };
  const existing = await things.findOne(
    { shareId, thingtime: 'ci-dispatch' },
    { projection: { 'crystal.status': 1 } }
  );
  return {
    id: shareId,
    externalId,
    claimed: false,
    status: boundedText(existing?.crystal?.status, 120) || 'unknown'
  };
};

export const listCiDashboard = async (options?: { limit?: number; eventLimit?: number; repository?: string }) => {
  const requestedLimit = Math.floor(options?.limit ?? 100);
  const eventLimit = Math.min(500, Math.max(1, Math.floor(options?.eventLimit ?? 200)));
  const repository = boundedText(options?.repository ?? process.env.THINGTIME_GITHUB_REPOSITORY ?? 'lopugit/thingtime', 300);
  const [repositories, automations, features, branches, pullRequests, workflowRuns, deployments, previews, previewPolicies, dispatches, events, stats] =
    await Promise.all([
      readKind('ci-repository', 20, repository),
      listCiAutomationPolicies(repository),
      readKind('ci-feature', ciDashboardReadLimit('ci-feature', requestedLimit), repository),
      readKind('ci-branch', ciDashboardReadLimit('ci-branch', requestedLimit), repository),
      readKind('ci-pull-request', ciDashboardReadLimit('ci-pull-request', requestedLimit), repository),
      readKind('ci-workflow-run', ciDashboardReadLimit('ci-workflow-run', requestedLimit), repository),
      readKind('ci-deployment', ciDashboardReadLimit('ci-deployment', requestedLimit), repository),
      readKind('ci-preview', ciDashboardReadLimit('ci-preview', requestedLimit), repository),
      listCiPreviewPolicies(repository),
      readKind('ci-dispatch', ciDashboardReadLimit('ci-dispatch', requestedLimit), repository),
      readKind('ci-event', eventLimit, repository),
      countCiDashboardStats(repository)
    ]);
  const latest = events[0]?.occurredAt ?? events[0]?.updatedAt ?? null;
  return {
    repositories,
    automations,
    features,
    branches,
    pullRequests,
    workflowRuns,
    deployments,
    previews,
    previewPolicies,
    dispatches,
    events,
    stats,
    freshness: {
      latestEventAt: latest,
      stale: !latest || Date.now() - new Date(latest).getTime() > 15 * 60 * 1000
    }
  };
};

export const listCiEventsForParents = async (
  parentIds: string[],
  options?: { perParentLimit?: number; repository?: string }
) => {
  const repository = boundedText(options?.repository ?? process.env.THINGTIME_GITHUB_REPOSITORY ?? 'lopugit/thingtime', 300);
  const perParentLimit = Math.min(50, Math.max(1, Math.floor(options?.perParentLimit ?? 20)));
  const ids = [...new Set(parentIds.map((value) => boundedText(value, 180)).filter(Boolean))].slice(0, 50);
  if (!ids.length) return [];
  const things = await getHomeThingsCollection();
  const groups = await Promise.all(
    ids.map((parentId) =>
      things
        .find({ thingtime: 'ci-event', parentId, 'crystal.repository': repository })
        .sort({ createdAt: -1, shareId: 1 })
        .limit(perParentLimit)
        .toArray()
    )
  );
  return groups
    .flat()
    .map(publicCrystal)
    .sort((left, right) => new Date(right.occurredAt ?? right.createdAt ?? 0).getTime() - new Date(left.occurredAt ?? left.createdAt ?? 0).getTime());
};

export const clearCiControlForTests = async () => {
  if (process.env.NODE_ENV !== 'test') throw new Error('CI control data can only be cleared in tests');
  const things = await getHomeThingsCollection();
  await things.deleteMany({ thingtime: { $in: [...CI_THINGTIME] } });
};
