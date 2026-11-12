import { randomUUID } from 'node:crypto';
import { createLopuChat, getLopuChat, persistLopuUserTurn, persistLopuAssistantTurn } from '../messenger/lopuChats';
import { createTranscriptPage } from './voice';

// Transcription is an input mode, not a second conversation database. All
// membership checks and storage charges use the same writers as typed turns.
export async function saveLopuTranscript(ownerId: string, input: { chatId?: unknown; requestId?: unknown; transcript: string; sessionId: string }) {
	const requestId = typeof input.requestId === 'string' ? input.requestId : `transcript-${randomUUID()}`;
	if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) throw new Error('Invalid transcript request id.');
	if (Array.from(input.transcript).length > 12000) throw new Error('Please split transcripts longer than 12000 characters.');
	const chat = input.chatId ? await getLopuChat(ownerId, input.chatId) : await createLopuChat(ownerId, { title: input.transcript.slice(0, 80) }, { creationKey: `transcript:${requestId}` });
	if (chat.ok === false) throw new Error(chat.error);
	const turn = await persistLopuUserTurn(ownerId, { chatId: chat.chat.id, requestId, text: input.transcript });
	if (turn.ok === false) throw new Error(turn.error);
	const page = await createTranscriptPage(ownerId, input.sessionId, input.transcript, { chatId: chat.chat.id, requestId });
	const reply = await persistLopuAssistantTurn(ownerId, { chatId: chat.chat.id, requestId, text: `Transcript saved: [${page.title}](/thing/${encodeURIComponent(page.id)})`, lopu: { billing: 'free', provider: 'fallback' } });
	if (reply.ok === false) throw new Error(reply.error);
	return { chatId: chat.chat.id, page, messages: [...turn.messages, ...reply.messages] };
}
