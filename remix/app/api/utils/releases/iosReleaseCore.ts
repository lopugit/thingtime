import type { JWTPayload } from 'jose';

export const IOS_RELEASE_POLICY_LABEL = 'iOS TestFlight policy';
export const IOS_RELEASE_CREDENTIAL_LABEL = 'iOS TestFlight credentials';
export const IOS_RELEASE_AUDIENCE = 'thingtime:ios-testflight';
export const IOS_RELEASE_KEYS = [
  'ASC_KEY_ID', 'ASC_ISSUER_ID', 'ASC_KEY_CONTENT', 'DEVELOPMENT_TEAM',
  'PRODUCT_BUNDLE_IDENTIFIER', 'WATCH_BUNDLE_IDENTIFIER',
  'IOS_DISTRIBUTION_CERTIFICATE_ID', 'IOS_DISTRIBUTION_CERT_P12', 'IOS_DISTRIBUTION_CERT_P12_PASSWORD'
] as const;
export type IOSReleaseBundle = Record<typeof IOS_RELEASE_KEYS[number], string>;
export type IOSReleasePolicy = { repository: string; repositoryId: string; ownerId: string; enabled: true; allowMigration: boolean };

export const parseIOSReleasePolicy = (raw: string | null): IOSReleasePolicy | null => {
  try {
    const p = JSON.parse(raw ?? 'null');
    if (p?.enabled !== true || !/^[\w.-]+\/[\w.-]+$/.test(p.repository) ||
        !/^[1-9]\d*$/.test(p.repositoryId) || !/^[1-9]\d*$/.test(p.ownerId)) return null;
    return { repository: p.repository, repositoryId: p.repositoryId, ownerId: p.ownerId, enabled: true, allowMigration: p.allowMigration === true };
  } catch { return null; }
};

// Only call after signature, issuer, audience, expiry and max-token-age verification.
export const authorizeIOSRelease = (p: JWTPayload, policy: IOSReleasePolicy) => {
  const ref = 'refs/heads/main';
  if (p.repository !== policy.repository || p.repository_id !== policy.repositoryId ||
      p.repository_owner_id !== policy.ownerId || p.ref !== ref || p.ref_type !== 'branch' ||
      p.workflow_ref !== `${policy.repository}/.github/workflows/ios-testflight.yml@${ref}` ||
      p.runner_environment !== 'github-hosted' || !['push', 'workflow_dispatch'].includes(String(p.event_name)) ||
      typeof p.sha !== 'string' || !/^[a-f0-9]{40}$/.test(p.sha) || p.workflow_sha !== p.sha ||
      typeof p.jti !== 'string' || !/^[\w-]{16,200}$/.test(p.jti) ||
      typeof p.exp !== 'number' || !/^[1-9]\d*$/.test(String(p.run_id)) || !/^[1-9]\d*$/.test(String(p.run_attempt))) return false;
  // Bind the subject as well as immutable IDs; support GitHub's newer immutable subjects.
  const [owner, repo] = policy.repository.split('/');
  return [
    `repo:${policy.repository}:ref:${ref}`,
    `repo:${owner}@${policy.ownerId}/${repo}@${policy.repositoryId}:ref:${ref}`
  ].includes(String(p.sub));
};

export const parseIOSReleaseBundle = (input: unknown): IOSReleaseBundle | null => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => !IOS_RELEASE_KEYS.includes(key as any))) return null;
  if (IOS_RELEASE_KEYS.some((key) => typeof value[key] !== 'string' || !value[key] || /[\r\n\0]/.test(value[key] as string))) return null;
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 30 * 1024) return null;
  for (const key of ['ASC_KEY_CONTENT', 'IOS_DISTRIBUTION_CERT_P12']) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value[key] as string)) return null;
  }
  if (!/^[A-Z0-9]{10}$/.test(value.ASC_KEY_ID as string) || !/^[A-Z0-9]{10}$/.test(value.DEVELOPMENT_TEAM as string) ||
      !/^[a-f0-9-]{36}$/i.test(value.ASC_ISSUER_ID as string) ||
      !/^[A-Za-z0-9.-]+$/.test(value.PRODUCT_BUNDLE_IDENTIFIER as string) ||
      value.WATCH_BUNDLE_IDENTIFIER !== `${value.PRODUCT_BUNDLE_IDENTIFIER}.watchkitapp` ||
      !/^[A-Za-z0-9]+$/.test(value.IOS_DISTRIBUTION_CERTIFICATE_ID as string)) return null;
  return Object.fromEntries(IOS_RELEASE_KEYS.map((key) => [key, value[key]])) as IOSReleaseBundle;
};
