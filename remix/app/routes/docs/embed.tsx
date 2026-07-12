import {
  Badge,
  Box,
  Flex,
  Heading,
  Link as ChakraLink,
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

// /docs/embed — the "Login with Thingtime" integration guide for platforms:
// SDK quick start, themed button config, permission scopes, token usage
// (userinfo + app-data), and the security model. The API-level reference for
// each endpoint lives in /docs/api under the `embed` group.

const CodeBlock = ({ children }: { children: string }) => (
  <Box
    as="pre"
    fontFamily="mono"
    fontSize="13px"
    lineHeight="1.6"
    background="var(--tt-surface-alt, #f5f5f7)"
    border="1px solid var(--tt-border, #ececef)"
    borderRadius="var(--tt-radius-md, 12px)"
    padding={4}
    overflowX="auto"
    whiteSpace="pre"
  >
    {children}
  </Box>
);

const SCOPE_ROWS = [
  {
    id: 'profile',
    shares: 'Username, display name, avatar (+ profileUrl link)',
    notes: 'Always granted — it IS the login identity.'
  },
  {
    id: 'email',
    shares: 'The email address on the Thingtime account',
    notes: 'Optional; returned by /oauth/userinfo only when granted.'
  },
  {
    id: 'app-data',
    shares: 'Read/write the app’s OWN key/value data for this user',
    notes: 'Optional; /api/v1/app-data* returns 403 without it.'
  }
];

export default function DocsEmbed() {
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
        <Heading size="md">1 · Register your app</Heading>
        <Text>
          While logged in to Thingtime, register an app with a name and the exact origins your site runs
          on. The server mints your public <code>clientId</code>. Origins must be bare https origins
          (http is allowed for localhost dev) — the login popup only ever hands tokens to origins on
          this allowlist.
        </Text>
        <CodeBlock>{`curl -X POST https://thingtime.com/api/v1/apps \\
  -H 'Authorization: Bearer <your-thingtime-token>' \\
  -H 'Content-Type: application/json' \\
  -d '{ "name": "Rainbow Notes", "origins": ["https://rainbownotes.example"] }'

// → { "ok": true, "app": { "clientId": "ttapp_…", … } }`}</CodeBlock>
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
        <Heading size="md">2 · Drop in the button</Heading>
        <Text>
          Load the SDK from Thingtime and render the styled button. Clicking it opens the Thingtime
          login popup (or new tab on mobile browsers that force it); the user logs in or registers,
          reviews the permissions you asked for, and approves.
        </Text>
        <CodeBlock>{`<script src="https://thingtime.com/sdk/thingtime-login.js"></script>
<div id="thingtime-login"></div>
<script>
  Thingtime.renderButton(document.getElementById('thingtime-login'), {
    clientId: 'ttapp_…',
    scopes: ['profile', 'email', 'app-data'],  // what you'd like (user chooses)
    theme: 'light',                             // 'light' | 'dark' | 'rainbow'
    size: 'md',                                 // 'sm' | 'md' | 'lg'
    text: 'Login with Thingtime',               // optional custom label
    onLogin: function (session) {
      // session.token     — Bearer token for the APIs below (30 days, revocable)
      // session.scopes    — what the user ACTUALLY granted
      // session.user      — { id, username, displayName, avatarUrl }
      // session.expiresAt — ISO timestamp
    },
    onError: function (error) { /* 'cancelled', popup blocked, … */ }
  });
</script>`}</CodeBlock>
        <Text>
          Prefer your own button? Call{' '}
          <code>Thingtime.login({'{ clientId, scopes }'})</code> from a click handler — it returns a
          Promise of the same session object. (It must run in a user gesture or the popup will be
          blocked.)
        </Text>
      </Stack>

      <Stack spacing={3}>
        <Heading size="md">3 · Permissions (scopes)</Heading>
        <Text>
          You configure the scopes your button asks for; the consent screen renders them as a
          selector where the user ticks what they’re happy to share. Your grant is the
          intersection — consent can narrow your request, never widen it. Always read{' '}
          <code>session.scopes</code> to see what you got.
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
        <Heading size="md">4 · Use the token</Heading>
        <Text>
          <strong>Identity (SSO):</strong> resolve who the token belongs to — call it any time to sync
          the account on your side. Works from your site’s JS (CORS is bound to your origin) or your
          server.
        </Text>
        <CodeBlock>{`Thingtime.userinfo(session.token).then(function (info) {
  // info.user  → { id, username, displayName, avatarUrl, profileUrl, email? }
  // info.scopes → e.g. ['profile', 'email']
});

// or raw: GET https://thingtime.com/api/v1/oauth/userinfo
//         Authorization: Bearer <token>`}</CodeBlock>
        <Text>
          <strong>App storage:</strong> keep your per-user data (settings, saves, progress…) in the
          user’s Thingtime account — your app can only ever see its own keys.
        </Text>
        <CodeBlock>{`var data = Thingtime.data(session.token);
data.set('preferences', { theme: 'rainbow' });   // any JSON ≤ 32KB, ≤ 200 keys/user
data.get('preferences').then(function (value) { … });
data.list();                                     // [{ key, value, updatedAt }, …]
data.remove('preferences');`}</CodeBlock>
      </Stack>

      <Stack spacing={3}>
        <Heading size="md">Security model</Heading>
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
        <Heading size="md">Try it</Heading>
        <Text>
          A live playground ships at{' '}
          <ChakraLink href="/sdk/demo.html" color="var(--tt-docs-accent-ink, #0f5132)" isExternal>
            /sdk/demo.html
          </ChakraLink>{' '}
          — register an app with that page’s origin, paste your clientId, and run the whole
          login → consent → storage loop.
        </Text>
      </Stack>
    </Stack>
  );
}
