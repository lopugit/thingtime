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
