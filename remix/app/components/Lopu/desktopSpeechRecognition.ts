import { getElectronBridge, type ThingtimeDesktopBridge, type DesktopSpeechEvent } from '~/utils/electronBridge';

type SpeechResult = { resultIndex: number; results: Array<{ 0: { transcript: string }; isFinal: boolean }> };
const desktopSpeechErrors: Record<string, string> = {
	'speech-denied': 'Allow Thingtime in System Settings → Privacy & Security → Speech Recognition, then try again.',
	'microphone-denied': 'Allow Thingtime in System Settings → Privacy & Security → Microphone, then try again.',
	'audio-capture': 'Your microphone could not start. Check the selected input in System Settings → Sound.',
	'service-unavailable': 'Mac speech recognition is unavailable. Check your connection and dictation language, then try again.'
};
export const desktopSpeechErrorMessage = (code: string) => desktopSpeechErrors[code] || 'Voice input could not start. Try again.';

// Adapts the versioned desktop bridge to the existing voice engine, preserving
// its turn queue, provider selection, pause-for-reply and spoken-reply guard.
export class DesktopSpeechRecognition {
	continuous = true;
	interimResults = true;
	lang = 'en-US';
	onresult: ((event: SpeechResult) => void) | null = null;
	onerror: ((event: { error: string; message?: string }) => void) | null = null;
	onend: (() => void) | null = null;
	private sessionId: string | null = null;
	private unsubscribe: (() => void) | null = null;
	constructor(private bridge: ThingtimeDesktopBridge = getElectronBridge()!) {}

	start() {
		if (this.sessionId) return;
		const sessionId = crypto.randomUUID();
		this.sessionId = sessionId;
		this.unsubscribe = this.bridge.onSpeechRecognition!((event: DesktopSpeechEvent) => {
			if (this.sessionId !== sessionId || event.sessionId !== sessionId) return;
			if (event.type === 'partial' || event.type === 'final') {
				this.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: event.text || '' }, isFinal: event.type === 'final' }] });
			} else if (event.type === 'error') {
				const code = event.error || 'service-unavailable';
				this.onerror?.({ error: code, message: desktopSpeechErrorMessage(code) });
			} else if (event.type === 'end') {
				this.detach();
				this.onend?.();
			}
		});
		void this.bridge.startSpeechRecognition!({ sessionId, lang: this.lang }).catch(() => {
			if (this.sessionId !== sessionId) return;
			this.detach();
			this.onerror?.({ error: 'service-unavailable', message: desktopSpeechErrorMessage('service-unavailable') });
			this.onend?.();
		});
	}

	private detach() {
		this.sessionId = null;
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	abort() {
		const sessionId = this.sessionId;
		this.detach();
		if (sessionId) void this.bridge.stopSpeechRecognition!({ sessionId }).catch(() => {});
	}
}

export const speechRecognitionCtor = () => {
	if (typeof window === 'undefined') return null;
	const bridge = getElectronBridge();
	if (bridge?.platform === 'darwin') {
		// Electron exposes Chromium's constructor even though its remote speech
		// service is unavailable. Never fall back to that false capability.
		return bridge.speechRecognitionVersion === '1.0.0' && bridge.startSpeechRecognition &&
			bridge.stopSpeechRecognition && bridge.onSpeechRecognition ? DesktopSpeechRecognition : null;
	}
	return window.SpeechRecognition || window.webkitSpeechRecognition || null;
};
