import { isDeploymentProfileId } from '../ciControl/deploymentProfilesCore';

export type PilotBuild = { profileId: string; origin: string };

// Replaced only in the server bundle. No credential or database address belongs here.
declare const __THINGTIME_DEPLOYMENT_PILOT__: PilotBuild | null;
export const pilotBuild = (): PilotBuild | null =>
  typeof __THINGTIME_DEPLOYMENT_PILOT__ === 'undefined' ? null : __THINGTIME_DEPLOYMENT_PILOT__;

export function selectPilotBuild(env: Record<string, string | undefined>): PilotBuild | null {
  const profileId = env.THINGTIME_PILOT_PROFILE_ID;
  const origin = env.THINGTIME_PILOT_ORIGIN;
  if (profileId === undefined && origin === undefined) return null;
  if (!isDeploymentProfileId(profileId) || profileId === 'legacy' || !origin ||
      !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/.test(origin)) {
    throw new Error('Invalid parallel deployment profile or test origin');
  }
  return { profileId, origin };
}
