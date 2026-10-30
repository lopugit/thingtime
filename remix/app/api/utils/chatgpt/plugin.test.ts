import assert from 'node:assert/strict';
import test from 'node:test';

import { beginChatGptAuthorization, callThingtimeTool, consumedSessionPipeline, handleChatGptMcp, registerChatGptOAuthClient } from './plugin';
import { CHATGPT_MCP_INSTRUCTIONS, CHATGPT_MCP_TOOL_FEATURES, normalizeRegisteredClientRedirectUri, renderConnectionPage } from './pluginCore';
import { REVOKED_SESSION_REAP_MS, revokedSessionPipeline } from '~/api/utils/auth/sessions';

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

test('the OAuth connection page is SSO-first and defaults to all Things read/write access', () => {
  const page = renderConnectionPage(
    'signed-request-token',
    ['https://thingtime.example'],
    'https://thingtime.example',
    [
      { id: 'things', title: 'Full things access', description: 'Read and write every supported Thing capability.', emoji: '🗝️' },
      { id: 'things.read', title: 'Read Things', description: 'Read Things only.', emoji: '👁️' }
    ]
  );

  assert.match(page, /Connect your account/);
  assert.match(page, /Continue with Thingtime/);
  assert.match(page, /Read\/write all Things/);
  assert.match(page, /data-scope value="things" checked/);
  assert.match(page, /\/authorize\?self=1/);
  assert.match(page, /Generate a new token with these rules/);
  assert.match(page, /Completing your secure Thingtime connection/);
  assert.match(page, /data\.set\('intent','complete'\)/);
  assert.match(page, /window\.location\.assign\(body\.redirectUri\)/);
  assert.doesNotMatch(page, /Create a least-privilege token/);
});

