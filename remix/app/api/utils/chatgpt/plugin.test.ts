import assert from 'node:assert/strict';
import test from 'node:test';

import { handleChatGptMcp } from './plugin';

test('unauthenticated MCP tools/list returns the OAuth protected-resource challenge', async () => {
  const response = await handleChatGptMcp({
    request: new Request('https://thingtime.example/api/v1/integrations/chatgpt/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    })
  });
  const payload: any = await response.json();
  const challenge = 'Bearer resource_metadata="https://thingtime.example/.well-known/oauth-protected-resource"';

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('www-authenticate'), challenge);
  assert.equal(payload.result.isError, true);
  assert.equal(payload.result._meta['mcp/www_authenticate'], challenge);
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
