import assert from 'node:assert/strict';
import test from 'node:test';
import { getMessengerJson } from './messengerRequest.ts';

test('conversation reads retain HTTP status for deleted/forbidden conversations', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [403, 404, 429, 503]) {
      globalThis.fetch = async (_url, init) => {
        assert.equal(init?.cache, 'no-store'); assert.ok(init?.signal);
        return new Response(JSON.stringify({ ok: false, error: 'Unavailable' }), { status, headers: { 'Retry-After': '30' } });
      };
      await assert.rejects(getMessengerJson('/api/v1/chats/messages?chatId=gone'), error => {
        assert.equal((error as any).status, status); assert.equal((error as any).retryAfterSeconds, 30); return true;
      });
    }
    globalThis.fetch = async () => new Response('<html>Unavailable</html>', { status: 502 });
    await assert.rejects(getMessengerJson('/api/v1/chats'), error => { assert.equal((error as any).status, 502); return true; });
  } finally { globalThis.fetch = original; }
});
