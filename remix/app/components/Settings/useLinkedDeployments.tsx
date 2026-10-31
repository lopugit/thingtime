import React from 'react';

import { useApi } from '~/hooks/useApi';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useLopu } from '~/components/Lopu/useLopu';

// Data hook for Settings → Linked deployments. Owns the roster of links, the
// optimistic localCache seed (house rule: paint last-known state instantly,
// reconcile in the background), and every API call + toast. The component
// stays presentational.

export type PublicDeploymentLink = {
  id: string;
  name: string;
  baseUrl: string;
  remoteUserId: string;
  remoteUsername: string;
  syncMode: 'push' | 'pull' | 'two-way' | 'off';
  pathRules: { path: string; mode: 'push' | 'pull' | 'two-way' | 'off' }[];
  createdAt: string;
  tokenExpiresAt: string | null;
  lastSyncAt: string | null;
  lastSyncSummary: Record<string, any> | null;
};

export type LinkDeploymentForm = {
  baseUrl: string;
  name?: string;
  token?: string;
  username?: string;
  password?: string;
  challenge?: string;
  code?: string;
};

export type LinkResult = { done: boolean; challenge?: string };

const cacheKeyFor = (userId: string) => `tt-deployment-links-${userId}`;

export const useLinkedDeployments = (userId: string) => {
  const cacheKey = cacheKeyFor(userId);
  const api = useApi();
  const lopu = useLopu();

  const [links, setLinks] = React.useState<PublicDeploymentLink[]>(
    () => readLocalCache<PublicDeploymentLink[]>(cacheKey) || []
  );
  // spinner only on a true cold start with nothing cached to show
  const [loading, setLoading] = React.useState(
    () => readLocalCache<PublicDeploymentLink[]>(cacheKey) === null
  );
  const [busyKey, setBusyKey] = React.useState<string | null>(null);

  // useApi()'s object is rebuilt every render — refs keep the callbacks below
  // stable without refetch loops (same pattern as useAccountSwitcher)
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const lopuRef = React.useRef(lopu);
  lopuRef.current = lopu;

  const commit = React.useCallback(
    (next: PublicDeploymentLink[]) => {
      setLinks(next);
      writeLocalCache(cacheKey, next);
    },
    [cacheKey]
  );
  const commitRef = React.useRef(commit);
  commitRef.current = commit;

  const refresh = React.useCallback(async () => {
    try {
      const result = await apiRef.current.v1.deploymentLinks.list();
      if (Array.isArray(result?.links)) commitRef.current(result.links);
    } catch {
      // background reconcile — keep painting the cached roster
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const run = React.useCallback(async <T,>(key: string, work: () => Promise<T>): Promise<T | null> => {
    setBusyKey(key);
    try {
      return await work();
    } catch (err: any) {
      lopuRef.current({
        title: 'That didn’t work 😔',
        description: err?.error || 'Please try again in a moment.',
        status: 'error'
      });
      return null;
    } finally {
      setBusyKey(null);
    }
  }, []);

  // Link a deployment. Resolves { done: false, challenge } when the remote
  // wants a 2FA code — the form keeps the challenge and re-calls with { code }.
  const linkDeployment = React.useCallback(
    async (form: LinkDeploymentForm): Promise<LinkResult | null> =>
      run('link', async () => {
        const result = await apiRef.current.v1.deploymentLinks.link(form);
        if (result?.requiresOtp && result?.challenge) {
          lopuRef.current({
            title: 'That account has 2FA on 🔐',
            description: 'Enter the code that deployment just emailed you.',
            status: 'info',
            duration: 8000
          });
          return { done: false, challenge: result.challenge };
        }
        if (Array.isArray(result?.links)) commitRef.current(result.links);
        lopuRef.current({
          title: `Linked ${result?.link?.name || 'deployment'} ✨`,
          description: `Signed in over there as @${result?.link?.remoteUsername}.`,
          status: 'success',
          duration: 5000
        });
        return { done: true };
      }),
    [run]
  );

  const setSyncMode = React.useCallback(
    async (id: string, syncMode: PublicDeploymentLink['syncMode']) => {
      const previous = links;
      commit(links.map((link) => (link.id === id ? { ...link, syncMode } : link)));
      try {
        await apiRef.current.v1.deploymentLinks.update({ id, syncMode });
      } catch (err: any) {
        commitRef.current(previous);
        lopuRef.current({
          title: 'Could not change the sync mode 😔',
          description: err?.error || 'Please try again in a moment.',
          status: 'error'
        });
      }
    },
    [links, commit]
  );

  const setPathRules = React.useCallback(
    async (id: string, pathRules: PublicDeploymentLink['pathRules']): Promise<boolean> => {
      const previous = links;
      commit(links.map((link) => (link.id === id ? { ...link, pathRules } : link)));
      try {
        const result = await apiRef.current.v1.deploymentLinks.update({ id, pathRules });
        if (result?.link) commitRef.current(links.map((link) => (link.id === id ? result.link : link)));
        return true;
      } catch (err: any) {
        commitRef.current(previous);
        lopuRef.current({
          title: 'Could not save the path rules 😔',
          description: err?.error || 'Please try again in a moment.',
          status: 'error'
        });
        return false;
      }
    },
    [links, commit]
  );

  const describeReport = (report: any): string => {
    const bits = [`↑${report.pushed} pushed`, `↓${report.pulled} pulled`, `${report.unchanged} unchanged`];
    if (report.conflictsResolved) bits.push(`${report.conflictsResolved} conflicts resolved`);
    if (report.remaining) bits.push(`${report.remaining} still to go — run sync again`);
    if (report.errors?.length) bits.push(`${report.errors.length} errors`);
    return bits.join(' · ');
  };

  const syncNow = React.useCallback(
    async (id: string, options?: { dryRun?: boolean }) =>
      run(`${id}:${options?.dryRun ? 'preview' : 'sync'}`, async () => {
        const result = await apiRef.current.v1.deploymentLinks.sync({ id, dryRun: options?.dryRun });
        const report = result?.report;
        if (result?.link) commitRef.current(links.map((link) => (link.id === id ? result.link : link)));
        if (report?.dryRun) {
          lopuRef.current({
            title: report.planned ? `${report.planned} changes waiting to sync 👀` : 'Everything is in sync 🌸',
            description: report.planned ? describeReport(report) : undefined,
            status: 'info',
            duration: 8000
          });
        } else if (report) {
          lopuRef.current({
            title: report.errors?.length ? 'Synced with some hiccups 🌦️' : 'Sync complete ✨',
            description: describeReport(report) + (report.errors?.length ? ` — ${report.errors[0]}` : ''),
            status: report.errors?.length ? 'info' : 'success',
            duration: 9000
          });
        }
        return report || null;
      }),
    [run, links]
  );

  const removeLink = React.useCallback(
    async (id: string) =>
      run(`${id}:remove`, async () => {
        const result = await apiRef.current.v1.deploymentLinks.remove({ id });
        if (Array.isArray(result?.links)) commitRef.current(result.links);
        else commitRef.current(links.filter((link) => link.id !== id));
        lopuRef.current({ title: 'Deployment unlinked 👋', status: 'success', duration: 4000 });
        return true;
      }),
    [run, links]
  );

  // Mint a token for THIS deployment (to paste into another one). Shown once.
  const mintToken = React.useCallback(
    async (): Promise<string | null> =>
      run('mint', async () => {
        const result = await apiRef.current.v1.deploymentLinks.mintToken();
        return typeof result?.token === 'string' ? result.token : null;
      }),
    [run]
  );

  return { links, loading, busyKey, refresh, linkDeployment, setSyncMode, setPathRules, syncNow, removeLink, mintToken };
};
