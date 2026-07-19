import React from 'react';
import { Box, Button, Flex } from '@chakra-ui/react';

import { Login } from '~/components/Login/Login';
import { Register } from '~/components/Login/Register';

// The "Login with Thingtime" popup (route /authorize, opened by the embed SDK
// from a third-party site). Flow: validate clientId + origin against
// /api/v1/apps/public (the app must exist; the origin just has to be a valid
// web origin — origins are default-open so preview deploys work, see
// api/utils/apps/apps.ts) → log in (or register) if needed → consent, where the
// permissions selector shows the platform's REQUIRED scopes (locked), its
// OPTIONAL scopes (toggles), and — unless the platform opted out — a "share
// more" section where the user can volunteer extra profile fields and
// hand-pick specific things to share → POST /api/v1/oauth/authorize → hand
// the app-scoped token to the opener via postMessage (targetOrigin = the
// validated origin, never '*') → close.
//
// SANDBOX MODE (?sandbox=1, used by /sdk/demo.html): the full consent UI runs
// against a pretend app — no server validation, no real token, nothing
// shared. Logged-out visitors get a mock "@you" identity so the permissions
// UX is explorable without an account.

type EmbedApp = { clientId: string; name: string };
type EmbedUser = { id: string; username: string; displayName?: string | null; avatarUrl?: string | null };
type ScopeDescriptor = {
  id: string;
  title: string;
  description: string;
  kind: 'namespace' | 'field' | 'capability' | 'picker';
  baseline?: boolean;
};
type PickerThing = { id: string; label: string; detail: string };

const MAX_STATE_CHARS = 512;
// Matches the server's MAX_SHARED_THINGS cap so the picker can surface every
// thing a user is allowed to share.
const MAX_PICKER_THINGS = 100;

const SCOPE_EMOJI: Record<string, string> = {
  profile: '🪪',
  'profile.username': '👤',
  'profile.displayName': '✨',
  'profile.avatar': '🖼️',
  'profile.bio': '📝',
  'profile.banner': '🎨',
  email: '💌',
  'app-data': '📦',
  things: '🗂️'
};

const SANDBOX_USER: EmbedUser = { id: 'sandbox', username: 'you', displayName: 'You', avatarUrl: null };

const SANDBOX_THINGS: PickerThing[] = [
  { id: 'sandbox-thing-1', label: 'Sunset over the bay 🌅', detail: 'post' },
  { id: 'sandbox-thing-2', label: 'Reading list', detail: 'post' },
  { id: 'sandbox-thing-3', label: 'Garden watering notes 🌱', detail: 'post' }
];

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

// Client-side mirror of the server's ancestor-covers rule.
const coversPath = (scope: string, path: string) => scope === path || path.startsWith(`${scope}.`);
const anyCovers = (scopes: string[], path: string) => scopes.some((s) => coversPath(s, path));

const parseScopeList = (raw: string, catalog: ScopeDescriptor[]): string[] => {
  const known = new Set(catalog.map((s) => s.id));
  return raw
    .split(/[\s,+]+/)
    .filter(Boolean)
    .filter((id) => known.has(id))
    .filter((id, index, list) => list.indexOf(id) === index);
};

