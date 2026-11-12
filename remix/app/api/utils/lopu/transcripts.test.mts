import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

let calls: string[], denied: boolean, userFails: boolean, pageFails: boolean;
const userInputs: any[] = [];
mock.module(new URL('../messenger/lopuChats.ts', import.meta.url).href, { namedExports: {
	getLopuChat: async (owner: string, id: unknown) => {
		assert.equal(owner, 'owner'); calls.push('membership');
		return denied ? { ok: false, error: 'Chat unavailable' } : { ok: true, chat: { id } };
	},
	createLopuChat: async (owner: string, _input: any, identity: any) => {
		assert.equal(owner, 'owner'); assert.equal(identity.creationKey, 'transcript:request-1');
		calls.push('create-chat'); return { ok: true, chat: { id: 'created-chat' } };
	},
	persistLopuUserTurn: async (owner: string, input: any) => {
		assert.equal(owner, 'owner'); calls.push('user'); userInputs.push(input);
		return userFails ? { ok: false, error: 'Storage quota exceeded' } : { ok: true, messages: [{ id: 'user-turn' }] };
	},
	persistLopuAssistantTurn: async (owner: string, input: any) => {
		assert.equal(owner, 'owner'); assert.equal(input.requestId, 'request-1');
		assert.match(input.text, /\/thing\/transcript-page/); calls.push('assistant');
		return { ok: true, messages: [{ id: 'assistant-turn' }] };
	}
} });
mock.module(new URL('./voice.ts', import.meta.url).href, { namedExports: {
	createTranscriptPage: async (owner: string, session: string, text: string, identity: any) => {
		assert.equal(owner, 'owner'); assert.equal(session, 'voice-session'); assert.equal(identity.requestId, 'request-1');
		calls.push('page'); if (pageFails) throw new Error('Storage unavailable');
		return { id: 'transcript-page', title: 'Saved transcript', text };
	}
} });
const { saveLopuTranscript } = await import('./transcripts');
beforeEach(() => { calls = []; userInputs.length = 0; denied = false; userFails = false; pageFails = false; });
const input = { chatId: 'existing-chat', requestId: 'request-1', sessionId: 'voice-session', transcript: 'Remember the meeting notes.' };

test('transcription keeps the selected chat and returns canonical messages', async () => {
	const saved = await saveLopuTranscript('owner', input);
	assert.equal(saved.chatId, 'existing-chat');
	assert.deepEqual(saved.messages.map((message: any) => message.id), ['user-turn', 'assistant-turn']);
	assert.deepEqual(calls, ['membership', 'user', 'page', 'assistant']);
});
test('a new transcription chat uses a stable creation key and retry identity', async () => {
	const first = await saveLopuTranscript('owner', { ...input, chatId: undefined });
	const retry = await saveLopuTranscript('owner', { ...input, chatId: undefined });
	assert.equal(first.chatId, retry.chatId); assert.deepEqual(userInputs[0], userInputs[1]);
});
test('foreign chat and user storage failures stop before creating transcript content', async () => {
	denied = true; await assert.rejects(saveLopuTranscript('owner', input), /Chat unavailable/);
	assert.deepEqual(calls, ['membership']);
	denied = false; userFails = true; calls = [];
	await assert.rejects(saveLopuTranscript('owner', input), /Storage quota/);
	assert.deepEqual(calls, ['membership', 'user']);
});
test('page failure does not falsely persist a saved-transcript confirmation', async () => {
	pageFails = true; await assert.rejects(saveLopuTranscript('owner', input), /Storage unavailable/);
	assert.deepEqual(calls, ['membership', 'user', 'page']);
});
test('invalid request identities and oversized transcripts fail before storage access', async () => {
	await assert.rejects(saveLopuTranscript('owner', { ...input, requestId: '../invalid' }), /request id/);
	await assert.rejects(saveLopuTranscript('owner', { ...input, transcript: 'x'.repeat(12001) }), /12000/);
	assert.deepEqual(calls, []);
});
