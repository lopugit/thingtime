import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHATGPT_MCP_PATH,
  CHATGPT_MCP_METHOD_FEATURES,
  CHATGPT_MCP_TOOL_FEATURES,
  CHATGPT_PLUGIN_FEATURES,
  CHATGPT_PLUGIN_ROUTES,
  applyUpstreamQuery,
  isMcpResourceForOrigin,
  normalizeThingtimeEndpoint,
  normalizeDynamicClientRedirectUri,
  normalizeRegisteredClientRedirectUri,
  parseChatGptAuthorizationRequest,
  parseCredentialBundle,
  pluginDiscovery,
  renderConnectionPage
} from './pluginCore';

const validPkceChallenge = 'A'.repeat(43);
const validState = 'state-which-is-long-enough-to-be-safe';

test('ChatGPT OAuth request is tightly bound to this MCP resource and callback', () => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: 'https://chatgpt.com/oauth/client.json',
    redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    resource: `https://thingtime.com${CHATGPT_MCP_PATH}`,
    code_challenge: validPkceChallenge,
    code_challenge_method: 'S256',
    state: validState,
    scope: 'thingtime'
  });
  const parsed = parseChatGptAuthorizationRequest(params, 'https://thingtime.com');
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.request.resource, `https://thingtime.com${CHATGPT_MCP_PATH}`);
    assert.deepEqual(parsed.request.scope, ['thingtime']);
  }
  assert.equal(isMcpResourceForOrigin(`https://thingtime.com${CHATGPT_MCP_PATH}`, 'https://thingtime.com'), true);
  assert.equal(isMcpResourceForOrigin(`https://other.example${CHATGPT_MCP_PATH}`, 'https://thingtime.com'), false);

  params.set('client_id', 'https://chatgpt.com');
  assert.equal(parseChatGptAuthorizationRequest(params, 'https://thingtime.com').ok, true);
  params.set('client_id', 'https://chatgpt.com/oauth/client.json');
  params.set('scope', 'thingtime offline_access thingtime');
  const offlineAccess = parseChatGptAuthorizationRequest(params, 'https://thingtime.com');
  assert.equal(offlineAccess.ok, true);
  if (offlineAccess.ok) assert.deepEqual(offlineAccess.request.scope, ['thingtime', 'offline_access']);
  params.set('scope', 'thingtime unsupported');
  assert.equal(parseChatGptAuthorizationRequest(params, 'https://thingtime.com').ok, false);
  params.set('scope', 'thingtime');
  params.set('resource', 'https://attacker.invalid/api/v1/integrations/chatgpt/mcp');
  assert.equal(parseChatGptAuthorizationRequest(params, 'https://thingtime.com').ok, false);
  params.set('resource', `https://thingtime.com${CHATGPT_MCP_PATH}`);
  params.set('redirect_uri', 'https://attacker.invalid/callback');
  assert.equal(parseChatGptAuthorizationRequest(params, 'https://thingtime.com').ok, false);
});

test('Codex OAuth accepts only the matching ChatGPT CIMD loopback callback', () => {
  const callbackId = 'thingtime_mcp_AbC123';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: `https://chatgpt.com/oauth/codex/${callbackId}/client.json`,
    redirect_uri: `http://127.0.0.1:49152/callback/${callbackId}`,
    resource: `https://thingtime.com${CHATGPT_MCP_PATH}`,
    code_challenge: validPkceChallenge,
    code_challenge_method: 'S256',
    state: validState,
    scope: 'thingtime offline_access'
  });
  const parsed = parseChatGptAuthorizationRequest(params, 'https://thingtime.com');
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.request.redirectUri, `http://127.0.0.1:49152/callback/${callbackId}`);

  params.set('redirect_uri', 'http://127.0.0.1:49152/callback/attacker');
  assert.equal(parseChatGptAuthorizationRequest(params, 'https://thingtime.com').ok, false);
  params.set('redirect_uri', `http://localhost:49152/callback/${callbackId}`);
  assert.equal(parseChatGptAuthorizationRequest(params, 'https://thingtime.com').ok, false);
  params.set('redirect_uri', `http://127.0.0.1:49152/callback/${callbackId}?next=https://attacker.invalid`);
  assert.equal(parseChatGptAuthorizationRequest(params, 'https://thingtime.com').ok, false);
});

