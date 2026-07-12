import React from 'react';
import { Box, Button, Flex } from '@chakra-ui/react';

import { Login } from '~/components/Login/Login';
import { Register } from '~/components/Login/Register';

// The "Login with Thingtime" popup (route /authorize, opened by the embed SDK
// from a third-party site). Flow: validate clientId + origin against
// /api/v1/apps/public → log in (or register) if needed → consent → POST
// /api/v1/oauth/authorize → hand the app-scoped token to the opener via
// postMessage (targetOrigin = the validated origin, never '*') → close.
//
// The token deliberately only reaches window.opener at the exact allowlisted
// origin. If someone opens this URL directly (no opener), the approval still
// works but the token goes nowhere — we just tell them to close the window.

type EmbedApp = { clientId: string; name: string };
type EmbedUser = { id: string; username: string; displayName: string | null; avatarUrl: string | null };
type ScopeDescriptor = { id: string; title: string; description: string; required: boolean };

const MAX_STATE_CHARS = 512;

const SCOPE_EMOJI: Record<string, string> = {
  profile: '👤',
  email: '💌',
  'app-data': '📦'
};

// Never rejects: transport failures resolve to { ok:false, network:true } so
// every consumer can show a real error + retry instead of stranding the popup
// on a spinner (the SDK's promise would otherwise hang to its 10-min timeout).
const fetchJson = async (url: string, init: RequestInit = {}) => {
  try {
    const response = await fetch(url, {
      credentials: 'include',
      ...init,
      headers: { Accept: 'application/json', ...(init.headers || {}) }
    });
    return await response.json().catch(() => ({ ok: false, error: 'Unexpected response' }));
  } catch {
    return { ok: false, network: true, error: 'Could not reach Thingtime — check your connection and try again.' };
  }
};

const cardSx = {
  flexDirection: 'column' as const,
  gap: 4,
  width: '400px',
  maxWidth: '100%',
  background: 'var(--tt-card, #ffffff)',
  border: '1px solid var(--tt-border, #ececef)',
  borderRadius: 'var(--tt-radius-xl, 20px)',
  boxShadow: 'var(--tt-shadow-panel, 0 24px 60px -28px rgba(20, 20, 40, 0.28))',
  padding: 8
};

const Kicker = ({ children }: { children: React.ReactNode }) => (
  <Box
    fontFamily="mono"
    fontSize="11px"
    fontWeight="600"
    letterSpacing="0.14em"
    textTransform="uppercase"
    color="var(--tt-muted, #9a9aa6)"
  >
    {children}
  </Box>
);

