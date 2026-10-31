type DeploymentStatusEnvironment = {
  NODE_ENV?: string;
  THINGTIME_SHOW_DEPLOYMENT_STATUS?: string;
  VERCEL_ENV?: string;
  VERCEL_TARGET_ENV?: string;
};

const isVisibleVercelEnvironment = (value?: string) =>
  value === 'preview' || value === 'production';

export const isVercelStatusEnabled = (
  environment: DeploymentStatusEnvironment = process.env
) =>
  environment.NODE_ENV === 'development' ||
  isVisibleVercelEnvironment(environment.VERCEL_ENV) ||
  isVisibleVercelEnvironment(environment.VERCEL_TARGET_ENV) ||
  environment.THINGTIME_SHOW_DEPLOYMENT_STATUS === 'true';
