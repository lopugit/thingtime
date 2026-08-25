import assert from 'node:assert/strict';
import test from 'node:test';

import { handleChatGptMcp } from './plugin';

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
  assert.equal(payload.result.tools.length, 13);
  assert.deepEqual(payload.result.tools[0].securitySchemes, [{ type: 'oauth2', scopes: ['thingtime'] }]);
  assert.deepEqual(payload.result.tools[0]._meta.securitySchemes, [{ type: 'oauth2', scopes: ['thingtime'] }]);
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
});
