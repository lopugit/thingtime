import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatMessage } from '../Messenger/messengerTypes';
import { voiceConversationHistory, voiceHistoryEvents } from './voiceConversation';
const row = (patch: Partial<ChatMessage> = {}) => ({ id: 'message', chatId: 'chat', authorId: 'owner', text: 'Remember my garden', deleted: false, systemType: null, ...patch } as ChatMessage);
test('voice seeds the selected chat in order, never other chats, deleted, system or foreign-author text', () => {
	const history = voiceConversationHistory([
		row(), row({ authorId: 'lopu', text: 'We planted roses', externalSource: { provider: 'lopu', role: 'assistant' } as any }),
		row({ chatId: 'foreign', text: 'private other chat' }), row({ deleted: true }), row({ systemType: 'tool' }), row({ authorId: 'stranger' })
	], 'chat', 'owner');
	assert.deepEqual(history, [{ role: 'user', text: 'Remember my garden' }, { role: 'assistant', text: 'We planted roses' }]);
	const events = voiceHistoryEvents(history);
	assert.equal(events[0].item.content[0].type, 'input_text'); assert.equal(events[1].item.content[0].type, 'output_text');
	assert.ok(events.every(event => event.type === 'conversation.item.create'));
});
test('context is bounded to the newest twenty messages and 24000 Unicode characters', () => {
	const history = voiceConversationHistory(Array.from({ length: 30 }, (_, i) => row({ text: String(i) })), 'chat', 'owner');
	assert.equal(history.length, 20); assert.equal(history[0].text, '10');
	const large = voiceConversationHistory([row({ text: '🦄'.repeat(20000) }), row({ text: 'x'.repeat(20000) }), row({ text: 'last' })], 'chat', 'owner');
	assert.equal(large.reduce((n, item) => n + Array.from(item.text).length, 0), 24000); assert.equal(large.at(-1)?.text, 'last');
});
