import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { DeploymentProfile } from '../../app/api/utils/ciControl/deploymentProfilesCore';
import { getDeploymentDataEnvironment } from '../../app/api/utils/deployment/dataEnvironment';
import type { GatewaySettings } from '../../app/api/utils/deployment/environmentGateway';
import { pilotAliasForLane, type PilotLane } from '../../app/api/utils/deployment/pilotBuild';

export const PILOT_GATEWAY = 'https://master.previews.thingtime.com';
export const PILOT_VERSION = '1.3.0';
export const PILOT_PROFILE_HEADER = 'x-thingtime-gateway-pilot';
export const PILOT_OIDC_HEADER = 'x-thingtime-gateway-workload-token';
export const PILOT_LANE_HEADER = 'x-thingtime-gateway-pilot-lane';
export const PILOT_PR_HEADER = 'x-thingtime-gateway-pilot-pr';
export const TRUSTED_SOURCE_HEADER = 'x-vercel-trusted-oidc-idp-token';
const keyCache = new Map<string, JWTVerifyGetKey>();

export function isPilotGateway(settings: GatewaySettings, env: Record<string, string | undefined> = process.env) {
  const data = getDeploymentDataEnvironment(env);
  return settings.environment === 'preview' && settings.origin === PILOT_GATEWAY &&
    data?.kind === 'development' && data.federationId !== 'production' &&
    data.authorityOrigin === 'https://dev.thingtime.com';
}

export function isPilotLaneGateway(settings: GatewaySettings, lane: PilotLane, env: Record<string, string | undefined> = process.env) {
  const data = getDeploymentDataEnvironment(env);
  if (lane === 'production') return settings.environment === 'production' &&
    settings.origin === 'https://thingtime.com' && data?.kind === 'production' &&
    data.federationId === 'production' && data.authorityOrigin === 'https://thingtime.com';
  return isPilotGateway(settings, env);
}

export function enrolledPilotOrigin(profile: DeploymentProfile, lane: PilotLane, prNumber?: number): string | null {
  if (!profile.pilotLanes?.includes(lane)) return null;
  try { return pilotAliasForLane(profile.testOrigin, lane, prNumber); } catch { return null; }
}

export async function authenticatePilot(token: string, profile: DeploymentProfile, key?: JWTVerifyGetKey, lane?: PilotLane) {
  if (profile.mode !== 'parallel' || !profile.enabled || !token || token.length > 16384) return false;
  const environment = lane === 'development' || lane === 'preview' ? 'preview' : 'production';
  const issuer = 'https://oidc.vercel.com/' + profile.teamSlug;
  const audience = 'https://vercel.com/' + profile.teamSlug;
  try {
    if (!key) {
      key = keyCache.get(issuer);
      if (!key) {
        // The issuer comes only from the saved, validated administrator profile.
        key = createRemoteJWKSet(new URL(issuer + '/.well-known/jwks'), { timeoutDuration: 3000 });
        if (keyCache.size >= 16) keyCache.delete(keyCache.keys().next().value!);
        keyCache.set(issuer, key);
      }
    }
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['RS256'], issuer, audience, requiredClaims: ['iat', 'exp'],
      subject: 'owner:' + profile.teamSlug + ':project:' + profile.projectName + ':environment:' + environment,
      maxTokenAge: '2h', clockTolerance: 5
    });
    return payload.aud === audience && payload.owner_id === profile.teamId && payload.project_id === profile.projectId &&
      payload.owner === profile.teamSlug && payload.project === profile.projectName && payload.environment === environment;
  } catch { return false; }
}
