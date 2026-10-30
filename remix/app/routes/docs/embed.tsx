import React from 'react';
import {
  Badge,
  Box,
  Flex,
  Heading,
  Link as ChakraLink,
  Select,
  Stack,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr
} from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router';

import { CodeWindow, WindowTrafficLights } from './docsCode';
import { embedGuideSection, type EmbedGuideSection } from './embedSections';
import { useDocsAnchorScroll } from './useDocsAnchorScroll';

// Section headings render from the shared spine (embedSections.ts) so anchors,
// titles, and the docs search index stay in lockstep; the bodies below each
// heading stay hand-crafted.
function GuideHeading({ section }: { section: EmbedGuideSection }) {
  return (
    <Heading id={section.id} scrollMarginTop="112px" size="md">
      {section.title}
    </Heading>
  );
}

// /docs/embed — the "Login with Thingtime" integration guide for platforms:
// SDK quick start, themed button config, permission scopes, token usage
// (userinfo + app-data), and the security model. The API-level reference for
// each endpoint lives in /docs/api under the `embed` group.

const REGISTER_APP_CODE = `curl -X POST https://thingtime.com/api/v1/apps \\
  -H 'Authorization: Bearer <your-thingtime-token>' \\
  -H 'Content-Type: application/json' \\
  -d '{ "name": "Rainbow Notes", "origins": ["https://rainbownotes.example"] }'

// → { "ok": true, "app": { "clientId": "ttapp_…", … } }`;

const QUICK_START_CODE = `<script src="https://thingtime.com/sdk/thingtime-login.js"></script>
<div id="thingtime-login"></div>
<script>
  Thingtime.renderButton(document.getElementById('thingtime-login'), {
    clientId: 'ttapp_…',
    scopes: ['profile.username', 'app-data'],      // REQUIRED — user can't untick, only cancel
    optionalScopes: ['email', 'profile.avatar'],   // nice-to-have — user decides
    allowExtra: true,                              // user may volunteer MORE (default true)
    theme: 'light',                                // 'light' | 'dark' | 'rainbow'
    size: 'md',                                    // 'sm' | 'md' | 'lg'
    text: 'Login with Thingtime',                  // optional custom label
    onLogin: function (session) {
      // session.token        — Bearer token for the APIs below (30 days, revocable)
      // session.scopes       — what the user ACTUALLY granted (may exceed your ask!)
      // session.sharedThings — how many things they hand-picked for you
      // session.user         — identity, shaped by the granted scopes
    },
    onError: function (error) { /* 'cancelled', popup blocked, … */ }
  });
</script>`;

const USERINFO_CODE = `Thingtime.userinfo(session.token).then(function (info) {
  // info.user   → id, username, profileUrl — plus displayName / avatarUrl /
  //               bio / bannerUrl / email, each present ONLY if its scope
  //               was granted (the response mirrors the consent screen)
  // info.scopes → e.g. ['profile.username', 'profile.avatar', 'email']
});

// or raw: GET https://thingtime.com/api/v1/oauth/userinfo
//         Authorization: Bearer <token>`;

const SHARED_THINGS_CODE = `Thingtime.shared(session.token).then(function (things) {
  // [{ shareId, thingtime, crystal, tags, createdAt, updatedAt }, …]
  // Exactly the set the user ticked on the consent screen — nothing else.
});`;

const APP_STORAGE_CODE = `var data = Thingtime.data(session.token);
data.set('preferences', { theme: 'rainbow' });   // any JSON value ≤ 32 KiB
data.get('preferences').then(function (value) { … });
data.list();                                     // [{ key, value, visibility, updatedAt }, …]
data.remove('preferences');

// SHARED entries ('app-data.shared' scope): visible to other users of YOUR
// app — never other apps, never the public web. Opt-in per entry on write:
data.set('post:2026-07-27', { text: 'Miso soup 🍲' }, { visibility: 'app' });
data.shared({ key: 'post:*', limit: 20 }).then(function (page) {
  // page.entries → [{ key, value, updatedAt, createdAt, author }, …] newest
  //   first; author = { id, username, displayName?, avatarUrl? } — shaped by
  //   what THAT author granted, like /oauth/userinfo
  // page.nextCursor → pass back as { cursor } until null
});
// Revoking the grant pulls a user's shared entries from the feed instantly.`;

