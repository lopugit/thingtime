// Secret-bearing deployment checks run only in the protected controller. Resolve
// the target through Vercel before sending its project-scoped automation secret.
export function createProtectedDeploymentFetch({ env = process.env, fetcher = (...args) => fetch(...args), now = Date.now } = {}) {
  let projectPromise, projectExpires = 0;
  const lookupTtlMs = 30_000;
  const targets = new Map();
  const api = async (path, signal) => {
    let response;
    try {
      response = await fetcher(`https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(env.VERCEL_TEAM_ID)}`, {
        headers: { Authorization: `Bearer ${env.VERCEL_API_TOKEN}`, Accept: 'application/json' },
        redirect: 'error', signal: signal || AbortSignal.timeout(15_000),
      });
    } catch { throw new Error('Deployment protection lookup unavailable'); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Deployment protection lookup failed (HTTP ${response.status})`); }
    try { return await response.json(); } catch { throw new Error('Deployment protection lookup response invalid'); }
  };
  return async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Invalid deployment check origin');
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    headers.delete('x-vercel-protection-bypass');
    headers.delete('x-vercel-set-bypass-cookie');
    headers.delete('host');
    if (env.VERCEL_API_TOKEN && env.VERCEL_PROJECT_ID && env.VERCEL_TEAM_ID) {
      if (!projectPromise || projectExpires <= now()) {
        const promise = api(`/v9/projects/${encodeURIComponent(env.VERCEL_PROJECT_ID)}`, init.signal).catch(error => {
          if (projectPromise === promise) projectPromise = undefined;
          throw error;
        });
        projectPromise = promise; projectExpires = now() + lookupTtlMs;
      }
      const project = await projectPromise;
      if (project.id !== env.VERCEL_PROJECT_ID) throw new Error('Deployment protection project mismatch');
      const entry = Object.entries(project.protectionBypass || {}).find(([, value]) => value?.scope === 'automation-bypass' && value.isEnvVar !== false);
      if (!entry && project.ssoProtection) throw new Error('Protected project has no automation credential');
      let target = targets.get(url.origin);
      if (entry && (!target || target.expires <= now())) {
        const promise = api(`/v13/deployments/${encodeURIComponent(url.hostname)}`, init.signal).then(deployment => {
          if (deployment.projectId !== project.id) throw new Error('Deployment check target belongs to another project');
          return true;
        }).catch(error => { if (targets.get(url.origin)?.promise === promise) targets.delete(url.origin); throw error; });
        target = { promise, expires: now() + lookupTtlMs };
        targets.set(url.origin, target);
      }
      await target?.promise;
      if (entry) headers.set('x-vercel-protection-bypass', entry[0]);
    }
    // Never forward a credential to a redirect destination, including another
    // deployment. Callers must verify that destination independently.
    try { return await fetcher(input, { ...init, headers, redirect: 'error' }); }
    catch (error) {
      if (headers.has('x-vercel-protection-bypass') || headers.has('authorization') || headers.has('cookie'))
        throw new Error('Deployment check request unavailable');
      throw error;
    }
  };
}

export const fetchProtectedDeployment = createProtectedDeploymentFetch();
