'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { DesktopSpeechRecognition, requireSpeechSender } = require('../lib/speech-recognition.cjs');

function fixture(continuous = false) {
	const children = [], events = [];
	const speech = new DesktopSpeechRecognition({ executable: '/bundled/ThingtimeSpeech', spawnProcess: (file, args, options) => {
		assert.equal(file, '/bundled/ThingtimeSpeech');
		assert.deepEqual(args, continuous ? ['en-AU', 'continuous'] : ['en-AU']);
		assert.equal(options.shell, undefined);
		assert.deepEqual(Object.keys(options.env).sort(), ['HOME', 'LANG', 'PATH', 'TMPDIR']);
		const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough();
		child.kill = () => { child.killed = true; }; children.push(child); return child;
	} });
	const start = (sessionId = 'session-1') => speech.start({ sessionId, lang: 'en-AU', ...(continuous ? { continuous } : {}) }, value => events.push(value));
	return { speech, children, events, start };
}

test('only the bundled top-level window can start or stop speech', () => {
	const frame = { url: 'http://127.0.0.1:1234/voice' }, sender = { mainFrame: frame };
	const window = { isDestroyed: () => false, webContents: sender };
	assert.doesNotThrow(() => requireSpeechSender({ sender, senderFrame: frame }, window, 'http://127.0.0.1:1234'));
	for (const event of [{ sender: {}, senderFrame: frame }, { sender, senderFrame: { ...frame } }]) {
		assert.throws(() => requireSpeechSender(event, window, 'http://127.0.0.1:1234'));
	}
	assert.throws(() => requireSpeechSender({ sender, senderFrame: frame }, window, 'https://evil.example'));
});

test('partial/final frames are bounded, projected and scoped to their session', () => {
	const f = fixture(); f.start(); const child = f.children[0];
	child.stdout.write('{"type":"par');
	child.stdout.write('tial","text":"Hello","private":"redacted"}\n{"type":"final","text":"Hello"}\n{"type":"end"}\n');
	assert.deepEqual(f.events, [{ sessionId: 'session-1', type: 'partial', text: 'Hello' }, { sessionId: 'session-1', type: 'final', text: 'Hello' }, { sessionId: 'session-1', type: 'end' }]);
	assert.equal(child.killed, true); assert.equal(f.speech.current, null);
});

test('cancel, replacement and delayed child events never touch a newer session', () => {
	const f = fixture(); f.start(); const old = f.children[0]; f.start('session-2');
	assert.equal(old.killed, true);
	old.stdout.write('{"type":"final","text":"stale"}\n'); old.emit('close');
	f.speech.stop('session-1'); assert.equal(f.children[1].killed, undefined);
	f.speech.stop('session-2'); f.children[1].stdout.write('{"type":"final","text":"late"}\n');
	assert.deepEqual(f.events, []); assert.equal(f.speech.current, null);
});

test('malformed/oversize helper output and crashes release capture without leaking details', () => {
	for (const input of ['not JSON\n', 'x'.repeat(256 * 1024 + 1), '{"type":"error","error":"private path"}\n']) {
		const f = fixture(); f.start(); f.children[0].stdout.write(input);
		assert.deepEqual(f.events.map(event => event.type), ['error', 'end']); assert.equal(f.children[0].killed, true);
	}
	const f = fixture(); f.start(); f.children[0].emit('error', new Error('private path'));
	assert.deepEqual(f.events.map(event => event.type), ['error', 'end']);
});

test('invalid language and session cannot spawn a helper', () => {
	const f = fixture();
	for (const request of [{ sessionId: '../bad', lang: 'en-US' }, { sessionId: 'valid', lang: '--file=/etc/passwd' }, null]) assert.throws(() => f.speech.start(request, () => {}));
	assert.equal(f.children.length, 0);
});


test('continuous dictation is an explicit bounded mode, not a native silence cutoff', () => {
    const f = fixture(true); f.start(); assert.equal(f.children.length, 1); f.speech.stop();
    const invalid = fixture();
    assert.throws(() => invalid.speech.start({ sessionId: 'valid', lang: 'en-AU', continuous: 'continuous' }, () => {}));
    assert.equal(invalid.children.length, 0);
});
