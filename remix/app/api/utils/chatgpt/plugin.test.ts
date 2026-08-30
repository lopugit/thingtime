import assert from 'node:assert/strict';
import test from 'node:test';

import { beginChatGptAuthorization, callThingtimeTool, handleChatGptMcp, registerChatGptOAuthClient } from './plugin';
import { CHATGPT_MCP_INSTRUCTIONS, CHATGPT_MCP_TOOL_FEATURES } from './pluginCore';

const connectedContext = {
  session: {},
  connection: null,
  bundle: {
    version: 1,
    defaultConnectionId: 'personal',
    connections: [
      {
        id: 'personal',
        label: 'Personal',
        endpoint: 'https://thingtime.com',
        token: 'test-token-not-returned-to-the-client',
        user: { id: 'user-1', username: 'lopu', displayName: 'Lopu' },
        scopes: ['things.read'],
        connectedAt: '2026-08-30T00:00:00.000Z'
      }
    ]
  }
} as any;

test('MCP tools/list publishes OAuth requirements before a user links Thingtime', async () => {
  const response = await handleChatGptMcp({
    request: new Request('https://thingtime.example/api/v1/integrations/chatgpt/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    })
  });
  const payload: any = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.result.tools.length, 15);
  assert.deepEqual(payload.result.tools[0].securitySchemes, [{ type: 'oauth2', scopes: ['thingtime'] }]);
  assert.deepEqual(payload.result.tools[0]._meta.securitySchemes, [{ type: 'oauth2', scopes: ['thingtime'] }]);
  const annotations = Object.fromEntries(payload.result.tools.map((tool: any) => [tool.name, tool.annotations]));
  assert.deepEqual(annotations.get_thingtime_thing, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.deepEqual(annotations.list_thingtime_comments, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.deepEqual(annotations.create_thingtime_thing, { readOnlyHint: false, destructiveHint: false, openWorldHint: true });
  assert.deepEqual(annotations.update_thingtime_thing, { readOnlyHint: false, destructiveHint: true, openWorldHint: true });
  assert.deepEqual(annotations.delete_thingtime_thing, { readOnlyHint: false, destructiveHint: true, openWorldHint: true });
  assert.deepEqual(annotations.comment_on_thingtime_thing, { readOnlyHint: false, destructiveHint: true, openWorldHint: true });
  assert.deepEqual(annotations.react_to_thingtime_thing, { readOnlyHint: false, destructiveHint: false, openWorldHint: true });
  assert.deepEqual(annotations.save_thingtime_thing, { readOnlyHint: false, destructiveHint: false, openWorldHint: false });
  assert.deepEqual(annotations.share_thingtime_thing, { readOnlyHint: false, destructiveHint: true, openWorldHint: true });
});

test('MCP tool discovery preserves the complete multi-account Thingtime contract', async () => {
  const response = await handleChatGptMcp({
    request: new Request('https://thingtime.example/api/v1/integrations/chatgpt/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    })
  });
  const payload: any = await response.json();
  const tools = payload.result.tools;

  assert.deepEqual(
    tools.map((tool: any) => tool.name),
    [
      'list_thingtime_accounts',
      'select_thingtime_account',
      'remove_thingtime_account',
      'get_thingtime_profile',
      'get_thingtime_thing',
      'list_thingtime_comments',
      'list_thingtime_things',
      'search_thingtime_things',
      'create_thingtime_thing',
      'update_thingtime_thing',
      'delete_thingtime_thing',
      'comment_on_thingtime_thing',
      'react_to_thingtime_thing',
      'save_thingtime_thing',
      'share_thingtime_thing'
    ]
  );
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: ['thingtime'] }]);
    assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: ['thingtime'] }]);
    assert.deepEqual(tool.outputSchema, { type: 'object', additionalProperties: true });
    assert.equal(CHATGPT_MCP_TOOL_FEATURES[tool.name as keyof typeof CHATGPT_MCP_TOOL_FEATURES] !== undefined, true);
  }
  assert.deepEqual(tools.map((tool: any) => tool.name), Object.keys(CHATGPT_MCP_TOOL_FEATURES));
  assert.match(tools.find((tool: any) => tool.name === 'get_thingtime_thing').description, /always prefer this tool/i);
  assert.match(tools.find((tool: any) => tool.name === 'list_thingtime_things').description, /DO NOT use this tool.*exact ID/i);
  assert.match(tools.find((tool: any) => tool.name === 'search_thingtime_things').description, /exact ID.*prefer get_thingtime_thing/i);
  assert.deepEqual(tools.find((tool: any) => tool.name === 'get_thingtime_thing').inputSchema.required, ['id']);
  assert.deepEqual(tools.find((tool: any) => tool.name === 'list_thingtime_comments').inputSchema.required, ['targetId']);
});