test('MCP tools/list publishes a host-native login bootstrap before a user links Thingtime', async () => {
  const response = await handleChatGptMcp({
    request: new Request('https://thingtime.example/api/v1/integrations/chatgpt/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    })
  });
  const payload: any = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.result.tools.length, Object.keys(CHATGPT_MCP_TOOL_FEATURES).length);
  assert.deepEqual(payload.result.tools[0].securitySchemes, [{ type: 'noauth' }, { type: 'oauth2', scopes: ['thingtime'] }]);
  assert.deepEqual(payload.result.tools[0]._meta.securitySchemes, [{ type: 'noauth' }, { type: 'oauth2', scopes: ['thingtime'] }]);
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
      'login_thingtime',
      'list_thingtime_accounts',
      'select_thingtime_account',
      'remove_thingtime_account',
      'get_thingtime_profile',
      'prepare_thingtime_agent_task',
      'get_thingtime_agent_task',
      'report_thingtime_agent_task',
      'coordinate_thingtime_agent_task',
      'get_thingtime_thing',
      'get_thingtime_things',
      'list_thingtime_comments',
      'list_thingtime_things',
      'search_thingtime_things',
      'list_thingtime_schemas',
      'get_thingtime_schema',
      'validate_thingtime_thing',
      'list_thingtime_related',
      'list_thingtime_changes',
      'preview_thingtime_mutation',
      'apply_thingtime_mutation',
      'list_thingtime_history',
      'get_thingtime_history',
      'undo_thingtime_mutation',
      'list_thingtime_capabilities',
      'get_thingtime_capability_contract',
      'start_thingtime_workflow',
      'get_thingtime_workflow',
      'cancel_thingtime_workflow',
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
    const expectedSecuritySchemes = tool.name === 'login_thingtime'
      ? [{ type: 'noauth' }, { type: 'oauth2', scopes: ['thingtime'] }]
      : [{ type: 'oauth2', scopes: ['thingtime'] }];
    assert.deepEqual(tool.securitySchemes, expectedSecuritySchemes);
    assert.deepEqual(tool._meta.securitySchemes, expectedSecuritySchemes);
    assert.deepEqual(tool.outputSchema, { type: 'object', additionalProperties: true });
    assert.equal(tool._meta['openai/outputTemplate'], 'ui://thingtime/review.html');
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

test('bounded exact batch reads preserve input order and report missing IDs independently', async (t) => {
  t.mock.method(globalThis, 'fetch', async (input) => {
    const id = new URL(String(input)).searchParams.get('id');
    if (id === 'missing') {
      return new Response(JSON.stringify({ ok: false, error: 'Thing not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true, thing: { id } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  const result: any = await callThingtimeTool('get_thingtime_things', { ids: ['two', 'missing', 'one'] }, connectedContext);
  assert.deepEqual(result.results, [
    { id: 'two', found: true, thing: { id: 'two' } },
    { id: 'missing', found: false, error: 'thing_not_found' },
    { id: 'one', found: true, thing: { id: 'one' } }
  ]);
});

test('change polling uses the structured ACL-aware updatedAt search contract', async (t) => {
  let requestBody: any;
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ ok: true, things: [], nextCursor: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  await callThingtimeTool('list_thingtime_changes', {
    since: '2026-08-29T00:00:00.000Z',
    thingtime: 'data',
    limit: 50
  }, connectedContext);
  assert.deepEqual(requestBody, {
    conditions: [{ field: 'updatedAt', op: 'gte', value: '2026-08-29T00:00:00.000Z' }],
    thingtime: 'data',
    sort: 'newest',
    cursor: null,
    limit: 50
  });
});

test('an unknown workflow run is rejected before a signed preview can mutate anything', async (t) => {
  let fetches = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetches += 1;
    return new Response(JSON.stringify({
      ok: true,
      thing: { id: 'todo-1', thingtime: ['data'], crystal: { done: false }, updatedAt: '2026-08-29T00:00:00.000Z' }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const context = {
    ...connectedContext,
    bundle: {
      ...connectedContext.bundle,
      connections: [{ ...connectedContext.bundle.connections[0], scopes: ['things.read', 'things.update'] }],
      runs: []
    }
  } as any;
  const previewed: any = await callThingtimeTool('preview_thingtime_mutation', {
    operations: [{ action: 'update', id: 'todo-1', patch: { crystal: { done: true } } }]
  }, context);
  assert.equal(typeof previewed.receipt, 'string');
  assert.equal(fetches, 1);

  const notConfirmed = await callThingtimeTool('apply_thingtime_mutation', { receipt: previewed.receipt }, context);
  assert.deepEqual(notConfirmed, { error: 'confirmed must be true after the user explicitly confirms the reviewed plan', status: 400 });
  assert.equal(fetches, 1);

  const applied = await callThingtimeTool('apply_thingtime_mutation', { receipt: previewed.receipt, confirmed: true, runId: 'unknown-run' }, context);
  assert.deepEqual(applied, { error: 'Unknown Thingtime workflow run', status: 404 });
  assert.equal(fetches, 1);
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

test('an unauthenticated login returns a host-native OAuth challenge without failing the transport', async () => {
  const response = await handleChatGptMcp({
    request: new Request('https://thingtime.example/api/v1/integrations/chatgpt/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'login_thingtime', arguments: {} } })
    })
  });
  const payload: any = await response.json();
  const challenge = 'Bearer resource_metadata="https://thingtime.example/.well-known/oauth-protected-resource", error="invalid_token", error_description="A Thingtime connection is required"';

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('www-authenticate'), null);
  assert.equal(payload.result.isError, true);
  assert.deepEqual(payload.result._meta['mcp/www_authenticate'], [challenge]);
});

test('an unauthenticated account tool remains protected at the HTTP transport boundary', async () => {
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

test('login status and account listing expose only authenticated account metadata', async () => {
  const login: any = await callThingtimeTool('login_thingtime', {}, connectedContext);
  const listed: any = await callThingtimeTool('list_thingtime_accounts', {}, connectedContext);

  assert.equal(login.authenticated, true);
  assert.equal(login.defaultAccountId, 'personal');
  assert.deepEqual(login.accounts, listed.accounts);
  assert.match(login.message, /reconnect/i);
  assert.equal(JSON.stringify(login).includes('test-token-not-returned-to-the-client'), false);
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
  assert.equal(payload.result.serverInfo.name, 'thingtime');
  assert.equal(payload.result.instructions, CHATGPT_MCP_INSTRUCTIONS);
  assert.match(payload.result.instructions, /select one explicitly/);
  assert.match(payload.result.instructions, /exact Thing ID.*get_thingtime_thing/i);
  assert.match(payload.result.instructions, /comment target ID.*list_thingtime_comments/i);
  assert.deepEqual(payload.result.capabilities.prompts, { listChanged: false });
  assert.deepEqual(payload.result.capabilities.resources, { subscribe: false, listChanged: false });
});

test('MCP publishes prompts and static resources before account authorization', async () => {
  const invoke = async (method: string, params: Record<string, unknown> = {}) => {
    const response = await handleChatGptMcp({
      request: new Request('https://thingtime.example/api/v1/integrations/chatgpt/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params })
      })
    });
    return (await response.json() as any).result;
  };

  const prompts = await invoke('prompts/list');
  assert.equal(prompts.prompts.length, 5);
  assert.deepEqual(prompts.prompts.map((prompt: any) => prompt.name), [
    'thingtime_inbox_triage',
    'thingtime_design_schema',
    'thingtime_safe_change',
    'thingtime_restore_history',
    'thingtime_build_capability'
  ]);
  const prompt = await invoke('prompts/get', { name: 'thingtime_safe_change', arguments: { goal: 'archive done items' } });
  assert.equal(prompt.messages[0].role, 'user');
  assert.match(prompt.messages[0].content.text, /archive done items/);

  const resources = await invoke('resources/list');
  assert.deepEqual(resources.resources.map((resource: any) => resource.uri), [
    'ui://thingtime/review.html',
    'thingtime://capability-contract'
  ]);
  const ui = await invoke('resources/read', { uri: 'ui://thingtime/review.html' });
  assert.equal(ui.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.match(ui.contents[0].text, /Limitless, bounded/);
  assert.equal(ui.contents[0].text.includes('test-token-not-returned-to-the-client'), false);
});

test('OAuth remote relay callbacks stay first-party and require a 256-bit handoff id', () => {
  const origin = 'https://thingtime.example';
  const handoff = 'A'.repeat(43);
  assert.equal(
    normalizeRegisteredClientRedirectUri(`${origin}/api/v1/integrations/chatgpt/oauth/relay?handoff=${handoff}`, origin),
    `${origin}/api/v1/integrations/chatgpt/oauth/relay?handoff=${handoff}`
  );
  assert.equal(normalizeRegisteredClientRedirectUri(`https://attacker.invalid/api/v1/integrations/chatgpt/oauth/relay?handoff=${handoff}`, origin), null);
  assert.equal(normalizeRegisteredClientRedirectUri(`${origin}/api/v1/integrations/chatgpt/oauth/relay?handoff=short`, origin), null);
  assert.equal(normalizeRegisteredClientRedirectUri(`${origin}/api/v1/integrations/chatgpt/oauth/relay?handoff=${handoff}&extra=1`, origin), null);
});

test('OAuth dynamic client registration signs only exact local, ChatGPT, or first-party relay callbacks', async () => {
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

  const chatGptRedirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const chatGptRegistration = await registerChatGptOAuthClient({
    request: new Request('https://thingtime.example/api/v1/integrations/chatgpt/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [chatGptRedirectUri], token_endpoint_auth_method: 'none' })
    })
  });
  const chatGptPayload: any = await chatGptRegistration.json();
  assert.equal(chatGptRegistration.status, 201);
  assert.equal(chatGptPayload.redirect_uris[0], chatGptRedirectUri);

  const chatGptAuthorization = await beginChatGptAuthorization({
    request: new Request(`https://thingtime.example/api/v1/integrations/chatgpt/oauth/authorize?${new URLSearchParams({
      response_type: 'code',
      client_id: chatGptPayload.client_id,
      redirect_uri: chatGptRedirectUri,
      resource: 'https://thingtime.example/api/v1/integrations/chatgpt/mcp',
      code_challenge: 'A'.repeat(43),
      code_challenge_method: 'S256',
      state: 'state-which-is-long-enough-to-be-safe',
      scope: 'thingtime offline_access'
    })}`)
  });
  assert.notEqual(chatGptAuthorization.status, 400);

  const handoff = 'B'.repeat(43);
  const relayRedirectUri = `https://thingtime.example/api/v1/integrations/chatgpt/oauth/relay?handoff=${handoff}`;
  const relayRegistration = await registerChatGptOAuthClient({
    request: new Request('https://thingtime.example/api/v1/integrations/chatgpt/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [relayRedirectUri], token_endpoint_auth_method: 'none' })
    })
  });
  const relayPayload: any = await relayRegistration.json();
  assert.equal(relayRegistration.status, 201);
  assert.equal(relayPayload.redirect_uris[0], relayRedirectUri);

  const invalid = await registerChatGptOAuthClient({
    request: new Request('https://thingtime.example/api/v1/integrations/chatgpt/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://attacker.invalid/callback'] })
    })
  });
  assert.equal(invalid.status, 400);
});

test('revoking a never-expiring bridge session leaves a reap date for the sessions TTL index', () => {
  const revokedAt = new Date('2026-01-01T00:00:00.000Z');
  const pipeline = revokedSessionPipeline(revokedAt);
  const stage = pipeline.find((entry) => entry.$set)?.$set;
  assert.ok(stage);

  // Already a pipeline, so no caller has to remember to wrap it — passed to a
  // plain update the $ifNull would be STORED as a literal sub-document, which
  // is not a Date, which the TTL index skips: the exact leak this fixes,
  // silently back.
  assert.ok(Array.isArray(pipeline));
  assert.ok(pipeline.some((entry) => entry.$unset === 'secureVaultKey'));
  // TTL skips expiresAt: null, so a disconnect must fill one in or the revoked
  // bridge sessions accumulate in Mongo forever.
  assert.equal(stage.revokedAt, revokedAt);
  assert.deepEqual(stage.expiresAt, {
    $ifNull: ['$expiresAt', new Date(revokedAt.getTime() + REVOKED_SESSION_REAP_MS)]
  });
  // A session that already carries a real expiry keeps it.
  assert.equal(stage.expiresAt.$ifNull[0], '$expiresAt');
});

test('consuming a rotated refresh grant also leaves a reap date, not just revokedAt', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const pipeline = consumedSessionPipeline(now);

  // Refresh rotation burns one never-expiring session per refresh. Stamping
  // only revokedAt would strand every consumed row: the TTL index skips
  // expiresAt: null, so the sessions collection would grow without bound.
  assert.deepEqual(pipeline, [
    ...revokedSessionPipeline(now),
    { $set: { 'meta.consumedAt': now } }
  ]);
  // It must be an aggregation pipeline — $ifNull only resolves in one. Stage
  // order is NOT what makes this safe: aggregation $set never drops fields, so
  // reap-then-consumedAt and consumedAt-then-reap are equivalent. What is
  // load-bearing is the dotted path — 'meta.consumedAt' merges into meta,
  // where a nested { meta: { consumedAt } } would replace the whole record and
  // strip clientId/resource/connectionId off every rotated grant.
  assert.ok(Array.isArray(pipeline));
  assert.deepEqual(Object.keys(pipeline.at(-1)!.$set!), ['meta.consumedAt']);
});

const reportingContext = () => ({ ...connectedContext, bundle: { ...connectedContext.bundle, connections: [{ ...connectedContext.bundle.connections[0], scopes: ['agents.report'] }] } });
const reportingManifest = () => ({ schemaVersion: 1, origin: 'https://thingtime.com', features: {
  'api.agent-reporting': { version: '1.0.0' }, 'api.auth-characters': { version: '1.0.0' }, 'api.agent-overview': { version: '2.0.0' }
} });

test('agent reporting needs independent authorization and never upgrades existing things tokens', async (t) => {
  let fetched = false;
  t.mock.method(globalThis, 'fetch', async () => { fetched = true; throw new Error('must not fetch'); });
  const context = { ...connectedContext, bundle: { ...connectedContext.bundle, connections: [{ ...connectedContext.bundle.connections[0], scopes: ['things'] }] } };
  const result: any = await callThingtimeTool('get_thingtime_agent_task', { externalTaskId: 'chat-1' }, context);
  assert.equal(result.status, 403);
  assert.match(result.error, /independent agents.report/);
  assert.equal(fetched, false);
  assert.deepEqual(context.bundle.connections[0].scopes, ['things']);
});

test('agent reporting rejects wrong-origin and breaking manifests and retries with fresh discovery', async (t) => {
  let manifest: any = { ...reportingManifest(), origin: 'https://other.example' };
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://thingtime.com');
    if (url.pathname.includes('.well-known')) return Response.json(manifest);
    writes += 1;
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { operation: 'get', origin: 'https://thingtime.com', externalTaskId: 'chat-1' });
    return Response.json({ ok: true, binding: { id: 'binding-1', externalTaskId: 'chat-1', characterId: 'character-1', records: {} } });
  });
  const context = reportingContext();
  assert.equal((await callThingtimeTool('get_thingtime_agent_task', { externalTaskId: 'chat-1', origin: 'https://evil.example' }, context) as any).status, 409);
  manifest = reportingManifest();
  manifest.features['api.agent-reporting'].version = '2.0.0';
  assert.equal((await callThingtimeTool('get_thingtime_agent_task', { externalTaskId: 'chat-1' }, context) as any).status, 409);
  assert.equal(writes, 0);
  manifest = reportingManifest();
  const result: any = await callThingtimeTool('get_thingtime_agent_task', { externalTaskId: 'chat-1' }, context);
  assert.equal(writes, 1);
  assert.equal(result.result.binding.characterId, 'character-1');
  assert.equal(JSON.stringify(result).includes('test-token'), false);
  assert.equal(JSON.stringify(result).includes('Authorization'), false);
});

test('agent report dispatch is restricted to saved reporting action names and immutable request identity', async (t) => {
  const bodies: any[] = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (String(input).includes('.well-known')) return Response.json(reportingManifest());
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true, receipt: { requestId: bodies.at(-1).requestId, status: 'completed' } });
  });
  const context = reportingContext();
  const invalid: any = await callThingtimeTool('report_thingtime_agent_task', { externalTaskId: 'chat-1', requestId: 'bad', actionName: 'arbitrary', inputs: {} }, context);
  assert.equal(invalid.status, 400);
  assert.equal(bodies.length, 0);
  const args = { externalTaskId: 'chat-1', requestId: '7f985f40-f219-48f0-8ea0-8d54b71570cf', actionName: 'addProgress', inputs: { summary: 'Verified focused tests' }, path: '/api/v1/evil', actionId: 'injected' };
  await callThingtimeTool('report_thingtime_agent_task', args, context);
  await callThingtimeTool('report_thingtime_agent_task', args, context);
  assert.deepEqual(bodies[0], { operation: 'report', origin: 'https://thingtime.com', externalTaskId: args.externalTaskId, requestId: args.requestId, actionName: 'addProgress', inputs: args.inputs });
  assert.deepEqual(bodies[0], bodies[1]);
});

