import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHATGPT_MCP_PATH,
  CHATGPT_PLUGIN_FEATURES,
  CHATGPT_PLUGIN_ROUTES,
  isMcpResourceForOrigin,
  normalizeThingtimeEndpoint,
  parseChatGptAuthorizationRequest,
  parseCredentialBundle,
  pluginDiscovery
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
  if (parsed.ok) assert.equal(parsed.request.resource, `https://thingtime.com${CHATGPT_MCP_PATH}`);
  assert.equal(isMcpResourceForOrigin(`https://thingtime.com${CHATGPT_MCP_PATH}`, 'https://thingtime.com'), true);
  assert.equal(isMcpResourceForOrigin(`https://other.example${CHATGPT_MCP_PATH}`, 'https://thingtime.com'), false);

  params.set('client_id', 'https://chatgpt.com');
  assert.equal(parseChatGptAuthorizationRequest(params, 'https://thingtime.com').ok, true);
  params.set('client_id', 'https://chatgpt.com/oauth/client.json');
  params.set('resource', 'https://attacker.invalid/api/v1/integrations/chatgpt/mcp');
  assert.equal(parseChatGptAuthorizationRequest(params, 'https://thingtime.com').ok, false);
  params.set('resource', `https://thingtime.com${CHATGPT_MCP_PATH}`);
  params.set('redirect_uri', 'https://attacker.invalid/callback');
  assert.equal(parseChatGptAuthorizationRequest(params, 'https://thingtime.com').ok, false);
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

test('capability discovery is origin scoped and every registered route has a semantic feature', () => {
  const discovery = pluginDiscovery('https://thingtime.com');
  assert.equal(discovery.protectedResource.resource, `https://thingtime.com${CHATGPT_MCP_PATH}`);
  assert.equal(discovery.authorizationServer.issuer, 'https://thingtime.com');
  assert.deepEqual(discovery.capabilityManifest.features, CHATGPT_PLUGIN_FEATURES);
  for (const route of CHATGPT_PLUGIN_ROUTES) {
    assert.ok(route.feature in CHATGPT_PLUGIN_FEATURES, `${route.method} ${route.path} lacks a known capability feature`);
  }
});
