import React from 'react';

import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '../Lopu/useLopu';
import { getUserMention } from '~/utils/userIdentity';

// Device-scoped mirror of the last-known roster so the switcher paints its rows
// instantly on open instead of a "Checking accounts…" spinner (optimistic
// rendering). Only the public account info the client already holds; overwritten
// (to []) on full sign-out.
const ROSTER_CACHE_KEY = 'tt-accounts-roster';

export type SwitcherAccountUser = {
  id: string;
  username: string;
  displayName?: string | null;
  email?: string;
  emailVerified?: boolean;
  temporary?: boolean;
  avatarUrl?: string | null;
};

export type SwitcherAccount = { user: SwitcherAccountUser; active: boolean };

// Client heart of the account switcher: loads the roster from
// GET /api/v1/auth/accounts and wraps switch / remove / logout with the house
// toast + root-data-refresh conventions. Every state change flows through the
// API — the httpOnly cookies are never touched client-side.
export const useAccountSwitcher = () => {
  const api = useApi();
  const lopu = useLopu();
  const user = useCurrentUser();

  // Seed synchronously from the device mirror so the first paint shows the
  // last-known roster; the spinner is reserved for a true cold start (no cache).
  const [accounts, setAccounts] = React.useState<SwitcherAccount[]>(
    () => readLocalCache<SwitcherAccount[]>(ROSTER_CACHE_KEY) || []
  );
  const [loading, setLoading] = React.useState(() => readLocalCache<SwitcherAccount[]>(ROSTER_CACHE_KEY) === null);
  const [busyUserId, setBusyUserId] = React.useState<string | null>(null);

  // Every roster update funnels through here so the mirror stays in lockstep.
  const commitAccounts = React.useCallback((next: SwitcherAccount[]) => {
    setAccounts(next);
    writeLocalCache(ROSTER_CACHE_KEY, next);
  }, []);

  // useApi()'s return object is rebuilt per render — refs keep the callbacks
  // below stable without refetch loops (same pattern as Feed.tsx).
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const lopuRef = React.useRef(lopu);
  lopuRef.current = lopu;
  const commitRef = React.useRef(commitAccounts);
  commitRef.current = commitAccounts;

  const refresh = React.useCallback(async () => {
    try {
      const resp = await apiRef.current.v1.auth.accounts.list();
      if (resp?.ok) commitRef.current(resp.accounts || []);
    } catch {
      // keep rendering whatever the switcher last knew
    } finally {
      setLoading(false);
    }
  }, []);

  // The active user changing (login / logout / switch anywhere in the app) is
  // also the signal that the roster may have changed.
  React.useEffect(() => {
    refresh();
  }, [refresh, user?.id]);

  const switchTo = React.useCallback(async (target: SwitcherAccountUser) => {
    setBusyUserId(target.id);
    try {
      const resp = await apiRef.current.v1.auth.accounts.switch({ userId: target.id });
      if (resp?.ok) {
        commitRef.current(resp.accounts || []);
        lopuRef.current({
          title: `Switched to ${getUserMention(resp.user || target)} ✨`,
          status: 'success',
          duration: 5000
        });
        return resp;
      }
      lopuRef.current({
        title: 'Could not switch accounts',
        description: resp?.error || 'Please try again.',
        status: 'error'
      });
    } catch (err: any) {
      // non-2xx throws the parsed payload; a 404 carries the pruned roster
      if (Array.isArray(err?.accounts)) commitRef.current(err.accounts);
      lopuRef.current({
        title: 'Could not switch accounts',
        description: err?.error || 'Could not reach the server.',
        status: 'error'
      });
    } finally {
      setBusyUserId(null);
    }
    return null;
  }, []);

  const removeAccount = React.useCallback(async (target: SwitcherAccountUser) => {
    setBusyUserId(target.id);
    try {
      const resp = await apiRef.current.v1.auth.accounts.remove({ userId: target.id });
      if (resp?.ok) {
        commitRef.current(resp.accounts || []);
        lopuRef.current({
          title: `Signed ${getUserMention(target)} out 👋`,
          description: resp.user ? `Now on ${getUserMention(resp.user)}.` : undefined,
          status: 'success',
          duration: 5000
        });
        return resp;
      }
      lopuRef.current({
        title: 'Could not remove that account',
        description: resp?.error || 'Please try again.',
        status: 'error'
      });
    } catch (err: any) {
      lopuRef.current({
        title: 'Could not remove that account',
        description: err?.error || 'Could not reach the server.',
        status: 'error'
      });
    } finally {
      setBusyUserId(null);
    }
    return null;
  }, []);

  // Logout with switcher semantics: the active account signs out and the next
  // roster account (resp.user) takes over; resp.user null = fully signed out.
  // Toasts here; navigation stays with the caller (it knows its surface).
  // Claims the busy flag with a sentinel so switch/remove can't overlap and
  // resurrect just-revoked cookies (the sentinel never matches a row's id, so
  // no row spinner appears).
  const logoutActive = React.useCallback(async (args?: { all?: boolean }) => {
    setBusyUserId('__logout__');
    try {
      const resp = await apiRef.current.v1.auth.logout(args);
      if (resp?.ok) {
        if (Array.isArray(resp.accounts)) commitRef.current(resp.accounts);
        lopuRef.current({
          title: resp.user ? `Logged out — switched to ${getUserMention(resp.user)} ✨` : 'Logged out',
          status: 'success',
          duration: 6000
        });
        return resp;
      }
      lopuRef.current({
        title: 'Logout failed',
        description: resp?.error || 'Please try again in a moment.',
        status: 'error'
      });
    } catch (err: any) {
      lopuRef.current({
        title: 'Logout failed',
        description: err?.error || 'Please try again in a moment.',
        status: 'error'
      });
    } finally {
      setBusyUserId(null);
    }
    return null;
  }, []);

  return { accounts, loading, busyUserId, refresh, switchTo, removeAccount, logoutActive };
};