test('dynamic OAuth clients are bound to registered loopback or exact ChatGPT callbacks only', () => {
  const redirectUri = 'http://127.0.0.1:49152/callback/thingtime_mcp_AbC123';
  assert.equal(normalizeDynamicClientRedirectUri(redirectUri), redirectUri);
  assert.equal(normalizeRegisteredClientRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect'), 'https://chatgpt.com/connector_platform_oauth_redirect');
  assert.equal(normalizeRegisteredClientRedirectUri('https://chat.openai.com/connector_platform_oauth_redirect'), 'https://chat.openai.com/connector_platform_oauth_redirect');
  assert.equal(normalizeDynamicClientRedirectUri('http://localhost:49152/callback/thingtime_mcp_AbC123'), null);
  assert.equal(normalizeDynamicClientRedirectUri('https://127.0.0.1:49152/callback/thingtime_mcp_AbC123'), null);
  assert.equal(normalizeDynamicClientRedirectUri('http://127.0.0.1:49152/callback/thingtime_mcp_AbC123?next=https://attacker.invalid'), null);
  assert.equal(normalizeRegisteredClientRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect/attacker'), null);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: 'ttdcr_signed-client-id',
    redirect_uri: redirectUri,
    resource: `https://thingtime.com${CHATGPT_MCP_PATH}`,
    code_challenge: validPkceChallenge,
    code_challenge_method: 'S256',
    state: validState,
    scope: 'thingtime'
  });
  const dynamicClient = { clientId: 'ttdcr_signed-client-id', redirectUris: [redirectUri] };
  assert.equal(parseChatGptAuthorizationRequest(params, 'https://thingtime.com', dynamicClient).ok, true);
  params.set('redirect_uri', 'http://127.0.0.1:49152/callback/other');
  assert.equal(parseChatGptAuthorizationRequest(params, 'https://thingtime.com', dynamicClient).ok, false);

  const chatGptRedirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
  params.set('redirect_uri', chatGptRedirectUri);
  const chatGptDynamicClient = { clientId: 'ttdcr-chatgpt-client-id', redirectUris: [chatGptRedirectUri] };
  params.set('client_id', chatGptDynamicClient.clientId);
  assert.equal(parseChatGptAuthorizationRequest(params, 'https://thingtime.com', chatGptDynamicClient).ok, true);
});

test('Thingtime endpoint and encrypted-bundle parsing fail closed', () => {
  assert.equal(normalizeThingtimeEndpoint('https://thingtime.com'), 'https://thingtime.com');
  assert.equal(normalizeThingtimeEndpoint('https://thingtime.com/api/v1'), null);
  assert.equal(normalizeThingtimeEndpoint('https://attacker.invalid'), null);
  assert.equal(normalizeThingtimeEndpoint('http://thingtime.com'), null);

  const token = 'a'.repeat(40);
  const valid = parseCredentialBundle({
    version: 1,
    defaultConnectionId: 'personal',
    connections: [
      {
        id: 'personal',
        label: 'Personal',
        endpoint: 'https://thingtime.com',
        token,
        user: { id: 'user-1', username: 'lopu', displayName: 'Lopu' },
        scopes: ['things.read'],
        connectedAt: '2026-08-25T00:00:00.000Z'
      }
    ]
  });
  assert.ok(valid);
  assert.equal(parseCredentialBundle({ ...valid, connections: [{ ...valid!.connections[0], endpoint: 'https://attacker.invalid' }] }), null);
});