const SCOPE_ROWS = [
  {
    id: 'profile.username',
    shares: 'The @username (+ id + profileUrl link)',
    notes: 'Baseline — always granted; it IS the login identity.'
  },
  {
    id: 'profile.displayName · .avatar · .bio · .banner',
    shares: 'Individual profile fields, each its own permission',
    notes: 'Granular — ask for exactly the fields you need.'
  },
  {
    id: 'profile',
    shares: 'The whole public profile (covers every non-exact profile.* leaf)',
    notes: 'Ancestors cover descendants — new leaves join automatically.'
  },
  {
    id: 'profile.birthday',
    shares: 'The birth date (YYYY-MM-DD) on the account',
    notes: 'EXACT consent — private data, so even a full profile grant does NOT imply it; request it explicitly.'
  },
  {
    id: 'email',
    shares: 'The email address on the Thingtime account',
    notes: 'Returned by /oauth/userinfo only when granted.'
  },
  {
    id: 'app-data',
    shares: 'Read/write the app’s OWN key/value data for this user',
    notes: '/api/v1/app-data* returns 403 without it.'
  },
  {
    id: 'app-data.shared',
    shares: 'Entries the app marks shared become readable by OTHER users of the same app',
    notes: 'EXACT consent — app-data does NOT imply it; request it explicitly. Opt-in per entry on write.'
  },
  {
    id: 'things',
    shares: 'Read-only access to specific things the user hand-picks',
    notes: 'The consent screen shows a picker; read them via /oauth/shared.'
  }
];

// --- Live sandbox preview -----------------------------------------------

type SandboxSession = {
  expiresAt?: string;
  sandbox?: boolean;
  scopes?: string[];
  sharedThings?: number;
  user?: Record<string, unknown>;
};

type ThingtimeSdk = {
  renderButton: (el: HTMLElement, options: Record<string, unknown>) => HTMLButtonElement;
};

const getSdk = () =>
  typeof window === 'undefined' ? undefined : (window as unknown as { Thingtime?: ThingtimeSdk }).Thingtime;

// Load /sdk/thingtime-login.js once — the exact script third-party sites use —
// so the docs preview exercises the real SDK, not a lookalike.
type SdkState = 'loading' | 'ready' | 'failed';

const useThingtimeSdk = (): SdkState => {
  const [state, setState] = React.useState<SdkState>(() =>
    getSdk()?.renderButton ? 'ready' : 'loading'
  );

  React.useEffect(() => {
    if (state !== 'loading') return undefined;

    const existing = document.querySelector<HTMLScriptElement>('script[data-thingtime-sdk]');
    const script = existing || document.createElement('script');
    // 'load' fired but no global = the script served but isn't the SDK.
    const onLoad = () => setState(getSdk()?.renderButton ? 'ready' : 'failed');
    const onError = () => setState('failed');

    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);

    if (!existing) {
      script.async = true;
      script.dataset.thingtimeSdk = '';
      script.src = '/sdk/thingtime-login.js';
      document.head.appendChild(script);
    } else if (getSdk()?.renderButton) {
      setState('ready');
    }

    // Only the pre-existing-tag path needs a stuck-state exit: its 'error'
    // may have fired before we attached, so no event will ever come. A fresh
    // injection reliably settles via load/error — no timer, so a slow network
    // keeps "Loading…" instead of being falsely failed at an arbitrary cutoff.
    const timer = existing
      ? window.setTimeout(() => setState(getSdk()?.renderButton ? 'ready' : 'failed'), 10000)
      : undefined;

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };
  }, [state]);

  return state;
};

const BUTTON_THEMES = ['light', 'dark', 'rainbow'] as const;
const BUTTON_SIZES = ['sm', 'md', 'lg'] as const;

