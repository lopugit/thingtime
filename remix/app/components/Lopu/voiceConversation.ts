import type { ChatMessage } from '../Messenger/messengerTypes';
import { isLopuAssistantMessage, isOptimisticLopuMessage } from './lopuTurnCore';

export type VoiceHistoryItem = { role: 'user' | 'assistant'; text: string };

// Only the selected conversation's persisted, readable text. Tool payloads,
// system rows, other authors and binary attachments are never replayed as
// instructions. Keep the newest bounded context, in conversation order.
export function voiceConversationHistory(messages: ChatMessage[], chatId: string, ownerId: string): VoiceHistoryItem[] {
	const result: VoiceHistoryItem[] = [];
	let remaining = 24000;
	for (const message of messages.slice().reverse()) {
		if (message.chatId !== chatId || message.deleted || message.systemType || isOptimisticLopuMessage(message)) continue;
		const assistant = isLopuAssistantMessage(message);
		if (!assistant && message.authorId !== ownerId) continue;
		const text = Array.from(message.text.trim()).slice(-Math.min(12000, remaining)).join('');
		if (!text) continue;
		result.unshift({ role: assistant ? 'assistant' : 'user', text });
		remaining -= Array.from(text).length;
		if (!remaining || result.length >= 20) break;
	}
	return result;
}

// xAI documents conversation.item.create for history seeding. It does not
// request a new response: speech starts only with the next microphone turn.
export const voiceHistoryEvents = (history: VoiceHistoryItem[]) => history.map(item => ({
	type: 'conversation.item.create',
	item: { type: 'message', role: item.role, content: [{ type: item.role === 'assistant' ? 'output_text' : 'input_text', text: item.text }] }
}));
