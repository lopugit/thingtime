import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LopuVoiceRealtime } from './lopuVoiceRealtime';

test('direct voice sends chat history before microphone frames and keeps final transcript IDs', async () => {
	const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	const oldSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
	let stopped = 0, closed = 0;
	let processor: any;
	const sent: any[] = [], users: any[] = [], completed: string[] = [];
	class Socket extends EventTarget {
		static OPEN = 1; readyState = 1; binaryType = ''; onmessage: any; onclose: any;
		constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
		send(data: any) { sent.push(typeof data === 'string' ? JSON.parse(data) : data); }
		close() { this.onclose?.(); }
	}
	class Audio {
		destination = {}; currentTime = 0;
		async resume() {}
		async close() { closed++; }
		createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
		createScriptProcessor() { processor = { connect() {}, disconnect() {}, onaudioprocess: null }; return processor; }
	}
	try {
		Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: Audio } });
		Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++; } }] }) } } });
		Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: Socket });
		const voice = new LopuVoiceRealtime({ onActive() {}, onUserTranscript: (...args) => users.push(args), onAssistantStart() {}, onAssistantDelta() {}, onAssistantDone: id => completed.push(id), onError() {} });
		await voice.start({ token: 'test-only', webSocketUrl: 'wss://example.invalid', effort: 'none', textResponse: true, history: [{ role: 'user', text: 'Roses' }, { role: 'assistant', text: 'Remembered' }] });
		processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array([0]) } });
		assert.deepEqual(sent.slice(0, 3).map(event => event.type), ['session.update', 'conversation.item.create', 'conversation.item.create']);
		assert.ok(sent[3] instanceof ArrayBuffer); assert.equal(sent.some(event => event.type === 'response.create'), false);
		const message = (event: any) => (voice as any).handleMessage(JSON.stringify(event), true);
		message({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'utterance', transcript: 'Roses again' });
		message({ type: 'response.created', response: { id: 'reply' } }); message({ type: 'response.done' });
		assert.deepEqual(users, [['Roses again', true, 'utterance']]); assert.deepEqual(completed, ['reply']);
		await voice.stop(); message({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Late result' });
		assert.equal(users.length, 1); assert.equal(stopped, 1); assert.equal(closed, 1);
		// Permission may resolve after the user already pressed Stop. Never
		// open a socket or leave that late microphone stream running.
		let grant!: (stream: any) => void;
		Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } } });
		const cancelled = new LopuVoiceRealtime({ onActive() {}, onUserTranscript() {}, onAssistantStart() {}, onAssistantDelta() {}, onError() {} });
		const opening = cancelled.start({ token: 'test-only', webSocketUrl: 'wss://example.invalid', effort: 'none', textResponse: true });
		await cancelled.stop(); grant({ getTracks: () => [{ stop() { stopped++; } }] }); await opening;
		assert.equal(stopped, 2); assert.equal(sent.length, 4);
	} finally {
		for (const [key, original] of [['window', oldWindow], ['navigator', oldNavigator], ['WebSocket', oldSocket]] as const) {
			if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key);
		}
	}
});
