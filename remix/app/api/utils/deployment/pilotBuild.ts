import { createHash } from 'node:crypto';
import { isDeploymentProfileId } from '../ciControl/deploymentProfilesCore';

export const PILOT_LANES_VERSION = '2.0.0';
export type PilotLane = 'production' | 'development' | 'preview';
export type PilotBuild = { profileId: string; origin: string; lane?: PilotLane; prNumber?: number };
const aliasPattern = /^https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.vercel\.app$/;

/** Stable aliases from one enrolled base. Hash before truncation to avoid collisions. */
export function pilotAliasForLane(baseOrigin: string, lane: PilotLane, prNumber?: number): string {
  const tag = aliasPattern.exec(baseOrigin)?.[1];
  if (!tag || (lane === 'preview' && (!Number.isSafeInteger(prNumber) || prNumber! <= 0)) ||
      (lane !== 'preview' && prNumber !== undefined)) throw new Error('Invalid pilot alias or lane');
  const suffix = lane === 'production' ? '' : lane === 'development' ? '-dev' : `-pr-${prNumber}`;
  if (!suffix) return baseOrigin;
  const prefix = tag.length + suffix.length <= 63 ? tag :
    `${tag.slice(0, 63 - suffix.length - 9).replace(/-+$/, '')}-${createHash('sha256').update(tag).digest('hex').slice(0, 8)}`;
  if (!prefix || prefix.length + suffix.length > 63) throw new Error('Pilot alias is too long');
  return `https://${prefix}${suffix}.vercel.app`;
}

// Replaced only in the server bundle. No credential or database address belongs here.
declare const __THINGTIME_DEPLOYMENT_PILOT__: PilotBuild | null;
export const pilotBuild = (): PilotBuild | null =>
  typeof __THINGTIME_DEPLOYMENT_PILOT__ === 'undefined' ? null : __THINGTIME_DEPLOYMENT_PILOT__;

export function selectPilotBuild(env: Record<string, string | undefined>): PilotBuild | null {
  const profileId = env.THINGTIME_PILOT_PROFILE_ID;
  const origin = env.THINGTIME_PILOT_ORIGIN;
  const lane = env.THINGTIME_PILOT_LANE;
  const pr = env.THINGTIME_PILOT_PR_NUMBER;
  const alias = env.THINGTIME_PILOT_ALIAS;
  if (profileId === undefined && origin === undefined && lane === undefined && pr === undefined && alias === undefined) return null;
  if (!isDeploymentProfileId(profileId) || profileId === 'legacy' || !origin ||
      !aliasPattern.test(origin)) {
    throw new Error('Invalid parallel deployment profile or test origin');
  }
  if (lane === undefined) {
    if (pr !== undefined || alias !== undefined) throw new Error('Legacy pilot cannot select a lane');
    return { profileId, origin };
  }
  if (lane !== 'production' && lane !== 'development' && lane !== 'preview') throw new Error('Invalid pilot lane');
  const target = lane === 'production' ? 'production' : 'preview';
  for (const value of [env.VERCEL_ENV, env.VERCEL_TARGET_ENV]) {
    if (value !== undefined && value !== target) throw new Error('Pilot lane and Vercel environment disagree');
  }
  const prNumber = pr === undefined ? undefined : Number(pr);
  if (pr !== undefined && (!/^[1-9][0-9]*$/.test(pr) || !Number.isSafeInteger(prNumber))) throw new Error('Invalid pilot PR');
  if (!alias || pilotAliasForLane(alias, lane, prNumber) !== origin) throw new Error('Pilot alias does not match lane');
  return { profileId, origin, lane, ...(prNumber === undefined ? {} : { prNumber }) };
}
