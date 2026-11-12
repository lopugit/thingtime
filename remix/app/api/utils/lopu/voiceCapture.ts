import { createHash } from 'node:crypto';
import { createLopuChat, getLopuChat, persistLopuUserTurn, persistLopuAssistantTurn } from '../messenger/lopuChats';

export type VoiceCapture = { sessionId: string; eventId: string; chatId: string | null; role: 'user' | 'assistant'; text: string };
export function parseVoiceCapture(raw: unknown): VoiceCapture {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Send a completed voice transcript.');
	const value = raw as Record<string, unknown>;
	for (const field of ['sessionId', 'eventId']) {
		if (typeof value[field] !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value[field] as string)) throw new TypeError(`Invalid ${field}.`);
	}
	if (value.chatId != null && (typeof value.chatId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.chatId))) throw new TypeError('Invalid chatId.');
	if (value.role !== 'user' && value.role !== 'assistant') throw new TypeError('Invalid transcript role.');
	const text = typeof value.text === 'string' ? value.text.trim() : '';
	if (!text || Array.from(text).length > 12000) throw new TypeError('Voice transcripts must contain 1–12000 characters.');
	return { sessionId: value.sessionId as string, eventId: value.eventId as string, chatId: value.chatId as string ?? null, role: value.role, text };
}

// Saving a device-reported transcript makes no inference call and never runs
// tools. Membership, quota accounting and exact-content retries use the same
// writers as typed conversations. The client cannot supply billing/tool meta.
export async function saveVoiceCapture(ownerId: string, input: VoiceCapture) {
	const chat = input.chatId ? await getLopuChat(ownerId, input.chatId)
		: await createLopuChat(ownerId, { title: input.text.slice(0, 80) }, { creationKey: `voice-capture:${input.sessionId}` });
	if (chat.ok === false) return chat;
	const requestId = `voice-${createHash('sha256').update(JSON.stringify([input.sessionId, input.role, input.eventId])).digest('hex')}`;
	const base = { chatId: chat.chat.id, requestId, text: input.text };
	const saved = input.role === 'user' ? await persistLopuUserTurn(ownerId, base)
		: await persistLopuAssistantTurn(ownerId, { ...base, requireExactReplay: true, lopu: { provider: 'vault', providerLabel: 'Direct voice · device-reported transcript', billing: 'byo' } });
	if (saved.ok === false) return saved;
	return { ok: true as const, ownerId, chatId: chat.chat.id, messages: saved.messages, existing: saved.existing === true };
}
