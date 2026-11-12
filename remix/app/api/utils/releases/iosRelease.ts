import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createAdminSecret, readAdminAutomationSecret } from '../admin/integrations';
import { getAdminIntegrationClaimsCollection, getAdminIntegrationAuditCollection } from '../mongodb/collections';
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry';
import { IOS_RELEASE_AUDIENCE, IOS_RELEASE_CREDENTIAL_LABEL, IOS_RELEASE_POLICY_LABEL, parseIOSReleasePolicy, type IOSReleaseBundle } from './iosReleaseCore';

const keys = createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'), { timeoutDuration: 5000 });
export const createIOSReleaseTokenVerifier = (resolver = keys) => async (token: string) => (await jwtVerify(token, resolver, {
  algorithms: ['RS256'], issuer: 'https://token.actions.githubusercontent.com', audience: IOS_RELEASE_AUDIENCE,
  maxTokenAge: '5m', requiredClaims: ['exp', 'iat', 'nbf', 'jti', 'sub'], clockTolerance: 5
})).payload;
export const verifyIOSReleaseToken = createIOSReleaseTokenVerifier();
export const readIOSReleasePolicy = async () => parseIOSReleasePolicy(await readAdminAutomationSecret(IOS_RELEASE_POLICY_LABEL));
export const readIOSReleaseCredentials = async () => {
  const value = await readAdminAutomationSecret(IOS_RELEASE_CREDENTIAL_LABEL);
  return value ? JSON.parse(value) : null;
};
export const migrateIOSReleaseCredentials = async (credentials: IOSReleaseBundle) => {
  // Unique label index makes concurrent imports create-only. Rotation stays in Admin.
  try {
    await createAdminSecret({ label: IOS_RELEASE_CREDENTIAL_LABEL, value: JSON.stringify(credentials) }, 'github-actions:ios-testflight');
    return true;
  } catch (error: any) {
    if (error?.code === 11000) return false;
    throw error;
  }
};
export const claimIOSReleaseToken = async (jti: string, exp: number) => {
  try {
    await (await getAdminIntegrationClaimsCollection()).insertOne({
      endpointId: 'ios-release', resourceKey: createHash('sha256').update(jti).digest('hex'),
      createdAt: new Date(), expiresAt: new Date((exp + 60) * 1000),
      schemaVersion: COLLECTION_SCHEMA_VERSIONS.adminIntegrationClaims
    });
    return true;
  } catch (error: any) {
    if (error?.code === 11000) return false;
    throw error;
  }
};
export const auditIOSRelease = async (runId: string, operation: 'fetch' | 'migrate', sha: string) => {
  await (await getAdminIntegrationAuditCollection()).insertOne({
    id: `ios-release-${runId}-${Date.now()}`, endpointId: 'ios-release', actorId: `github-actions:${runId}`,
    operation: operation === 'migrate' ? 'create' : 'read', path: `/ios-testflight/${sha}`, status: 200,
    outcome: 'allowed', createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86400_000)
  });
};