test('exact Thing reads use the upstream id primitive and never a paginated list', async (t) => {
  let requestedUrl = '';
  t.mock.method(globalThis, 'fetch', async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ ok: true, thing: { id: 'apple-notes-todo-v1' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  });

  const result: any = await callThingtimeTool('get_thingtime_thing', { id: 'apple-notes-todo-v1' }, connectedContext);
  const url = new URL(requestedUrl);
  assert.equal(url.pathname, '/api/v1/things');
  assert.equal(url.searchParams.get('id'), 'apple-notes-todo-v1');
  assert.equal(url.searchParams.has('limit'), false);
  assert.equal(result.result.thing.id, 'apple-notes-todo-v1');
});

test('exact Thing reads return a stable thing_not_found error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ ok: false, error: 'Thing not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' }
  }));

  assert.deepEqual(
    await callThingtimeTool('get_thingtime_thing', { id: 'missing-thing' }, connectedContext),
    { error: 'thing_not_found', status: 404 }
  );
});

test('targeted comment reads bind the exact target id and comment kind upstream', async (t) => {
  let requestedUrl = '';
  t.mock.method(globalThis, 'fetch', async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ ok: true, things: [{ id: 'comment-1' }], nextCursor: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  });

  const result: any = await callThingtimeTool(
    'list_thingtime_comments',
    { targetId: 'apple-notes-todo-v1', cursor: 'cursor-1', limit: 100 },
    connectedContext
  );
  const url = new URL(requestedUrl);
  assert.equal(url.pathname, '/api/v1/things');
  assert.equal(url.searchParams.get('target'), 'apple-notes-todo-v1');
  assert.equal(url.searchParams.get('thingtime'), 'comment');
  assert.equal(url.searchParams.get('cursor'), 'cursor-1');
  assert.equal(url.searchParams.get('limit'), '100');
  assert.equal(result.result.things[0].id, 'comment-1');
});

test('an unauthenticated protected tool call returns the OAuth challenge ChatGPT needs', async () => {
  const response = await handleChatGptMcp({
    request: new Request('https://thingtime.example/api/v1/integrations/chatgpt/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_thingtime_accounts', arguments: {} } })
    })
  });
  const payload: any = await response.json();
  const challenge = 'Bearer resource_metadata="https://thingtime.example/.well-known/oauth-protected-resource", error="invalid_token", error_description="A Thingtime connection is required"';

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('www-authenticate'), challenge);
  assert.equal(payload.result.isError, true);
  assert.deepEqual(payload.result._meta['mcp/www_authenticate'], [challenge]);
});

test('MCP initialize is available before OAuth so clients can negotiate the protocol', async () => {
  const response = await handleChatGptMcp({
    request: new Request('https://thingtime.example/api/v1/integrations/chatgpt/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
    })
  });
  const payload: any = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.result.serverInfo.name, 'thingtime-chatgpt');
  assert.equal(payload.result.instructions, CHATGPT_MCP_INSTRUCTIONS);
  assert.match(payload.result.instructions, /select one explicitly/);
  assert.match(payload.result.instructions, /exact Thing ID.*get_thingtime_thing/i);
  assert.match(payload.result.instructions, /comment target ID.*list_thingtime_comments/i);
});

test('OAuth dynamic client registration signs only exact local loopback callbacks', async () => {
  const redirectUri = 'http://127.0.0.1:49152/callback/thingtime_mcp_AbC123';
  const registration = await registerChatGptOAuthClient({
    request: new Request('https://thingtime.example/api/v1/integrations/chatgpt/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' })
    })
  });
  const payload: any = await registration.json();
  assert.equal(registration.status, 201);
  assert.equal(typeof payload.client_id, 'string');
  assert.equal(payload.redirect_uris[0], redirectUri);

  const authorization = await beginChatGptAuthorization({
    request: new Request(`https://thingtime.example/api/v1/integrations/chatgpt/oauth/authorize?${new URLSearchParams({
      response_type: 'code',
      client_id: payload.client_id,
      redirect_uri: redirectUri,
      resource: 'https://thingtime.example/api/v1/integrations/chatgpt/mcp',
      code_challenge: 'A'.repeat(43),
      code_challenge_method: 'S256',
      state: 'state-which-is-long-enough-to-be-safe',
      scope: 'thingtime'
    })}`)
  });
  assert.notEqual(authorization.status, 400);

  const invalid = await registerChatGptOAuthClient({
    request: new Request('https://thingtime.example/api/v1/integrations/chatgpt/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://attacker.invalid/callback'] })
    })
  });
  assert.equal(invalid.status, 400);
});
