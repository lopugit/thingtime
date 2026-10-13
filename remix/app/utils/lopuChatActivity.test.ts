import assert from 'node:assert/strict';
import test from 'node:test';
import { syncNativeLopuChatActivity } from './lopuChatActivity';

test('aggregate activity requires its own iOS capability and preserves a complete source-scoped snapshot', () => {
  const snapshot = {ownerId: 'owner', contextKey: 'opaque-scope', chats: [{chatId: 'one', status: 'running' as const, management: 'server' as const}]};
  const messages: any[] = [];
  const previous = (globalThis as any).window;
  try {
    (globalThis as any).window = {thingtimeNativeBridge: {isNativeWebView: true, platform: 'ios', version: '1.3.0', postMessage: (message: any) => messages.push(message)}};
    assert.equal(syncNativeLopuChatActivity(snapshot), false);
    for (const version of ['2.0.0', '1.0.0-beta', '']) {
      (globalThis as any).window.thingtimeNativeBridge.lopuChatActivityVersion = version;
      assert.equal(syncNativeLopuChatActivity(snapshot), false);
    }
    (globalThis as any).window.thingtimeNativeBridge.lopuChatActivityVersion = '1.0.0';
    assert.equal(syncNativeLopuChatActivity(snapshot), true);
    assert.deepEqual(messages[0].payload, snapshot);
    assert.equal(messages[0].type, 'lopu-chat-activity-sync');
    assert.equal(syncNativeLopuChatActivity({ownerId: null, contextKey: 'opaque-scope', chats: []}), true);
    assert.deepEqual(messages[1].payload.chats, []);
    (globalThis as any).window.thingtimeNativeBridge.platform = 'macos';
    assert.equal(syncNativeLopuChatActivity(snapshot), false);
  } finally { (globalThis as any).window = previous; }
});
