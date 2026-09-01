export const CI_WORKFLOW_KEYS = [
  'feature-stack',
  'resolve-conflicts',
  'rebase-stack',
  'promote-features',
  'promote-develop',
  'sync-main',
  'web-ci',
  'electron-release'
] as const;

export type CiWorkflowKey = (typeof CI_WORKFLOW_KEYS)[number];
export type CiExecutionProvider = 'github-actions' | 'vercel-sandbox';

export type CiAutomationDefinition = {
  key: CiWorkflowKey;
  title: string;
  summary: string;
  defaultProvider: CiExecutionProvider;
  vercelSupported: boolean;
};

export type CiAutomationPolicy = CiAutomationDefinition & {
  executionProvider: CiExecutionProvider;
  enabled: boolean;
  sourceUpdatedAt: string | null;
  updatedBy: string | null;
};

export const CI_AUTOMATION_DEFINITIONS: readonly CiAutomationDefinition[] = [
  {
    key: 'feature-stack',
    title: 'Merge Feature Stack',
    summary: 'Combine an ordered set of feature PRs into one or more target branches with verified AI conflict resolution.',
    defaultProvider: 'github-actions',
    vercelSupported: false
  },
  {
    key: 'resolve-conflicts',
    title: 'Resolve PR conflicts',
    summary: 'Detect conflicts, merge the base, use the configured Claude waterfall when needed, verify, and push.',
    defaultProvider: 'github-actions',
    vercelSupported: true
  },
  {
    key: 'rebase-stack',
    title: 'Rebase PR or stack',
    summary: 'Rebase true stacked pull requests while preserving ownership and exact-lease safety.',
    defaultProvider: 'github-actions',
    vercelSupported: true
  },
  {
    key: 'promote-features',
    title: 'Promote features to main',
    summary: 'Create or update per-feature promotion pull requests from merged develop work.',
    defaultProvider: 'github-actions',
    vercelSupported: true
  },
  {
    key: 'promote-develop',
    title: 'Refresh develop to main promotion',
    summary: 'Maintain the omnibus develop to main promotion pull request.',
    defaultProvider: 'github-actions',
    vercelSupported: true
  },
  {
    key: 'sync-main',
    title: 'Sync main into develop',
    summary: 'Merge released main history back into the develop integration branch.',
    defaultProvider: 'github-actions',
    vercelSupported: true
  },
  {
    key: 'web-ci',
    title: 'Run web CI',
    summary: 'Build, typecheck, and test the Thingtime web application.',
    defaultProvider: 'github-actions',
    // The API job currently starts a sibling Docker MongoDB service. Nested
    // Docker is not a supported Vercel Sandbox contract, so keep this option
    // fail-closed until Web CI has a service-backed test database.
    vercelSupported: false
  },
  {
    key: 'electron-release',
    title: 'Build Electron release',
    summary: 'Build platform-specific Electron release artifacts.',
    defaultProvider: 'github-actions',
    vercelSupported: false
  }
] as const;

const byKey = new Map(CI_AUTOMATION_DEFINITIONS.map((definition) => [definition.key, definition]));

export const isCiWorkflowKey = (value: unknown): value is CiWorkflowKey =>
  typeof value === 'string' && byKey.has(value as CiWorkflowKey);

export const isCiExecutionProvider = (value: unknown): value is CiExecutionProvider =>
  value === 'github-actions' || value === 'vercel-sandbox';

export const ciAutomationDefinition = (workflow: CiWorkflowKey): CiAutomationDefinition => {
  const definition = byKey.get(workflow);
  if (!definition) throw new Error('Unsupported CI workflow');
  return definition;
};

export const defaultCiAutomationPolicy = (workflow: CiWorkflowKey): CiAutomationPolicy => {
  const definition = ciAutomationDefinition(workflow);
  return {
    ...definition,
    executionProvider: definition.defaultProvider,
    enabled: true,
    sourceUpdatedAt: null,
    updatedBy: null
  };
};