export const AuthorizePage = () => {
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const clientId = (params.get('client_id') || params.get('clientId') || '').trim();
  const origin = (params.get('origin') || '').trim();
  const state = (params.get('state') || '').slice(0, MAX_STATE_CHARS);
  const scopeParam = (params.get('scope') || '').slice(0, 256);

  const [app, setApp] = React.useState<EmbedApp | null>(null);
  const [verifiedOrigin, setVerifiedOrigin] = React.useState<string | null>(null);
  const [scopes, setScopes] = React.useState<ScopeDescriptor[]>([]);
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [invalidReason, setInvalidReason] = React.useState<string | null>(null);
  const [networkFailed, setNetworkFailed] = React.useState(false);
  const [user, setUser] = React.useState<EmbedUser | null>(null);
  const [checkedAuth, setCheckedAuth] = React.useState(false);
  const [mode, setMode] = React.useState<'login' | 'register'>('login');
  const [issuing, setIssuing] = React.useState(false);
  const [done, setDone] = React.useState<'approved' | 'cancelled' | null>(null);
  const [issueError, setIssueError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!clientId || !origin) {
      setInvalidReason('This link is missing its app details (client_id and origin).');
      return;
    }

    fetchJson(
      `/api/v1/apps/public?clientId=${encodeURIComponent(clientId)}&origin=${encodeURIComponent(origin)}&scope=${encodeURIComponent(scopeParam)}`
    ).then(
      (resp) => {
        if (resp?.ok && resp.app) {
          setApp(resp.app);
          setVerifiedOrigin(resp.origin);
          const list: ScopeDescriptor[] = Array.isArray(resp.scopes) ? resp.scopes : [];
          setScopes(list);
          // Everything the platform asked for starts ticked; the user unticks
          // what they'd rather not share (required scopes can't be unticked).
          setSelected(Object.fromEntries(list.map((scope) => [scope.id, true])));
        } else {
          setNetworkFailed(!!resp?.network);
          setInvalidReason(resp?.error || 'This app could not be verified.');
        }
      }
    );

    // Always resolves (fetchJson never rejects); a failed auth probe just
    // means "not logged in yet" — the login form handles it from there.
    fetchJson('/api/v1/auth/me').then((resp) => {
      if (resp?.user) setUser(resp.user);
      setCheckedAuth(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const postToOpener = (payload: Record<string, unknown>) => {
    // targetOrigin is the server-validated origin — the token can only land on
    // the allowlisted embedding page, even if the opener navigated elsewhere.
    if (typeof window !== 'undefined' && window.opener && verifiedOrigin) {
      window.opener.postMessage({ ...payload, state }, verifiedOrigin);
      return true;
    }
    return false;
  };

  const approve = async () => {
    if (!app || !verifiedOrigin || issuing) return;
    setIssuing(true);
    setIssueError(null);

    const resp = await fetchJson('/api/v1/oauth/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: app.clientId,
        origin: verifiedOrigin,
        scope: scopeParam,
        scopes: scopes.filter((scope) => scope.required || selected[scope.id]).map((scope) => scope.id)
      })
    });

    if (resp?.ok && resp.token) {
      postToOpener({
        type: 'thingtime:login',
        ok: true,
        token: resp.token,
        tokenType: resp.tokenType,
        expiresAt: resp.expiresAt,
        scopes: resp.scopes,
        user: resp.user
      });
      setDone('approved');
      setTimeout(() => window.close(), 400);
    } else {
      setIssueError(resp?.error || 'Could not authorize — please try again.');
    }
    setIssuing(false);
  };

  const cancel = () => {
    postToOpener({ type: 'thingtime:login', ok: false, error: 'cancelled' });
    setDone('cancelled');
    setTimeout(() => window.close(), 400);
  };

  const originHost = React.useMemo(() => {
    try {
      return verifiedOrigin ? new URL(verifiedOrigin).host : null;
    } catch {
      return null;
    }
  }, [verifiedOrigin]);

  let body: React.ReactNode;

  if (invalidReason) {
    body = (
      <Flex sx={cardSx}>
        <Kicker>Thingtime · Login with Thingtime</Kicker>
        <Box as="h1" fontSize="20px" fontWeight="700">
          {networkFailed ? 'Connection hiccup' : 'This login link isn’t valid'}
        </Box>
        <Box color="var(--tt-muted, #9a9aa6)" fontSize="14px">
          {invalidReason}
        </Box>
        {networkFailed ? (
          <Button onClick={() => window.location.reload()} alignSelf="flex-start" size="sm">
            Try again
          </Button>
        ) : (
          <Box color="var(--tt-muted, #9a9aa6)" fontSize="13px">
            If you run this site, register the app (and this exact origin) under Thingtime apps, then reload.
          </Box>
        )}
      </Flex>
    );
  } else if (done) {
    body = (
      <Flex sx={cardSx} alignItems="flex-start">
        <Kicker>Thingtime · Login with Thingtime</Kicker>
        <Box as="h1" fontSize="20px" fontWeight="700">
          {done === 'approved' ? 'You’re signed in ✨' : 'Cancelled'}
        </Box>
        <Box color="var(--tt-muted, #9a9aa6)" fontSize="14px">
          {done === 'approved'
            ? `You can head back to ${app?.name || 'the site'} — this window will close itself.`
            : 'Nothing was shared. You can close this window.'}
        </Box>
      </Flex>
    );
  } else if (!app || !checkedAuth) {
    // True cold start (fresh popup): a minimal frame, no spinner flash.
    body = (
      <Flex sx={cardSx}>
        <Kicker>Thingtime · Login with Thingtime</Kicker>
        <Box color="var(--tt-muted, #9a9aa6)" fontSize="14px">
          Checking this app…
        </Box>
      </Flex>
    );
  } else if (!user) {
    body = (
      <Flex flexDirection="column" gap={3} width="400px" maxWidth="100%">
        <Flex sx={{ ...cardSx, width: '100%', padding: 5, gap: 1 }}>
          <Kicker>Login with Thingtime</Kicker>
          <Box fontSize="14px" color="var(--tt-muted, #9a9aa6)">
            <Box as="strong" color="var(--tt-text, #1c1c22)">
              {app.name}
            </Box>{' '}
            ({originHost}) wants to sign you in with your Thingtime account.
          </Box>
        </Flex>
        {mode === 'login' ? (
          <Login embedded onSuccess={(u: EmbedUser) => setUser(u)} onSwitchMode={() => setMode('register')} />
        ) : (
          <Register embedded onSuccess={(u: EmbedUser) => setUser(u)} onSwitchMode={() => setMode('login')} />
        )}
      </Flex>
    );
  } else {
    body = (
      <Flex sx={cardSx}>
        <Kicker>Login with Thingtime</Kicker>
        <Box as="h1" fontSize="20px" fontWeight="700" lineHeight="1.3">
          {app.name}
        </Box>
        <Box fontSize="14px" color="var(--tt-muted, #9a9aa6)">
          {originHost} wants to sign you in as{' '}
          <Box as="strong" color="var(--tt-text, #1c1c22)">
            @{user.username}
          </Box>
          .
        </Box>

        <Flex
          flexDirection="column"
          gap={1}
          paddingY={1}
          role="group"
          aria-labelledby="tt-authorize-scopes-label"
        >
          <Box
            id="tt-authorize-scopes-label"
            fontFamily="mono"
            fontSize="10px"
            fontWeight="600"
            letterSpacing="0.12em"
            textTransform="uppercase"
            color="var(--tt-muted, #9a9aa6)"
            paddingBottom={1}
          >
            It’s asking to
          </Box>
          {scopes.map((scope) => {
            const checked = scope.required || !!selected[scope.id];
            return (
              <Flex
                key={scope.id}
                as="label"
                gap={3}
                alignItems="flex-start"
                padding={2}
                borderRadius="var(--tt-radius-sm, 9px)"
                cursor={scope.required ? 'default' : 'pointer'}
                _hover={scope.required ? undefined : { background: 'var(--tt-surface-alt, #f5f5f7)' }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={scope.required}
                  onChange={(event) =>
                    setSelected((prev) => ({ ...prev, [scope.id]: event.target.checked }))
                  }
                  style={{ marginTop: '3px', accentColor: 'var(--tt-text, #1c1c22)' }}
                />
                <Box fontSize="14px">
                  <Box as="span" fontWeight="600">
                    {SCOPE_EMOJI[scope.id] || '🔐'} {scope.title}
                  </Box>
                  {scope.required ? (
                    <Box as="span" fontSize="12px" color="var(--tt-muted, #9a9aa6)">
                      {' '}
                      · always shared
                    </Box>
                  ) : null}
                  <Box fontSize="13px" color="var(--tt-muted, #9a9aa6)">
                    {scope.description}
                  </Box>
                </Box>
              </Flex>
            );
          })}
          <Flex gap={2} alignItems="center" fontSize="13px" color="var(--tt-muted, #9a9aa6)" paddingTop={1}>
            <Box>🔒</Box>
            <Box>It can never read your posts, password, or anything another app stored.</Box>
          </Flex>
        </Flex>

        {issueError ? (
          <Box fontSize="13px" color="var(--tt-danger, #d3455b)">
            {issueError}
          </Box>
        ) : null}

        <Flex gap={2}>
          <Button
            onClick={approve}
            isLoading={issuing}
            flex="1"
            background="var(--tt-text, #1c1c22)"
            color="var(--tt-card, #ffffff)"
            _hover={{ opacity: 0.9 }}
          >
            Continue as @{user.username}
          </Button>
          <Button onClick={cancel} variant="ghost">
            Cancel
          </Button>
        </Flex>
      </Flex>
    );
  }

  return (
    <Flex
      alignItems="center"
      justifyContent="center"
      width="100%"
      minHeight="100vh"
      background="var(--tt-surface, #fafafb)"
      paddingX={4}
      paddingY={8}
    >
      {body}
    </Flex>
  );
};

export default AuthorizePage;