// A faux-browser frame around the real SDK button: clicking it opens the
// actual /authorize consent popup in sandbox mode (pretend token, nothing
// shared) — the same flow demo.html drives with a non-ttapp_ clientId.
function LoginButtonPreview() {
  const sdkState = useThingtimeSdk();
  const ready = sdkState === 'ready';
  const mountRef = React.useRef<HTMLDivElement | null>(null);
  const [theme, setTheme] = React.useState<(typeof BUTTON_THEMES)[number]>('light');
  const [size, setSize] = React.useState<(typeof BUTTON_SIZES)[number]>('md');
  const [result, setResult] = React.useState<{ label: string; code: string } | null>(null);

  React.useEffect(() => {
    const sdk = getSdk();
    const mount = mountRef.current;

    if (!ready || !sdk?.renderButton || !mount) return undefined;

    mount.innerHTML = '';
    sdk.renderButton(mount, {
      clientId: 'Your App',
      scopes: ['profile.username', 'app-data'],
      optionalScopes: ['email', 'profile.avatar'],
      sandbox: true,
      size,
      theme,
      onLogin: (session: SandboxSession) =>
        setResult({
          label: 'sandbox logged in',
          code: JSON.stringify(
            {
              user: session.user,
              scopes: session.scopes,
              sharedThings: session.sharedThings,
              sandbox: session.sandbox,
              expiresAt: session.expiresAt
            },
            null,
            2
          )
        }),
      onError: (error: unknown) =>
        setResult({
          label: 'login error',
          code: JSON.stringify({ error: String((error as Error)?.message || error) }, null, 2)
        })
    });

    return () => {
      mount.innerHTML = '';
    };
  }, [ready, size, theme]);

  return (
    <Box
      border="2px solid"
      borderColor="var(--tt-border, #ececef)"
      borderRadius="var(--tt-radius-md, 12px)"
      overflow="hidden"
    >
      <Flex
        align="center"
        bg="var(--tt-surface-alt, #f5f5f7)"
        borderBottom="1px solid"
        borderColor="var(--tt-border, #ececef)"
        gap={3}
        px={3}
        py={2}
      >
        <WindowTrafficLights />
        <Box
          bg="var(--tt-surface, #ffffff)"
          border="1px solid"
          borderColor="var(--tt-border, #ececef)"
          borderRadius="full"
          color="var(--tt-muted, #9a9aa6)"
          flex="1"
          fontFamily="var(--tt-font-mono, ui-monospace, Menlo, monospace)"
          fontSize="12px"
          minW={0}
          noOfLines={1}
          px={3}
          py={1}
        >
          https://rainbownotes.example
        </Box>
        <Badge
          bg="var(--tt-docs-accent-soft, #d7f5df)"
          borderRadius="sm"
          color="var(--tt-docs-accent-ink, #0f5132)"
          flexShrink={0}
          px={2}
        >
          🧪 sandbox
        </Badge>
      </Flex>
      <Stack bg="var(--tt-surface, #ffffff)" p={{ base: 4, md: 6 }} spacing={4}>
        <Flex align="center" gap={3} wrap="wrap">
          <Select
            aria-label="Button theme"
            maxW="130px"
            onChange={(event) => setTheme(event.target.value as (typeof BUTTON_THEMES)[number])}
            size="sm"
            value={theme}
          >
            {BUTTON_THEMES.map((value) => (
              <option key={value} value={value}>
                theme: {value}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Button size"
            maxW="110px"
            onChange={(event) => setSize(event.target.value as (typeof BUTTON_SIZES)[number])}
            size="sm"
            value={size}
          >
            {BUTTON_SIZES.map((value) => (
              <option key={value} value={value}>
                size: {value}
              </option>
            ))}
          </Select>
        </Flex>
        <Flex align="center" minH="52px">
          <Box ref={mountRef} />
          {sdkState === 'loading' ? (
            <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
              Loading the SDK…
            </Text>
          ) : null}
          {sdkState === 'failed' ? (
            <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
              Couldn&apos;t load the SDK (blocked or offline) — try the{' '}
              <ChakraLink as={RouterLink} textDecoration="underline" to="/sdk/demo.html" reloadDocument>
                standalone demo
              </ChakraLink>{' '}
              instead.
            </Text>
          ) : null}
        </Flex>
        <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
          This is the real SDK button — clicking it opens the actual consent popup in{' '}
          <strong>sandbox mode</strong>: the full permissions UI with a pretend token, nothing really
          shared. The session it hands back lands below.
        </Text>
        {result ? (
          <CodeWindow language="json" maxH="280px" title={`onLogin → ${result.label}`}>
            {result.code}
          </CodeWindow>
        ) : null}
      </Stack>
    </Box>
  );
}

export default function DocsEmbed() {
  // docs search deep-links sections here (/docs/embed#permissions-scopes …)
  useDocsAnchorScroll();

  return (
    <Stack spacing={8} maxW="860px" minW={0}>
      <Box borderBottom="1px solid" borderColor="var(--tt-border, #ececef)" pb={6}>
        <Flex align="center" gap={2} mb={4} wrap="wrap">
          <Badge
            bg="var(--tt-docs-accent-soft, #d7f5df)"
            borderRadius="sm"
            color="var(--tt-docs-accent-ink, #0f5132)"
            px={2}
          >
            Embed
          </Badge>
          <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm" fontFamily="mono">
            /docs/embed
          </Text>
          <ChakraLink
            color="var(--tt-docs-accent-ink, #0f5132)"
            fontFamily="mono"
            fontSize="sm"
            fontWeight="700"
            href="/sdk/demo.html"
            isExternal
          >
            /sdk/demo.html · live demo ↗
          </ChakraLink>
        </Flex>
        <Heading size="lg" mb={3}>
          Login with Thingtime 🌈
        </Heading>
        <Text color="var(--tt-muted, #9a9aa6)" fontSize="md">
          Add a single button to your site and let your users sign in with their Thingtime account —
          Thingtime becomes the identity provider, and your platform gets a revocable, permission-scoped
          token to recognise the user, read the profile they chose to share, and store your app’s data
          in their Thingtime account.
        </Text>
      </Box>

      <Stack spacing={3}>
        <GuideHeading section={embedGuideSection.registerYourApp} />
        <Text>
          While logged in to Thingtime, register an app with a name and the exact origins your site runs
          on. The server mints your public <code>clientId</code>. Origins must be bare https origins
          (http is allowed for localhost dev) — the login popup only ever hands tokens to origins on
          this allowlist.
        </Text>
        <CodeWindow language="shell" title="terminal — register your app">
          {REGISTER_APP_CODE}
        </CodeWindow>
        <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
          Manage apps with <code>GET /api/v1/apps</code>, <code>/api/v1/apps/update</code>, and{' '}
          <code>/api/v1/apps/delete</code> (deleting an app revokes every token it minted). Full
          endpoint reference:{' '}
          <ChakraLink as={RouterLink} to="/docs/api/embed" color="var(--tt-docs-accent-ink, #0f5132)">
            /docs/api · embed group
          </ChakraLink>
          .
        </Text>
      </Stack>

      <Stack spacing={3}>
        <GuideHeading section={embedGuideSection.dropInTheButton} />
        <Text>
          Load the SDK from Thingtime and render the styled button. Clicking it opens the Thingtime
          login popup (or new tab on mobile browsers that force it); the user logs in or registers,
          reviews the permissions you asked for, and approves.
        </Text>
        <CodeWindow language="html" title="index.html">
          {QUICK_START_CODE}
        </CodeWindow>
        <Text>
          Prefer your own button? Call{' '}
          <code>Thingtime.login({'{ clientId, scopes, optionalScopes }'})</code> from a click handler —
          it returns a Promise of the same session object. (It must run in a user gesture or the popup
          will be blocked.) While building, add <code>sandbox: true</code> — the popup runs the full
          consent UI for <em>any</em> clientId (registered or not) and hands back a <strong>real
          working sandbox token</strong>: it drives <code>/app-data*</code>, the shared pool, and{' '}
          <code>userinfo</code> for an hour against a pretend account whose data is namespaced to that
          one token and auto-deleted. Nothing real is ever touched.
        </Text>
        <Text>
          No browser at all (scripts, AIs, CI)? Mint the same token headlessly —{' '}
          <code>
            POST /api/v1/oauth/sandbox {'{ clientId, origin, scope: "profile.username app-data" }'}
          </code>{' '}
          — anonymous and registration-free, and <code>GET /api/v1/apps/public?sandbox=1</code> answers
          the consent-shape lookup for any clientId. Code written against the sandbox works unchanged
          once you register the real app.
        </Text>
        <Text>
          Testing the <strong>multi-user shared feed</strong>? Mint several sandbox tokens with the
          same <code>space</code> (a pool secret you choose — use a uuid) and distinct{' '}
          <code>username</code>s: same-space sandboxes see each other&apos;s shared entries as
          separate pretend users (<code>sandbox-ada</code>, <code>sandbox-grace</code>, …), while
          private entries and other spaces stay isolated. In the popup, pass{' '}
          <code>sandboxSpace</code> / <code>sandboxUsername</code> to <code>Thingtime.login()</code>.
        </Text>
      </Stack>

      <Stack spacing={3}>
        <GuideHeading section={embedGuideSection.livePreview} />
        <Text>
          The snippet above, rendered for real — pick a theme and size, then click the button to open
          the sandbox login popup and walk the whole consent flow.
        </Text>
        <LoginButtonPreview />
      </Stack>

      <Stack spacing={3}>
        <GuideHeading section={embedGuideSection.permissionsScopes} />
        <Text>
          Scopes are <strong>hierarchical dot paths</strong> over the user’s data — ask for exactly
          the granularity you need (<code>profile.avatar</code>, not the whole profile). You declare a{' '}
          <strong>required</strong> floor (<code>scopes</code>) the user can’t untick — only cancel —
          and an <strong>optional</strong> set (<code>optionalScopes</code>) they decide on. And unless
          you pass <code>allowExtra: false</code>, the consent screen also lets the user{' '}
          <strong>volunteer more</strong> — extra profile fields, or a hand-picked set of their things
          — so a platform that reads <code>session.scopes</code> dynamically lights up features for
          whatever the user chose to bring. The live catalog:{' '}
          <code>GET /api/v1/oauth/scopes</code>.
        </Text>
        <Box overflowX="auto">
          <Table size="sm" variant="simple">
            <Thead>
              <Tr>
                <Th>Scope</Th>
                <Th>Shares</Th>
                <Th>Notes</Th>
              </Tr>
            </Thead>
            <Tbody>
              {SCOPE_ROWS.map((row) => (
                <Tr key={row.id}>
                  <Td fontFamily="mono" fontSize="13px" whiteSpace="nowrap">
                    {row.id}
                  </Td>
                  <Td>{row.shares}</Td>
                  <Td color="var(--tt-muted, #9a9aa6)">{row.notes}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Box>
      </Stack>

      <Stack spacing={3}>
        <GuideHeading section={embedGuideSection.useTheToken} />
        <Text>
          <strong>Identity (SSO):</strong> resolve who the token belongs to — call it any time to sync
          the account on your side. Works from your site’s JS (CORS is bound to your origin) or your
          server.
        </Text>
        <CodeWindow language="javascript" title="identity.js">
          {USERINFO_CODE}
        </CodeWindow>
        <Text>
          <strong>Shared things:</strong> when the user hand-picked things for you ('things' scope),
          read exactly those — read-only:
        </Text>
        <CodeWindow language="javascript" title="shared-things.js">
          {SHARED_THINGS_CODE}
        </CodeWindow>
        <Text>
          <strong>App storage:</strong> keep your per-user data (settings, saves, progress…) in the
          user’s Thingtime account — your app can only ever see its own namespace. Free starts at 5 GiB
          across all users and 50 MiB per app user. Owners and co-managers can upgrade the aggregate
          plan, change the default user cap, and assign individual user sub-tiers in{' '}
          <ChakraLink href="/apps/manage" color="var(--tt-docs-accent-ink, #0f5132)">
            the app manager
          </ChakraLink>
          ; read both live ledgers via <code>/api/v1/app-data/usage</code>.
        </Text>
        <CodeWindow language="javascript" title="app-storage.js">
          {APP_STORAGE_CODE}
        </CodeWindow>
      </Stack>

      <Stack spacing={3}>
        <GuideHeading section={embedGuideSection.securityModel} />
        <Stack spacing={2} fontSize="sm" color="var(--tt-muted, #9a9aa6)">
          <Text>
            🔑 App tokens are revocable Thingtime sessions scoped to your app — they are rejected by
            every normal Thingtime endpoint and can’t mint further tokens, read posts, or touch other
            apps’ data.
          </Text>
          <Text>
            🎯 The popup hands the token to your page via postMessage locked to your registered origin
            (never <code>*</code>), echoing the SDK’s random <code>state</code>; browser API calls are
            CORS-bound to the same origin.
          </Text>
          <Text>
            📦 Everything your app stores belongs to the user (they can inspect and delete it), and
            grants are revocable from both sides: you delete your app (<code>/api/v1/apps/delete</code>),
            or the user disconnects it (<code>/api/v1/oauth/grants/revoke</code>) — either way the token
            stops working immediately.
          </Text>
          <Text>
            🤫 The token is a bearer credential: origin binding protects browser contexts, but anyone
            holding the raw token can call the two app endpoints server-side until it expires or is
            revoked — treat it like a secret (don’t log it, don’t put it in URLs).
          </Text>
        </Stack>
      </Stack>

      <Stack spacing={3} pb={8}>
        <GuideHeading section={embedGuideSection.tryIt} />
        <Text>
          A live playground ships at{' '}
          <ChakraLink href="/sdk/demo.html" color="var(--tt-docs-accent-ink, #0f5132)" isExternal>
            /sdk/demo.html
          </ChakraLink>{' '}
          — it opens in <strong>sandbox mode</strong> out of the box (full consent + permissions UI,
          pretend token, nothing shared). Register an app with that page’s origin, paste your real{' '}
          <code>ttapp_…</code> clientId, and the same loop runs live.
        </Text>
      </Stack>
    </Stack>
  );
}
