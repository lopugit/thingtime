export const CI_PREVIEW_ENVIRONMENTS = ['develop', 'production'] as const;

export type CiPreviewEnvironment = (typeof CI_PREVIEW_ENVIRONMENTS)[number];

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

export const isCiPreviewEnvironment = (value: unknown): value is CiPreviewEnvironment =>
  value === 'develop' || value === 'production';

export const previewEnvironmentEnabled = (policy: Pick<CiPreviewPolicy, 'develop' | 'production'>, environment: CiPreviewEnvironment) =>
  policy[environment] === true;

// The Vercel create-deployment body for ONE admin PR preview (POST
// /v13/deployments). Vercel builds the pull request head from its own GitHub
// source, so nothing here trusts a client-supplied artifact. Every deployment
// carries the thingtime markers the ownership fence reads back
// (adminPreviewDeployments.ts `ownedDeployment`): a deployment Thingtime did
// not create can never match, so this path never aliases, refreshes, or
// deletes someone else's preview. develop previews land in the develop custom
// environment; production previews target production.
export const adminPreviewDeploymentPayload = (input: {
  environment: CiPreviewEnvironment;
  projectId: string;
  projectName: string;
  gitRepoId: number;
  repositoryId: number;
  repository: string;
  prNumber: number;
  headRef: string;
  headSha: string;
  developEnvironmentId?: string;
}) => {
  const [githubCommitOrg, githubCommitRepo] = input.repository.split('/');
  if (input.environment === 'develop' && !input.developEnvironmentId) {
    throw new Error('Develop previews need a Vercel custom environment id');
  }
  return {
    name: input.projectName,
    project: input.projectId,
    ...(input.environment === 'production'
      ? { target: 'production' }
      : { customEnvironmentId: input.developEnvironmentId }),
    gitSource: {
      type: 'github',
      repoId: input.gitRepoId,
      ref: input.headRef,
      sha: input.headSha,
      prId: input.prNumber
    },
    meta: {
      githubDeployment: '1',
      githubCommitOrg,
      githubCommitRepo,
      githubCommitRef: input.headRef,
      githubCommitSha: input.headSha,
      githubPrId: String(input.prNumber),
      githubRepoId: String(input.gitRepoId),
      githubRepositoryId: String(input.repositoryId),
      thingtimeAdminPrPreview: '1',
      thingtimePreviewEnvironment: input.environment
    }
  };
};