test('omitted tool filters stay omitted upstream instead of becoming the string "null"', () => {
  // The argument readers in plugin.ts return null for an absent tool argument.
  // A guard that only drops undefined would send thingtime=null&folder=null,
  // making an unfiltered list_thingtime_things filter on a kind named "null"
  // and an empty search_thingtime_things search for that word.
  const listed = applyUpstreamQuery(new URL('/api/v1/things', 'https://thingtime.com'), {
    thingtime: null,
    folder: null,
    limit: undefined
  });
  assert.equal(listed.toString(), 'https://thingtime.com/api/v1/things');
  assert.equal(listed.searchParams.has('thingtime'), false);
  assert.equal(listed.searchParams.has('folder'), false);

  const searched = applyUpstreamQuery(new URL('/api/v1/things/search', 'https://thingtime.com'), {
    q: null,
    thingtime: '',
    limit: 25
  });
  assert.equal(searched.searchParams.has('q'), false);
  assert.equal(searched.searchParams.has('thingtime'), false);
  assert.equal(searched.searchParams.get('limit'), '25');

  // Supplied filters still ride through, including a literal "null" the user
  // genuinely asked for and values that need escaping.
  const supplied = applyUpstreamQuery(new URL('/api/v1/things', 'https://thingtime.com'), {
    thingtime: 'null',
    folder: 'a b&c',
    limit: 1
  });
  assert.equal(supplied.searchParams.get('thingtime'), 'null');
  assert.equal(supplied.searchParams.get('folder'), 'a b&c');
  assert.equal(supplied.searchParams.get('limit'), '1');
});

test('the connection page escapes every HTML-significant character it interpolates', () => {
  const page = renderConnectionPage('tok"><script>alert(1)</script>', ['https://thingtime.com']);
  // The request token lands in a double-quoted attribute: an unescaped quote
  // would close it and an unescaped angle bracket would open a real element.
  assert.equal(page.includes('<script>alert(1)</script>'), false);
  assert.equal(page.includes('tok"><script>'), false);
  assert.ok(page.includes('tok&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
  // The page's own trusted markup and inline bootstrap must survive intact.
  assert.ok(page.includes('<option value="https://thingtime.com">https://thingtime.com</option>'));
  assert.ok(page.includes("document.getElementById('add')"));
});

test('capability discovery is origin scoped and every registered route has a semantic feature', () => {
  const discovery = pluginDiscovery('https://thingtime.com');
  assert.equal(discovery.protectedResource.resource, `https://thingtime.com${CHATGPT_MCP_PATH}`);
  assert.equal(discovery.authorizationServer.issuer, 'https://thingtime.com');
  assert.deepEqual(discovery.authorizationServer.grant_types_supported, ['authorization_code', 'refresh_token']);
  assert.deepEqual(discovery.authorizationServer.scopes_supported, ['thingtime', 'offline_access']);
  assert.equal(discovery.authorizationServer.client_id_metadata_document_supported, true);
  assert.equal(discovery.authorizationServer.registration_endpoint, 'https://thingtime.com/api/v1/integrations/chatgpt/oauth/register');
  assert.deepEqual(discovery.capabilityManifest.features, CHATGPT_PLUGIN_FEATURES);
  for (const route of CHATGPT_PLUGIN_ROUTES) {
    assert.ok(route.feature in CHATGPT_PLUGIN_FEATURES, `${route.method} ${route.path} lacks a known capability feature`);
  }
  assert.deepEqual(
    discovery.capabilityManifest.operations,
    [
      ...Object.entries(CHATGPT_MCP_TOOL_FEATURES).map(([name, feature]) => ({ transport: 'mcp-tool', name, feature })),
      ...Object.entries(CHATGPT_MCP_METHOD_FEATURES).map(([name, feature]) => ({ transport: 'mcp-method', name, feature }))
    ]
  );
  for (const operation of discovery.capabilityManifest.operations) {
    assert.ok(operation.feature in CHATGPT_PLUGIN_FEATURES, `${operation.name} lacks a known capability feature`);
  }
});