test('agent reporting can recover after invalid JSON or a missing required feature', async (t) => {
  let state = 0;
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (input) => {
    if (!String(input).includes('.well-known')) { writes += 1; return Response.json({ ok: true }); }
    if (state === 0) return new Response('<html>not a manifest</html>');
    const manifest = reportingManifest();
    if (state === 1) delete (manifest.features as any)['api.agent-overview'];
    return Response.json(manifest);
  });
  const context = reportingContext();
  const args = { externalTaskId: 'chat-1' };
  assert.equal((await callThingtimeTool('get_thingtime_agent_task', args, context) as any).status, 502);
  state = 1;
  assert.equal((await callThingtimeTool('get_thingtime_agent_task', args, context) as any).status, 409);
  assert.equal(writes, 0);
  state = 2;
  await callThingtimeTool('get_thingtime_agent_task', args, context);
  assert.equal(writes, 1);
});


test('agent prepare binds only the selected account origin and explicit saved workspace', async (t) => {
  let submitted: any;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (String(input).includes('.well-known')) return Response.json(reportingManifest());
    submitted = JSON.parse(String(init?.body));
    return Response.json({ ok: true, binding: { characterId: 'task-character', records: {} } });
  });
  const workspace = { subspaceSlug: 'thingtime-agents', pages: { overview: 'overview', taskDetail: 'detail' }, schemas: { project: 'p', task: 't', agent: 'a', todo: 'd', progress: 'g', question: 'q' }, actions: { addProgress: 'saved-progress-action' } };
  await callThingtimeTool('prepare_thingtime_agent_task', { externalTaskId: 'stable-chat', displayName: 'Task auditor', workspace, endpoint: 'https://evil.example', token: 'never-forward' }, reportingContext());
  assert.deepEqual(submitted, { operation: 'prepare', origin: 'https://thingtime.com', externalTaskId: 'stable-chat', displayName: 'Task auditor', workspace });
});

