import React from 'react';
import { Box, Button, Center, Flex, Image, Spinner, Text } from '@chakra-ui/react';
import { useNavigate } from 'react-router';
import { Check, X } from 'lucide-react';

import { Login } from '../Login/Login';
import { Register } from '../Login/Register';
import { useAccountSwitcher } from './useAccountSwitcher';
import type { SwitcherAccount, SwitcherAccountUser } from './useAccountSwitcher';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { RAINBOW } from '~/theme/rainbow';

// Account switcher: every account signed in to this browser, click-to-switch,
// per-account sign-out, plus "Add account" (login) and "Register new" (fresh
// signup) inline forms. Lives in the user settings modal and /settings; also
// works signed out ("continue as" from the roster).

const RowAvatar = (props: { user: SwitcherAccountUser }) => {
  const { user } = props;

  if (user?.avatarUrl) {
    return (
      <Image
        src={user.avatarUrl}
        alt={user.displayName || user.username}
        width="32px"
        height="32px"
        borderRadius="999px"
        objectFit="cover"
        flexShrink={0}
        border="1px solid var(--tt-border, #ececef)"
      />
    );
  }

  const initial = (user?.displayName || user?.username || '?').trim().charAt(0).toUpperCase();

  return (
    <Center
      width="32px"
      height="32px"
      borderRadius="999px"
      flexShrink={0}
      background={RAINBOW}
      backgroundSize="calc(100px + 200%)"
      sx={{ animation: 'var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)' }}
      color="white"
      fontSize="xs"
      fontWeight={700}
    >
      {initial}
    </Center>
  );
};

type OwnedAccount = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl?: string | null;
  accountKind: 'user' | 'service';
};

const OWNED_CACHE_KEY = 'tt-owned-accounts';

