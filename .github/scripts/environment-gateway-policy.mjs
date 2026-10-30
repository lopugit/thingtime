// Protected publisher policy. Product branches may opt into their own backend,
// but may never choose an environment's canonical owner or its credentials.
export const gatewayPolicyVersion = '1';
export function gatewayPolicy({ branch, target, owner = false, follower = false }) {
  const environment = target.slug === 'production' ? 'production' : target.slug === 'develop' ? 'develop' : target.slug === 'preview' ? 'preview' : null;
  if (!environment) throw new Error('Gateway mapping missing for deployment environment');
  if (environment === 'production' && branch !== 'main') throw new Error('Production gateway requires main');
  const origin = { production: 'https://thingtime.com', develop: 'https://dev.thingtime.com', preview: 'https://master.previews.thingtime.com' }[environment];
  const canonical = !follower && (owner || (environment === 'production' && branch === 'main') || (environment === 'develop' && branch === 'develop'));
  if (owner && !(environment === 'preview' && branch === 'main')) throw new Error('Preview master requires trusted main');
  return { environment, origin, owner: canonical, version: gatewayPolicyVersion };
}
export function gatewayRuntimeEnvironment(policy) {
  return {
    THINGTIME_GATEWAY_ENVIRONMENT: policy.environment,
    THINGTIME_GATEWAY_ORIGIN: policy.origin,
    ...(policy.owner ? { THINGTIME_MONGODB_CONNECTION_MODE: 'proxy' } : {})
  };
}
export function gatewayMetadata(policy) {
  return { thingtimeGatewayPolicy: policy.version, thingtimeGatewayEnvironment: policy.environment, thingtimeGatewayOrigin: policy.origin, thingtimeGatewayOwner: String(policy.owner) };
}
export function gatewayDeploymentIssue(deployment, policy) {
  return Object.entries(gatewayMetadata(policy)).some(([key, value]) => deployment.meta?.[key] !== value) ? 'gateway-policy' : null;
}
export function gatewayPublisherEnvironment(policy, inherited = process.env) {
  // Never inherit an operator's dedicated override into a canonical owner.
  const environment = { ...inherited };
  for (const key of Object.keys(environment)) if (key.startsWith('THINGTIME_GATEWAY_') || key === 'THINGTIME_MONGODB_CONNECTION_MODE') delete environment[key];
  return { ...environment, ...gatewayRuntimeEnvironment(policy) };
}
export function gatewayRuntimeArgs(policy) {
  // Only non-secret key names enter argv. The selected target supplies its
  // encrypted THINGTIME_GATEWAY_SECRET directly from Vercel's environment.
  return Object.keys(gatewayRuntimeEnvironment(policy)).flatMap((key) => ['--env', key]);
}

export function gatewaySecretConfigured(rows, target) {
  return rows.some((row) => row.key === 'THINGTIME_GATEWAY_SECRET' && row.type === 'encrypted' &&
    (target.id ? row.customEnvironmentIds?.includes(target.id) : row.target?.includes(target.slug)));
}

export async function reconcileGatewayAliases({ names, before: saved, deploymentId, read, assign, remove, verify }) {
  // Snapshot every binding before mutating any; rollback only bindings that
  // still point at our attempted deployment, preserving concurrent operators.
  const before = saved || new Map(await Promise.all(names.map(async (name) => [name, await read(name)])));
  try {
    for (const name of names) {
      if (before.get(name)?.deploymentId !== deploymentId) await assign(name, deploymentId);
      if ((await read(name))?.deploymentId !== deploymentId) throw new Error('Alias did not publish verified deployment');
      await verify(name);
    }
  } catch (error) {
    await restoreGatewayAliases({ before, deploymentId, read, assign, remove });
    throw error;
  }
}

export async function restoreGatewayAliases({ before, deploymentId, read, assign, remove }) {
  for (const name of [...before.keys()].reverse()) {
    if ((await read(name))?.deploymentId !== deploymentId || before.get(name)?.deploymentId === deploymentId) continue;
    const previous = before.get(name);
    if (previous?.deploymentId) await assign(name, previous.deploymentId);
    else await remove(name);
    if (((await read(name))?.deploymentId || null) !== (previous?.deploymentId || null)) throw new Error('Alias rollback verification failed');
  }
}
