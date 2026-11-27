import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { DeploymentProfile } from '../../app/api/utils/ciControl/deploymentProfilesCore';
import { getDeploymentDataEnvironment } from '../../app/api/utils/deployment/dataEnvironment';
import type { GatewaySettings } from '../../app/api/utils/deployment/environmentGateway';

export const PILOT_GATEWAY = 'https://master.previews.thingtime.com';
export const PILOT_VERSION = '1.3.0';
export const PILOT_PROFILE_HEADER = 'x-thingtime-gateway-pilot';
export const PILOT_OIDC_HEADER = 'x-thingtime-gateway-workload-token';
export const TRUSTED_SOURCE_HEADER = 'x-vercel-trusted-oidc-idp-token';
const keyCache = new Map<string, JWTVerifyGetKey>();

export function isPilotGateway(settings: GatewaySettings, env: Record<string, string | undefined> = process.env) {
  const data = getDeploymentDataEnvironment(env);
  return settings.environment === 'preview' && settings.origin === PILOT_GATEWAY &&
    data?.kind === 'development' && data.federationId !== 'production' &&
    data.authorityOrigin === 'https://dev.thingtime.com';
}

export async function authenticatePilot(token: string, profile: DeploymentProfile, key?: JWTVerifyGetKey) {
  if (profile.mode !== 'parallel' || !profile.enabled || !token || token.length > 16384) return false;
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
      subject: 'owner:' + profile.teamSlug + ':project:' + profile.projectName + ':environment:production',
      maxTokenAge: '2h', clockTolerance: 5
    });
    return payload.aud === audience && payload.owner_id === profile.teamId && payload.project_id === profile.projectId &&
      payload.owner === profile.teamSlug && payload.project === profile.projectName && payload.environment === 'production';
  } catch { return false; }
}