test('agent capability connection failure is retryable and does not dispatch reports', async (t) => {
  let failed = true;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input) => {
    if (String(input).includes('.well-known')) {
      if (failed) throw new Error('network unavailable');
      return Response.json(reportingManifest());
    }
    calls += 1;
    return Response.json({ ok: true });
  });
  const args = { externalTaskId: 'retry-chat' };
  assert.equal((await callThingtimeTool('get_thingtime_agent_task', args, reportingContext()) as any).status, 502);
  assert.equal(calls, 0);
  failed = false;
  await callThingtimeTool('get_thingtime_agent_task', args, reportingContext());
  assert.equal(calls, 1);
});

test('agent task exact record readback and updateWorkItem use the registered reporting contract', async (t) => {
  const submitted: any[] = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (String(input).includes('.well-known')) return Response.json(reportingManifest());
    submitted.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true });
  });
  const context = reportingContext();
  await callThingtimeTool('get_thingtime_agent_task', { externalTaskId: 'read-chat', recordIds: ['task-row', 'progress-row'] }, context);
  assert.deepEqual(submitted[0], { operation: 'get', origin: 'https://thingtime.com', externalTaskId: 'read-chat', recordIds: ['task-row', 'progress-row'] });
  await callThingtimeTool('report_thingtime_agent_task', { externalTaskId: 'read-chat', requestId: '7f985f40-f219-48f0-8ea0-8d54b71570cf', actionName: 'updateWorkItem', inputs: { id: 'task-row', status: 'active' } }, context);
  assert.equal(submitted[1].actionName, 'updateWorkItem');
  const invalid: any = await callThingtimeTool('get_thingtime_agent_task', { externalTaskId: 'read-chat', recordIds: [''] }, context);
  assert.equal(invalid.status, 400);
  assert.equal(submitted.length, 2);
});