const cardSx = {
  flexDirection: 'column' as const,
  gap: 4,
  width: '420px',
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

const SandboxChip = () => (
  <Box
    alignSelf="flex-start"
    fontFamily="mono"
    fontSize="10px"
    fontWeight="700"
    letterSpacing="0.12em"
    padding="2px 8px"
    borderRadius="full"
    background="var(--tt-surface-alt, #f5f5f7)"
    border="1px dashed var(--tt-border, #d8d8de)"
    color="var(--tt-muted, #9a9aa6)"
  >
    SANDBOX · NOTHING IS REALLY SHARED
  </Box>
);

type ScopeRowProps = {
  scope: ScopeDescriptor;
  checked: boolean;
  locked: boolean;
  onChange: (checked: boolean) => void;
};

const ScopeRow = ({ scope, checked, locked, onChange }: ScopeRowProps) => (
  <Flex
    as="label"
    gap={3}
    alignItems="flex-start"
    padding={2}
    borderRadius="var(--tt-radius-sm, 9px)"
    cursor={locked ? 'default' : 'pointer'}
    _hover={locked ? undefined : { background: 'var(--tt-surface-alt, #f5f5f7)' }}
  >
    <input
      type="checkbox"
      checked={checked}
      disabled={locked}
      onChange={(event) => onChange(event.target.checked)}
      style={{ marginTop: '3px', accentColor: 'var(--tt-text, #1c1c22)' }}
    />
    <Box fontSize="14px">
      <Box as="span" fontWeight="600">
        {SCOPE_EMOJI[scope.id] || '🔐'} {scope.title}
      </Box>
      {locked ? (
        <Box as="span" fontSize="12px" color="var(--tt-muted, #9a9aa6)">
          {' '}
          · {scope.baseline ? 'always shared' : 'required by this app'}
        </Box>
      ) : null}
      <Box fontSize="13px" color="var(--tt-muted, #9a9aa6)">
        {scope.description}
      </Box>
    </Box>
  </Flex>
);

export const AuthorizePage = () => {
  // A framed consent screen is always hostile: the SDK opens a POPUP (token
  // delivery needs window.opener), so the only reason this page sits in an
  // iframe is a UI-redress attempt. Production also frame-denies /authorize
  // via response headers (scripts/patch-vercel-output.mjs); this guard covers
  // dev servers and any host that loses that header config.
  const framed = typeof window !== 'undefined' && window.self !== window.top;

  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const clientId = (params.get('client_id') || params.get('clientId') || '').trim();
  const origin = (params.get('origin') || '').trim();
  const state = (params.get('state') || '').slice(0, MAX_STATE_CHARS);
  const scopeParam = (params.get('scope') || '').slice(0, 1024);
  const optionalScopeParam = (params.get('optional_scope') || '').slice(0, 1024);
  const extrasAllowed = params.get('extra') !== '0';
  const sandbox = params.get('sandbox') === '1';

  const [catalog, setCatalog] = React.useState<ScopeDescriptor[]>([]);
  const [defaultScopes, setDefaultScopes] = React.useState<string[]>([]);
  const [app, setApp] = React.useState<EmbedApp | null>(null);
  const [verifiedOrigin, setVerifiedOrigin] = React.useState<string | null>(null);
  const [requiredScopes, setRequiredScopes] = React.useState<ScopeDescriptor[]>([]);
  const [optionalScopes, setOptionalScopes] = React.useState<ScopeDescriptor[]>([]);
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [showExtras, setShowExtras] = React.useState(false);
  const [invalidReason, setInvalidReason] = React.useState<string | null>(null);
  const [networkFailed, setNetworkFailed] = React.useState(false);
  const [user, setUser] = React.useState<EmbedUser | null>(null);
  const [checkedAuth, setCheckedAuth] = React.useState(false);
  const [mode, setMode] = React.useState<'login' | 'register'>('login');
  const [issuing, setIssuing] = React.useState(false);
  const [done, setDone] = React.useState<'approved' | 'cancelled' | null>(null);
  const [issueError, setIssueError] = React.useState<string | null>(null);
  const [pickerThings, setPickerThings] = React.useState<PickerThing[] | null>(null);
  const [pickerError, setPickerError] = React.useState(false);
  const [pickedThings, setPickedThings] = React.useState<Record<string, boolean>>({});

  // ---- boot: catalog (+ app validation in real mode, auth probe) -----------

  React.useEffect(() => {
    fetchJson('/api/v1/oauth/scopes').then((resp) => {
      if (resp?.ok && Array.isArray(resp.scopes)) {
        setCatalog(resp.scopes);
        setDefaultScopes(Array.isArray(resp.defaults) ? resp.defaults : []);
      } else {
        setNetworkFailed(!!resp?.network);
        setInvalidReason(resp?.error || 'Could not load the permission catalog.');
      }
    });

    if (sandbox) {
      // Sandbox NEVER resolves the real account. It runs entirely on the mock
      // SANDBOX_USER, so even though the origin here is unvalidated (it's a UI
      // demo, not a real grant), no real identity or data can ever be posted
      // to it. Calling /api/v1/auth/me here would leak the real logged-in
      // user's id + username to an arbitrary opener — the exact thing the
      // "nothing is really shared" promise forbids.
      setCheckedAuth(true);
      return;
    }

    if (!clientId || !origin) {
      setInvalidReason('This link is missing its app details (client_id and origin).');
      return;
    }

    fetchJson(
      `/api/v1/apps/public?clientId=${encodeURIComponent(clientId)}&origin=${encodeURIComponent(origin)}` +
        `&scope=${encodeURIComponent(scopeParam)}&optional_scope=${encodeURIComponent(optionalScopeParam)}`
    ).then((resp) => {
      if (resp?.ok && resp.app) {
        setApp(resp.app);
        setVerifiedOrigin(resp.origin);
        setRequiredScopes(Array.isArray(resp.requiredScopes) ? resp.requiredScopes : []);
        setOptionalScopes(Array.isArray(resp.optionalScopes) ? resp.optionalScopes : []);
      } else {
        setNetworkFailed(!!resp?.network);
        setInvalidReason(resp?.error || 'This app could not be verified.');
      }
    });

    // Always resolves (fetchJson never rejects); a failed auth probe just
    // means "not logged in yet" — the login form handles it from there.
    fetchJson('/api/v1/auth/me').then((resp) => {
      if (resp?.user) setUser(resp.user);
      setCheckedAuth(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sandbox mode builds its "app" + scope sets client-side from the catalog —
  // the pretend app is named after the demo's clientId text.
  React.useEffect(() => {
    if (!sandbox || !catalog.length) return;

    setApp({ clientId: clientId || 'sandbox', name: clientId && !clientId.startsWith('ttapp_') ? clientId : 'Your App' });
    try {
      setVerifiedOrigin(origin ? new URL(origin).origin : null);
    } catch {
      setVerifiedOrigin(null);
    }

    const baseline = catalog.filter((s) => s.baseline).map((s) => s.id);
    const requestedRequired = scopeParam ? parseScopeList(scopeParam, catalog) : [...defaultScopes];
    const requiredIds = [...baseline.filter((b) => !anyCovers(requestedRequired, b)), ...requestedRequired];
    const optionalIds = parseScopeList(optionalScopeParam, catalog).filter((id) => !anyCovers(requiredIds, id));

    const byId = new Map(catalog.map((s) => [s.id, s]));
    setRequiredScopes(requiredIds.map((id) => byId.get(id)).filter(Boolean) as ScopeDescriptor[]);
    setOptionalScopes(optionalIds.map((id) => byId.get(id)).filter(Boolean) as ScopeDescriptor[]);
  }, [sandbox, catalog, defaultScopes, clientId, origin, scopeParam, optionalScopeParam]);

  // Requested scopes start ticked (required ones are locked); extras start off.
  React.useEffect(() => {
    setSelected((prev) => {
      const next: Record<string, boolean> = { ...prev };
      for (const scope of requiredScopes) next[scope.id] = true;
      for (const scope of optionalScopes) if (next[scope.id] === undefined) next[scope.id] = true;
      return next;
    });
  }, [requiredScopes, optionalScopes]);

  const requiredIds = React.useMemo(() => requiredScopes.map((s) => s.id), [requiredScopes]);
  const optionalIds = React.useMemo(() => optionalScopes.map((s) => s.id), [optionalScopes]);

  // The grant the user is currently composing.
  const selection = React.useMemo(
    () => [
      ...requiredIds,
      ...Object.keys(selected).filter((id) => selected[id] && !requiredIds.includes(id))
    ],
    [requiredIds, selected]
  );

  // "Share more" candidates: leaf/capability/picker scopes neither the
  // required nor the optional set already covers (namespaces stay out — the
  // fields say it better). Coverage, not exact id, so a leaf whose ancestor is
  // already offered never double-appears.
  const extraScopes = React.useMemo(
    () =>
      catalog.filter(
        (scope) =>
          scope.kind !== 'namespace' &&
          !scope.baseline &&
          !anyCovers(requiredIds, scope.id) &&
          !anyCovers(optionalIds, scope.id)
      ),
    [catalog, requiredIds, optionalIds]
  );

  const thingsActive = React.useMemo(() => anyCovers(selection, 'things'), [selection]);

  // ---- things picker -------------------------------------------------------

  React.useEffect(() => {
    if (!thingsActive || pickerThings !== null) return;

    if (sandbox) {
      // Sandbox always uses mock things — it never reads the real account.
      setPickerThings(SANDBOX_THINGS);
      return;
    }
    if (!user) return;

    // The server clamps each page to its own max (currently 50), so a single
    // request can't fill the 100-thing share cap — follow nextCursor until we
    // have MAX_PICKER_THINGS or run out of posts.
    let cancelled = false;
    (async () => {
      const posts: any[] = [];
      let cursor: string | null = null;
      let failed = false;
      do {
        const url =
          `/api/v1/things/user?username=${encodeURIComponent(user.username)}&limit=${MAX_PICKER_THINGS}` +
          (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
        const resp = await fetchJson(url);
        if (cancelled) return;
        if (!resp?.ok || !Array.isArray(resp.posts)) {
          failed = true;
          break;
        }
        posts.push(...resp.posts);
        cursor = typeof resp.nextCursor === 'string' && resp.nextCursor ? resp.nextCursor : null;
      } while (cursor && posts.length < MAX_PICKER_THINGS);

      // Distinguish "no things" from "couldn't load" — a failed fetch must
      // not masquerade as an empty Thingtime (with a retry, not a dead end).
      // A mid-pagination failure surfaces the retry banner rather than
      // silently passing off a partial list as everything.
      setPickerError(failed);
      setPickerThings(
        posts.slice(0, MAX_PICKER_THINGS).map((post: any) => ({
          id: String(post.id ?? post.shareId ?? ''),
          label:
            (typeof post.text === 'string' && post.text.trim().slice(0, 60)) ||
            (typeof post.crystal?.text === 'string' && post.crystal.text.trim().slice(0, 60)) ||
            (Array.isArray(post.tags) && post.tags.length ? `#${post.tags[0]}` : 'Untitled thing'),
          detail: Array.isArray(post.thingtime) ? post.thingtime.join(' + ') : post.type || 'thing'
        })).filter((thing: PickerThing) => thing.id)
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [thingsActive, pickerThings, sandbox, user]);

  const pickedIds = React.useMemo(
    () => Object.keys(pickedThings).filter((id) => pickedThings[id]),
    [pickedThings]
  );

  // ---- approve / cancel ----------------------------------------------------

  const postToOpener = (payload: Record<string, unknown>) => {
    // targetOrigin is the server-normalized origin — the token can only land
    // on the exact embedding page the flow started from, even if the opener
    // navigated elsewhere.
    if (typeof window !== 'undefined' && window.opener && verifiedOrigin) {
      window.opener.postMessage({ ...payload, state }, verifiedOrigin);
      return true;
    }
    return false;
  };

  const activeUser = user || (sandbox ? SANDBOX_USER : null);

  const approve = async () => {
    if (!app || issuing) return;
    setIssuing(true);
    setIssueError(null);

    if (sandbox) {
      // Mirror the server's scope gating: even a pretend handoff only carries
      // the fields the selection covers — never the raw /auth/me object.
      postToOpener({
        type: 'thingtime:login',
        ok: true,
        sandbox: true,
        token: 'tt-sandbox-token',
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
        scopes: selection,
        sharedThings: thingsActive ? pickedIds.length : 0,
        user: {
          id: activeUser.id,
          username: activeUser.username,
          ...(anyCovers(selection, 'profile.displayName') ? { displayName: activeUser.displayName ?? null } : {}),
          ...(anyCovers(selection, 'profile.avatar') ? { avatarUrl: activeUser.avatarUrl ?? null } : {})
        }
      });
      setDone('approved');
      setIssuing(false);
      setTimeout(() => window.close(), 700);
      return;
    }

    // Don't mint a grant we can't deliver: if the opener is gone (popup opened
    // directly, or the embedding page closed), the token would be issued into
    // the void while the user sees a false "signed in".
    if (!verifiedOrigin || typeof window === 'undefined' || !window.opener) {
      setIssueError('This window lost its connection to the app that opened it. Close it and start the sign-in again from the app.');
      setIssuing(false);
      return;
    }

    const resp = await fetchJson('/api/v1/oauth/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: app.clientId,
        origin: verifiedOrigin,
        scope: scopeParam,
        optionalScope: optionalScopeParam,
        extra: extrasAllowed ? '1' : '0',
        scopes: selection,
        sharedThings: thingsActive ? pickedIds : []
      })
    });

    if (resp?.ok && resp.token) {
      const delivered = postToOpener({
        type: 'thingtime:login',
        ok: true,
        token: resp.token,
        tokenType: resp.tokenType,
        expiresAt: resp.expiresAt,
        scopes: resp.scopes,
        sharedThings: resp.sharedThings,
        user: resp.user
      });
      if (delivered) {
        setDone('approved');
        setTimeout(() => window.close(), 400);
      } else {
        // Opener vanished during the mint: the grant now exists (listed under
        // Connected apps) but the app never received it — say so instead of
        // showing a false "signed in".
        setIssueError(
          'The app window closed before the sign-in could be handed over. Close this window and start again from the app — no token was shared.'
        );
      }
    } else {
      setIssueError(resp?.error || 'Could not authorize — please try again.');
    }
    setIssuing(false);
  };

  const cancel = () => {
    postToOpener({ type: 'thingtime:login', ok: false, error: 'cancelled', ...(sandbox ? { sandbox: true } : {}) });
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

  // ---- render ---------------------------------------------------------------

  let body: React.ReactNode;

  if (framed) {
    body = (
      <Flex sx={cardSx}>
        <Kicker>Thingtime · Login with Thingtime</Kicker>
        <Box as="h1" fontSize="20px" fontWeight="700">
          This page can’t be embedded
        </Box>
        <Box color="var(--tt-muted, #9a9aa6)" fontSize="14px">
          Login with Thingtime only runs in its own popup window. Head back to the app and start the
          sign-in again.
        </Box>
      </Flex>
    );
  } else if (invalidReason) {
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
            If you run this site, register an app under Thingtime apps and use its clientId — any origin
            (even a preview URL) can open the login from there. Or try the sandbox from /sdk/demo.html.
          </Box>
        )}
      </Flex>
    );
  } else if (done) {
    body = (
      <Flex sx={cardSx} alignItems="flex-start">
        <Kicker>Thingtime · Login with Thingtime</Kicker>
        {sandbox ? <SandboxChip /> : null}
        <Box as="h1" fontSize="20px" fontWeight="700">
          {done === 'approved' ? (sandbox ? 'Sandbox login complete 🧪' : 'You’re signed in ✨') : 'Cancelled'}
        </Box>
        <Box color="var(--tt-muted, #9a9aa6)" fontSize="14px">
          {done === 'approved'
            ? sandbox
              ? 'A pretend token was handed back — no data actually left your account. This window will close itself.'
              : `You can head back to ${app?.name || 'the site'} — this window will close itself.`
            : 'Nothing was shared. You can close this window.'}
        </Box>
      </Flex>
    );
  } else if (!app || (!sandbox && !checkedAuth)) {
    // True cold start (fresh popup): a minimal frame, no spinner flash.
    body = (
      <Flex sx={cardSx}>
        <Kicker>Thingtime · Login with Thingtime</Kicker>
        <Box color="var(--tt-muted, #9a9aa6)" fontSize="14px">
          Checking this app…
        </Box>
      </Flex>
    );
  } else if (!activeUser) {
    body = (
      <Flex flexDirection="column" gap={3} width="420px" maxWidth="100%">
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
        {sandbox ? <SandboxChip /> : null}
        <Box as="h1" fontSize="20px" fontWeight="700" lineHeight="1.3">
          {app.name}
        </Box>
        <Box fontSize="14px" color="var(--tt-muted, #9a9aa6)">
          {originHost || 'This site'} wants to sign you in as{' '}
          <Box as="strong" color="var(--tt-text, #1c1c22)">
            @{activeUser.username}
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
          {requiredScopes.map((scope) => (
            <ScopeRow key={scope.id} scope={scope} checked locked onChange={() => {}} />
          ))}
          {optionalScopes.map((scope) => (
            <ScopeRow
              key={scope.id}
              scope={scope}
              checked={!!selected[scope.id]}
              locked={false}
              onChange={(checked) => setSelected((prev) => ({ ...prev, [scope.id]: checked }))}
            />
          ))}
        </Flex>

        {extrasAllowed && extraScopes.length ? (
          <Flex flexDirection="column" gap={1}>
            <Button
              variant="ghost"
              size="sm"
              alignSelf="flex-start"
              paddingX={2}
              fontWeight="600"
              color="var(--tt-muted, #9a9aa6)"
              onClick={() => setShowExtras((open) => !open)}
              aria-expanded={showExtras}
            >
              {showExtras ? '▾' : '▸'} Share more from your Thingtime ✨
            </Button>
            {showExtras ? (
              <Flex flexDirection="column" gap={1} role="group" aria-label="Share more from your Thingtime">
                {extraScopes.map((scope) => (
                  <ScopeRow
                    key={scope.id}
                    scope={scope}
                    checked={!!selected[scope.id]}
                    locked={false}
                    onChange={(checked) => setSelected((prev) => ({ ...prev, [scope.id]: checked }))}
                  />
                ))}
              </Flex>
            ) : null}
          </Flex>
        ) : null}

        {thingsActive ? (
          <Flex
            flexDirection="column"
            gap={1}
            padding={3}
            borderRadius="var(--tt-radius-md, 12px)"
            background="var(--tt-surface-alt, #f5f5f7)"
            role="group"
            aria-label="Pick things to share"
          >
            <Box fontSize="13px" fontWeight="600">
              🗂️ Pick the things to share ({pickedIds.length} selected)
            </Box>
            <Box fontSize="12px" color="var(--tt-muted, #9a9aa6)">
              Only the things you tick here are shared — read-only, just with this app.
            </Box>
            {pickerThings === null ? (
              <Box fontSize="13px" color="var(--tt-muted, #9a9aa6)" paddingY={1}>
                Loading your things…
              </Box>
            ) : pickerError ? (
              <Flex gap={2} alignItems="center" paddingY={1}>
                <Box fontSize="13px" color="var(--tt-muted, #9a9aa6)">
                  Couldn’t load your things.
                </Box>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    setPickerError(false);
                    setPickerThings(null);
                  }}
                >
                  Retry
                </Button>
              </Flex>
            ) : pickerThings.length ? (
              <Flex flexDirection="column" maxHeight="160px" overflowY="auto">
                {pickerThings.map((thing) => (
                  <Flex
                    key={thing.id}
                    as="label"
                    gap={2}
                    alignItems="center"
                    paddingY={1}
                    cursor="pointer"
                    fontSize="13px"
                  >
                    <input
                      type="checkbox"
                      checked={!!pickedThings[thing.id]}
                      onChange={(event) =>
                        setPickedThings((prev) => ({ ...prev, [thing.id]: event.target.checked }))
                      }
                      style={{ accentColor: 'var(--tt-text, #1c1c22)' }}
                    />
                    <Box as="span" noOfLines={1}>
                      {thing.label}
                    </Box>
                    <Box as="span" fontSize="11px" color="var(--tt-muted, #9a9aa6)" flexShrink={0}>
                      {thing.detail}
                    </Box>
                  </Flex>
                ))}
              </Flex>
            ) : (
              <Box fontSize="13px" color="var(--tt-muted, #9a9aa6)" paddingY={1}>
                Nothing to share yet — your Thingtime is empty.
              </Box>
            )}
          </Flex>
        ) : null}

        <Flex gap={2} alignItems="center" fontSize="13px" color="var(--tt-muted, #9a9aa6)">
          <Box>🔒</Box>
          <Box>It only ever gets what’s ticked above — never your password, posts, or other apps’ data.</Box>
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
            Continue as @{activeUser.username}
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
      minHeight="100dvh"
      background="var(--tt-surface, #fafafb)"
      paddingX={4}
      paddingY={4}
    >
      {body}
    </Flex>
  );
};

export default AuthorizePage;
