'use strict';
const { spawn } = require('node:child_process');

const SESSION_ID = /^[A-Za-z0-9-]{1,80}$/u;
const LANGUAGE = /^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8}){0,3}$/u;
const ERRORS = new Set(['speech-denied', 'microphone-denied', 'service-unavailable', 'audio-capture', 'no-speech']);

function requireSpeechSender(event, window, origin) {
	if (!window || window.isDestroyed() || event.sender !== window.webContents ||
		event.senderFrame !== window.webContents.mainFrame || !origin || new URL(event.senderFrame.url).origin !== origin) {
		throw new Error('Speech input requires the bundled Thingtime main window.');
	}
}

class DesktopSpeechRecognition {
	constructor({ executable, spawnProcess = spawn, timeoutMs = 120_000 }) {
		this.executable = executable;
		this.spawnProcess = spawnProcess;
		this.timeoutMs = timeoutMs;
		this.current = null;
	}

	start(request, send) {
		if (typeof request?.sessionId !== 'string' || !SESSION_ID.test(request.sessionId) ||
			typeof request?.lang !== 'string' || !LANGUAGE.test(request.lang)) {
			throw new Error('Invalid speech session.');
		}
		this.stop();
		const { sessionId, lang } = request;
		const child = this.spawnProcess(this.executable, [lang], { stdio: ['pipe', 'pipe', 'ignore'], env: {
			PATH: '/usr/bin:/bin', HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, LANG: process.env.LANG
		} });
		const state = { child, sessionId, timer: null, buffer: '', terminal: false };
		this.current = state;
		const emit = (event) => { if (this.current === state) send({ ...event, sessionId }); };
		const fail = () => {
			if (this.current !== state) return;
			emit({ type: 'error', error: 'service-unavailable' });
			emit({ type: 'end' });
			this.stop(sessionId);
		};
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			if (this.current !== state) return;
			state.buffer += chunk;
			if (Buffer.byteLength(state.buffer, 'utf8') > 256 * 1024) { fail(); return; }
			let newline;
			while ((newline = state.buffer.indexOf('\n')) !== -1) {
				const line = state.buffer.slice(0, newline);
				state.buffer = state.buffer.slice(newline + 1);
				let value;
				try { value = JSON.parse(line); } catch { fail(); return; }
				if (state.terminal || this.current !== state) return;
				if (value?.type === 'partial' || value?.type === 'final') {
					if (typeof value.text !== 'string' || value.text.length > 32_000) { fail(); return; }
					emit({ type: value.type, text: value.text });
				} else if (value?.type === 'error' && ERRORS.has(value.error)) {
					emit({ type: 'error', error: value.error });
				} else if (value?.type === 'ready') {
					emit({ type: 'ready' });
				} else if (value?.type === 'end') {
					state.terminal = true;
					emit({ type: 'end' });
					this.stop(sessionId);
				} else { fail(); return; }
			}
		});
		child.on('error', fail);
		child.on('close', () => { if (this.current === state) fail(); });
		child.stdin.on('error', () => {});
		state.timer = setTimeout(fail, this.timeoutMs);
		state.timer.unref?.();
		return { ok: true };
	}

	stop(sessionId) {
		const state = this.current;
		if (!state || (sessionId !== undefined && sessionId !== state.sessionId)) return { ok: true };
		this.current = null;
		clearTimeout(state.timer);
		state.child.stdin.end();
		state.child.kill();
		return { ok: true };
	}
}
module.exports = { DesktopSpeechRecognition, requireSpeechSender };