test('private coordination uses a fixed origin and body with an explicit render component', async (t) => {
  const bodies: any[] = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (String(input).includes('.well-known')) return Response.json(reportingManifest());
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: false, error: 'Private coordination membership was revoked' }, { status: 409 });
  });
  const args = { externalTaskId: 'coordinate-chat', requestId: '7f985f40-f219-48f0-8ea0-8d54b71570cf', title: 'Task claim', text: 'Focused implementation status', renderComponent: { id: 'saved-component' } };
  const result: any = await callThingtimeTool('coordinate_thingtime_agent_task', { ...args, subspaceId: 'unbound-subspace' }, reportingContext());
  assert.equal(result.status, 409);
  assert.deepEqual(bodies[0], { operation: 'coordinate', origin: 'https://thingtime.com', ...args });
  const invalid: any = await callThingtimeTool('coordinate_thingtime_agent_task', { ...args, renderComponent: undefined }, reportingContext());
  assert.equal(invalid.status, 400);
  assert.equal(bodies.length, 1);
});


test('private coordination returns a verified stable post receipt and keeps the request identity', async (t) => {
  const bodies: any[] = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (String(input).includes('.well-known')) return Response.json(reportingManifest());
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    return Response.json({ ok: true, binding: { characterId: 'task-character', coordinationPostId: 'stable-private-post' }, receipt: { requestId: body.requestId, status: 'complete', result: { ids: ['stable-private-post'] } } });
  });
  const args = { externalTaskId: 'coordinate-chat', requestId: '7f985f40-f219-48f0-8ea0-8d54b71570cf', title: 'Task claim', text: 'Implementation and verification status', renderComponent: { id: 'saved-component' } };
  const result: any = await callThingtimeTool('coordinate_thingtime_agent_task', args, reportingContext());
  assert.equal(result.result.binding.coordinationPostId, 'stable-private-post');
  assert.equal(result.result.receipt.status, 'complete');
  await callThingtimeTool('coordinate_thingtime_agent_task', args, reportingContext());
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(JSON.stringify(result).includes('test-token'), false);
});


