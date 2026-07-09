import React from 'react';

import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useLopu } from '../Lopu/useLopu';

export type SwitcherAccountUser = {
  id: string;
  username: string;
  displayName?: string | null;
  email?: string;
  emailVerified?: boolean;
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

  const [accounts, setAccounts] = React.useState<SwitcherAccount[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busyUserId, setBusyUserId] = React.useState<string | null>(null);

  // useApi()'s return object is rebuilt per render — refs keep the callbacks
  // below stable without refetch loops (same pattern as Feed.tsx).
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const lopuRef = React.useRef(lopu);
  lopuRef.current = lopu;

  const refresh = React.useCallback(async () => {
    try {
      const resp = await apiRef.current.v1.auth.accounts.list();
      if (resp?.ok) setAccounts(resp.accounts || []);
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
        setAccounts(resp.accounts || []);
        lopuRef.current({
          title: `Switched to @${resp.user?.username || target.username} ✨`,
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
      if (Array.isArray(err?.accounts)) setAccounts(err.accounts);
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
        setAccounts(resp.accounts || []);
        lopuRef.current({
          title: `Signed @${target.username} out 👋`,
          description: resp.user ? `Now on @${resp.user.username}.` : undefined,
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
        if (Array.isArray(resp.accounts)) setAccounts(resp.accounts);
        lopuRef.current({
          title: resp.user ? `Logged out — switched to @${resp.user.username} ✨` : 'Logged out',
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
