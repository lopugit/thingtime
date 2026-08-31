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

export type AdminPreviewDeploymentPayload = {
  name: string;
  project: string;
  autoAssignCustomDomains: false;
  target?: 'production';
  customEnvironmentSlugOrId?: string;
  gitSource: { type: 'github'; repoId: number; ref: string; sha: string };
  meta: Record<string, string>;
};

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
}): AdminPreviewDeploymentPayload => {
  const [githubCommitOrg, githubCommitRepo] = input.repository.split('/');
  return {
    name: input.projectName,
    project: input.projectId,
    autoAssignCustomDomains: false,
    ...(input.environment === 'develop'
      ? { customEnvironmentSlugOrId: input.developEnvironmentId }
      : { target: 'production' as const }),
    gitSource: {
      type: 'github' as const,
      repoId: input.gitRepoId,
      ref: input.headRef,
      sha: input.headSha
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