test('child task preparation forwards only a stable parent binding identity', async (t) => {
  let submitted: any;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (String(input).includes('.well-known')) return Response.json(reportingManifest());
    submitted = JSON.parse(String(init?.body));
    return Response.json({ ok: true, binding: { parentTaskId: 'actual-parent-task', sharedTaskId: 'shared-root-task', records: { projectId: 'inherited-project' } } });
  });
  const workspace = { pages: { overview: 'overview', taskDetail: 'detail' }, schemas: { project: 'p', task: 't', agent: 'a', todo: 'd', progress: 'g', question: 'q' }, actions: { createTask: 'saved-create-task' } };
  const result: any = await callThingtimeTool('prepare_thingtime_agent_task', { externalTaskId: 'child-chat', parentExternalTaskId: 'parent-chat', displayName: 'Child auditor', workspace, parentId: 'untrusted-parent-id', projectId: 'untrusted-project' }, reportingContext());
  assert.deepEqual(submitted, { operation: 'prepare', origin: 'https://thingtime.com', externalTaskId: 'child-chat', parentExternalTaskId: 'parent-chat', displayName: 'Child auditor', workspace });
  assert.equal(result.result.binding.sharedTaskId, 'shared-root-task');
  assert.equal(result.result.binding.parentTaskId, 'actual-parent-task');
  assert.equal((await callThingtimeTool('prepare_thingtime_agent_task', { externalTaskId: 'child-chat', parentExternalTaskId: '', displayName: 'Child auditor', workspace }, reportingContext()) as any).status, 400);
});
