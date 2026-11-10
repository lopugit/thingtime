export type CiEntity = {
  id: string;
  kind: string;
  parentId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  provider?: string;
  repository?: string;
  externalId?: string;
  title?: string;
  status?: string;
  url?: string | null;
  sourceUpdatedAt?: string | null;
  [key: string]: unknown;
};

export type CiEvent = CiEntity & {
  deliveryId?: string;
  eventType?: string;
  action?: string | null;
  actor?: string | null;
  statusFrom?: string | null;
  statusTo?: string | null;
  occurredAt?: string | null;
};

export type CiPreviewPolicy = {
  id: string;
  prNumber: number;
  repository: string;
  develop: boolean;
  production: boolean;
  headSha: string | null;
  headRef: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type CiDashboard = {
  repositories: CiEntity[];
  automations: CiAutomationPolicy[];
  features: CiEntity[];
  branches: CiEntity[];
  pullRequests: CiEntity[];
  workflowRuns: CiEntity[];
  deployments: CiEntity[];
  previews: CiEntity[];
  previewPolicies: CiPreviewPolicy[];
  dispatches: CiEntity[];
  events: CiEvent[];
  stats: {
    openPullRequests: number;
    conflicting: number;
    activeRuns: number;
    readyPreviews: number;
  };
  freshness: {
    latestEventAt: string | null;
    stale: boolean;
  };
};

export type CiExecutionProvider = 'github-actions' | 'vercel-sandbox';

export type CiAutomationPolicy = {
  key: CiWorkflowKey;
  title: string;
  summary: string;
  defaultProvider: CiExecutionProvider;
  executionProvider: CiExecutionProvider;
  enabled: boolean;
  vercelSupported: boolean;
  sourceUpdatedAt: string | null;
  updatedBy: string | null;
};

export type CiIntegration = {
  repository: string;
  controlPlaneRef: string;
  githubAppConfigured: boolean;
  githubWebhookConfigured: boolean;
  vercelWebhookConfigured: boolean;
  vercelRunnerConfigured: boolean;
  providerRouterConfigured: boolean;
  vercelRunnerReady: boolean;
  vercelRunnerMissing: string[];
  previewBuilderConfigured: boolean;
  previewBuilderMissing: string[];
};

export type CiControlResponse = {
  ok: true;
  dashboard: CiDashboard;
  integration: CiIntegration;
};

export type CiWorkflowKey =
  | 'feature-stack'
  | 'resolve-conflicts'
  | 'rebase-stack'
  | 'promote-features'
  | 'promote-develop'
  | 'sync-main'
  | 'web-ci'
  | 'electron-release';
