import assert from 'node:assert/strict';
import test from 'node:test';
import { messengerVisibleChats, showLopuChatsKey, spaceDirectMessages } from './conversationVisibility';
import type { ChatSummary } from './messengerTypes';

const chats = [
  { id: 'personal', chatType: 'dm', communityId: null },
  { id: 'group', chatType: 'group', communityId: null },
  { id: 'space-a', chatType: 'dm', communityId: 'a' },
  { id: 'space-b', chatType: 'group', communityId: 'b' },
  { id: 'channel', chatType: 'channel', communityId: 'a' },
  { id: 'lopu', chatType: 'dm', communityId: null, externalSource: { access: 'lopu', provider: 'lopu' } },
  { id: 'legacy-lopu', chatType: 'dm', communityId: null, externalSource: { provider: 'lopu' } },
  { id: 'imported', chatType: 'group', communityId: 'a', externalSource: { provider: 'claude', readOnly: true } },
  { id: 'live', chatType: 'group', communityId: 'a', externalSource: { access: 'live', provider: 'chatgpt', readOnly: false } }
] as ChatSummary[];
const ids = (rows: ChatSummary[]) => rows.map((row) => row.id);

test('spaces show only associated non-channel conversations, never global or another space', () => {
  assert.deepEqual(ids(spaceDirectMessages(chats, 'a')), ['space-a', 'imported', 'live']);
  assert.deepEqual(ids(spaceDirectMessages(chats, 'b')), ['space-b']);
  assert.deepEqual(spaceDirectMessages(chats, null), []);
  assert.deepEqual(spaceDirectMessages(chats, 'missing'), []);
});

test('Lopu is opt-in while humans, imported AI, live AI and channels remain available', () => {
  assert.deepEqual(ids(messengerVisibleChats(chats)), ['personal', 'group', 'space-a', 'space-b', 'channel', 'imported', 'live']);
  assert.deepEqual(messengerVisibleChats(chats, true), chats);
  assert.equal(chats.length, 9, 'Filtering must not discard cached conversations or deep-link targets');
  assert.deepEqual(ids(spaceDirectMessages(messengerVisibleChats(chats, true), 'a')), ['space-a', 'imported', 'live']);
});

test('the preference is isolated per account', () => {
  assert.notEqual(showLopuChatsKey('alice'), showLopuChatsKey('bob'));
  assert.notEqual(showLopuChatsKey(null), showLopuChatsKey('alice'));
});
