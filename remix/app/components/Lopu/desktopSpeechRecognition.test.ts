import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopSpeechRecognition, speechRecognitionCtor } from './desktopSpeechRecognition';
import type { DesktopSpeechEvent, ThingtimeDesktopBridge } from '../../utils/electronBridge';

function fixture() {
	let listener: ((event: DesktopSpeechEvent) => void) | null = null;
	let request: { sessionId: string; lang: string; continuous?: boolean };
	let rejectStart: (error: Error) => void;
	const stopped: string[] = [];
	const bridge: ThingtimeDesktopBridge = {
		platform: 'darwin', speechRecognitionVersion: '1.0.0',
		onSpeechRecognition: callback => { listener = callback; return () => { listener = null; }; },
		startSpeechRecognition: value => { request = value; return new Promise((_resolve, reject) => { rejectStart = reject; }); },
		stopSpeechRecognition: async value => { stopped.push(value.sessionId); return { ok: true }; }
	};
	return { bridge, stopped, emit: (event: Omit<DesktopSpeechEvent, 'sessionId'>) => listener?.({ ...event, sessionId: request.sessionId }), reject: () => rejectStart(new Error('unavailable')), get listener() { return listener; }, get request() { return request; } };
}

test('Mac desktop never selects the broken Chromium speech service, including old app builds', () => {
	const original = globalThis.window;
	try {
		const f = fixture();
		globalThis.window = { thingtimeDesktop: f.bridge, webkitSpeechRecognition: class {} } as any;
		assert.equal(speechRecognitionCtor(), DesktopSpeechRecognition);
		f.bridge.speechRecognitionVersion = '1.1.0';
		assert.equal(speechRecognitionCtor(), DesktopSpeechRecognition);
		delete f.bridge.speechRecognitionVersion;
		assert.equal(speechRecognitionCtor(), null);
		delete window.thingtimeDesktop;
		assert.equal(speechRecognitionCtor(), window.webkitSpeechRecognition);
	} finally { globalThis.window = original; }
});

test('partial and final transcripts share the web engine contract; end detaches once', () => {
	const f = fixture(), recognition = new DesktopSpeechRecognition(f.bridge), results: unknown[] = [];
	let ended = 0; recognition.onresult = event => results.push(event); recognition.onend = () => ended++;
	recognition.start(); f.emit({ type: 'partial', text: 'Hello' }); f.emit({ type: 'final', text: 'Hello world' }); f.emit({ type: 'end' });
	assert.deepEqual(results, [{ resultIndex: 0, results: [{ 0: { transcript: 'Hello' }, isFinal: false }] }, { resultIndex: 0, results: [{ 0: { transcript: 'Hello world' }, isFinal: true }] }]);
	assert.equal(ended, 1); assert.equal(f.listener, null);
});

test('stop during startup suppresses late permission/start failures and transcripts', async () => {
	const f = fixture(), recognition = new DesktopSpeechRecognition(f.bridge);
	recognition.onerror = recognition.onend = recognition.onresult = () => assert.fail('stale callback');
	recognition.start(); const stale = f.listener!, sessionId = f.request.sessionId; recognition.abort();
	stale({ sessionId, type: 'final', text: 'do not send' }); f.reject(); await Promise.resolve();
	assert.deepEqual(f.stopped, [sessionId]); assert.equal(f.listener, null);
});

test('events from another capture cannot send a turn or end the current capture', () => {
	const f = fixture(), recognition = new DesktopSpeechRecognition(f.bridge);
	recognition.onresult = recognition.onend = () => assert.fail('foreign capture'); recognition.start();
	f.listener!({ sessionId: 'other', type: 'final', text: 'private' }); f.listener!({ sessionId: 'other', type: 'end' });
	assert.ok(f.listener); recognition.abort();
});


test('new desktop builds keep dictation continuous while legacy/private-page utterances retain their boundary', () => {
    for (const version of ['1.0.0', '1.1.0']) for (const continuous of [true, false]) {
        const f = fixture(); f.bridge.speechRecognitionVersion = version;
        const recognition = new DesktopSpeechRecognition(f.bridge); recognition.continuous = continuous;
        recognition.start();
        assert.equal(f.request.continuous, version === '1.1.0' ? continuous : undefined);
        recognition.abort();
    }
});