export const AccountSwitcher = (props: { onNavigate?: () => void }) => {
  const { onNavigate } = props;

  const navigate = useNavigate();
  const api = useApi();
  const { accounts, loading, busyUserId, refresh, switchTo, removeAccount, logoutActive } = useAccountSwitcher();

  const [mode, setMode] = React.useState<null | 'login' | 'register'>(null);
  const [loggingOutAll, setLoggingOutAll] = React.useState(false);

  // Owned accounts (admin-assigned 'account' links): painted from cache
  // instantly (optimistic-rendering house rule), refreshed in the background.
  // Assuming one mints a fresh session server-side and folds it into this
  // browser's roster — no credentials involved.
  const [owned, setOwned] = React.useState<OwnedAccount[]>(() => readLocalCache<OwnedAccount[]>(OWNED_CACHE_KEY) ?? []);
  const [assumingId, setAssumingId] = React.useState<string | null>(null);
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const signedIn = accounts.some((account) => account.active);

  React.useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    apiRef.current.v1.auth.accounts
      .owned()
      .then((resp: any) => {
        if (cancelled || !resp?.ok) return;
        setOwned(resp.accounts);
        writeLocalCache(OWNED_CACHE_KEY, resp.accounts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const rosterIds = new Set(accounts.map((account) => account.user.id));
  const assumable = signedIn ? owned.filter((account) => !rosterIds.has(account.id)) : [];

  const handleAssume = async (account: OwnedAccount) => {
    if (assumingId) return;
    setAssumingId(account.id);
    try {
      const resp: any = await api.v1.auth.accounts.assume({ accountId: account.id });
      if (resp?.ok) refresh();
    } catch {
      // surfaced by the roster staying unchanged; the admin may have removed
      // the link since this list was cached
    } finally {
      setAssumingId(null);
    }
  };

  const handleSwitch = async (account: SwitcherAccount) => {
    if (account.active || busyUserId) return;
    await switchTo(account.user);
  };

  const handleRemove = async (event: React.MouseEvent, account: SwitcherAccount) => {
    event.stopPropagation();
    if (busyUserId) return;
    const resp = await removeAccount(account.user);
    if (resp?.ok && !resp.user) {
      onNavigate?.();
      navigate('/login');
    }
  };

  const handleLogoutAll = async () => {
    if (busyUserId) return;
    setLoggingOutAll(true);
    const resp = await logoutActive({ all: true });
    setLoggingOutAll(false);
    if (resp?.ok) {
      onNavigate?.();
      navigate('/login');
    }
  };

  // A fresh login/register already merged + activated the account server-side;
  // the root-data refresh swaps the app user, this just folds the form away.
  const handleAdded = () => {
    setMode(null);
    refresh();
  };

  return (
    <Flex flexDirection="column" rowGap={3}>
      {!accounts.length && (
        <Flex alignItems="center" columnGap={3}>
          <Center
            width="44px"
            height="44px"
            borderRadius="999px"
            flexShrink={0}
            background="var(--tt-surface-alt, #f5f5f7)"
            color="var(--tt-muted, #9a9aa6)"
            fontSize="md"
          >
            {loading ? <Spinner size="sm" /> : '👤'}
          </Center>
          <Box minWidth={0}>
            <Text fontSize="sm" fontWeight={600} noOfLines={1}>
              {loading ? 'Checking accounts…' : 'Not logged in'}
            </Text>
            {!loading && (
              <Text fontSize="xs" opacity={0.6}>
                Log in or register to get started.
              </Text>
            )}
          </Box>
        </Flex>
      )}

      {accounts.length > 0 && (
        <Flex flexDirection="column" rowGap={1}>
          {accounts.map((account) => (
            <Flex
              key={account.user.id}
              role={account.active ? 'group' : 'button'}
              tabIndex={account.active ? undefined : 0}
              aria-label={account.active ? undefined : `Switch to @${account.user.username}`}
              alignItems="center"
              columnGap={3}
              padding={2}
              borderRadius="var(--tt-radius-sm, 9px)"
              background={account.active ? 'var(--tt-surface-alt, #f5f5f7)' : 'transparent'}
              cursor={account.active ? 'default' : 'pointer'}
              transition="background 150ms ease"
              _hover={{ background: 'var(--tt-surface-hover, var(--tt-surface-alt, #f5f5f7))' }}
              onClick={() => handleSwitch(account)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleSwitch(account);
                }
              }}
              title={account.active ? 'Active account' : `Switch to @${account.user.username}`}
            >
              <RowAvatar user={account.user} />
              <Box minWidth={0} flex="1 1 auto">
                <Text fontSize="sm" fontWeight={600} noOfLines={1}>
                  {account.user.displayName || account.user.username}
                </Text>
                <Text fontSize="xs" opacity={0.6} noOfLines={1}>
                  @{account.user.username}
                  {account.active && account.user.temporary
                    ? ' · temporary · saved in this browser'
                    : account.active && account.user.email
                    ? ` · ${account.user.email} ${account.user.emailVerified ? '✅' : '· ✉️ unverified'}`
                    : ''}
                </Text>
              </Box>
              {busyUserId === account.user.id ? (
                <Spinner size="xs" flexShrink={0} />
              ) : account.active ? (
                <Center flexShrink={0} opacity={0.7} title="Active account">
                  <Check size={14} strokeWidth={2.5} />
                </Center>
              ) : null}
              <Center
                as="button"
                type="button"
                flexShrink={0}
                width="24px"
                height="24px"
                borderRadius="7px"
                opacity={0.35}
                _hover={{ opacity: 1, background: 'var(--tt-surface-hover, rgba(0,0,0,0.05))' }}
                cursor="pointer"
                aria-label={`Sign @${account.user.username} out`}
                title={`Sign @${account.user.username} out`}
                onClick={(event) => handleRemove(event, account)}
              >
                <X size={13} strokeWidth={2} />
              </Center>
            </Flex>
          ))}
        </Flex>
      )}

      {assumable.length > 0 && (
        <Flex flexDirection="column" rowGap={1}>
          <Text fontSize="10px" fontWeight={600} letterSpacing="0.08em" textTransform="uppercase" opacity={0.45}>
            Owned accounts
          </Text>
          {assumable.map((account) => (
            <Flex
              key={account.id}
              role="button"
              tabIndex={0}
              aria-label={`Sign in as @${account.username}`}
              alignItems="center"
              columnGap={3}
              padding={2}
              borderRadius="var(--tt-radius-sm, 9px)"
              cursor="pointer"
              transition="background 150ms ease"
              _hover={{ background: 'var(--tt-surface-hover, var(--tt-surface-alt, #f5f5f7))' }}
              onClick={() => handleAssume(account)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleAssume(account);
                }
              }}
              title={`Sign in as @${account.username} (no password needed — you own this account)`}
            >
              <RowAvatar user={account as SwitcherAccountUser} />
              <Box minWidth={0} flex="1 1 auto">
                <Text fontSize="sm" fontWeight={600} noOfLines={1}>
                  {account.displayName || account.username}
                </Text>
                <Text fontSize="xs" opacity={0.6} noOfLines={1}>
                  @{account.username}
                  {account.accountKind === 'service' ? ' · 🤖 service' : ''}
                </Text>
              </Box>
              {assumingId === account.id ? (
                <Spinner size="xs" flexShrink={0} />
              ) : (
                <Text fontSize="xs" opacity={0.5} flexShrink={0}>
                  Sign in →
                </Text>
              )}
            </Flex>
          ))}
        </Flex>
      )}

      <Flex columnGap={2} rowGap={2} flexWrap="wrap">
        <Button size="xs" variant="outline" onClick={() => setMode(mode === 'login' ? null : 'login')}>
          {mode === 'login' ? 'Cancel ✋' : accounts.length ? 'Add account ➕' : 'Log in 🗝️'}
        </Button>
        <Button size="xs" variant="outline" onClick={() => setMode(mode === 'register' ? null : 'register')}>
          {mode === 'register' ? 'Cancel ✋' : accounts.length ? 'Register new 🦄' : 'Register ➕'}
        </Button>
        {accounts.length > 1 && (
          <Button size="xs" variant="outline" isLoading={loggingOutAll} onClick={handleLogoutAll}>
            Log out all 🗝️
          </Button>
        )}
      </Flex>

      {mode === 'login' && (
        <Login embedded onSuccess={handleAdded} onSwitchMode={() => setMode('register')} />
      )}
      {mode === 'register' && (
        <Register embedded onSuccess={handleAdded} onSwitchMode={() => setMode('login')} />
      )}
    </Flex>
  );
};
