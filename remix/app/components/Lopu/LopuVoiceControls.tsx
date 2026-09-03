import React from 'react';
import { Box, Center, Flex, Input, Popover, PopoverBody, PopoverContent, PopoverTrigger, Switch, Text } from '@chakra-ui/react';
import { keyframes } from '@emotion/react';
import { ArrowUp, AudioLines, Loader2, Mic, Settings2, Square } from 'lucide-react';
import { Link as RouterLink } from 'react-router';

import { getNativeBridge, nativeBridgeMessageEvent } from '~/utils/nativeBridge';
import { LopuRingAvatar } from './LopuActivityBadge';
import { LopuChatView } from './LopuChatView';
import { LopuProviderSelect, type LopuProviderSelectChange } from './LopuModelPicker';
import { readNdjson } from './lopuChatStream';
import { abortLopuTurn, getLopuStoreSnapshot } from './lopuChatStore';
import { LOPU_UI } from './lopuTheme';
import { useLopu } from './useLopu';
import { useLopuChat } from './useLopuChat';
import { useLopuSettings } from './useLopuSettings';

// 🎙️ Lopu's voice engine + the compact controls every voice surface shares
// (the /lopu/voice page and the floating window's voice mode).
//
// `useLopuVoice` owns the microphone: web SpeechRecognition (continuous,
// interim results, auto-restart while a session is on), the iOS native
// bridge (the app owns audio + recognition and posts its own turns while the
// WebView is backgrounded), speechSynthesis for spoken replies, and the
// feedback-loop guard — listening pauses for the whole turn and for Lopu's
// speech so she never transcribes her own voice, then resumes.
//
// Unified mode: every final utterance is one normal chat turn through
// `onFinalTranscript` (the surface routes it through useLopuChat().send — the
// same brain, tools included, the chat's model/provider settings) and the
// reply is read aloud when "Spoken replies" is on. Transcribe mode keeps the
// /api/v1/lopu/voice/reply path — each utterance becomes a private
// transcript page whose quote renders as a Lopu bubble in the transcript
// strip (no AI turn, nothing spoken).

declare global {
	interface Window {
		webkitSpeechRecognition?: new () => any;
		SpeechRecognition?: new () => any;
	}
}

export type LopuVoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking';

export type LopuVoiceItem = {
	id: string;
	role: 'user' | 'assistant';
	text: string;
	at: number;
	// transcribe mode: the utterance quoted back with its private page
	quote?: boolean;
	pageId?: string | null;
	pageTitle?: string | null;
	error?: boolean;
};

type LopuVoiceEvent =
	| { type: 'meta'; mode?: string; provider?: string; sessionId?: string }
	| { type: 'quote'; text: string; page?: { id?: string; title?: string } }
	| { type: 'delta'; text: string }
	| { type: 'error'; error: string }
	| { type: 'done' };

export type UseLopuVoiceOptions = {
	// resolve one final utterance to Lopu's reply text (read aloud when
	// `speak` is on); null/undefined = nothing to speak
	onFinalTranscript: (text: string) => Promise<string | null | undefined | void> | string | null | undefined | void;
	speak: boolean;
	transcribe: boolean;
	// the Secure Vault provider a native (iOS) session posts its turns with
	providerId: string | null;
};

export type UseLopuVoice = {
	// a microphone path exists here (web SpeechRecognition or the iOS bridge)
	supported: boolean;
	nativeReady: boolean;
	// the listening session is on
	active: boolean;
	phase: LopuVoicePhase;
	interim: string;
	// local-only rows: native turns, transcribe quotes, microphone errors
	items: LopuVoiceItem[];
	sessionId: string;
	start: () => void;
	stop: () => void;
	toggle: () => void;
	// the typed path — the same pipeline as a final utterance
	submit: (text: string) => Promise<void>;
	// stop Lopu mid-sentence (speech + the streaming turn)
	interrupt: () => void;
	speakText: (text: string) => Promise<void>;
	clearItems: () => void;
};

const VOICE_REPLY_ENDPOINT = '/api/v1/lopu/voice/reply';
const MAX_LOCAL_ITEMS = 200;
const RECOGNITION_RESTART_MS = 250;

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const speechLang = () => (typeof navigator !== 'undefined' && navigator.language) || 'en-US';

const webRecognitionCtor = () => (typeof window === 'undefined' ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null);

// the reply text the surface hands back should never be read aloud when it
// carries nothing but whitespace
const speakable = (reply: unknown): string | null => (typeof reply === 'string' && reply.trim() ? reply.trim() : null);

// ——— the engine ————————————————————————————————————————————————————————————

export const useLopuVoice = (options: UseLopuVoiceOptions): UseLopuVoice => {
	const lopu = useLopu();
	const optionsRef = React.useRef(options);
	optionsRef.current = options;

	const [active, setActive] = React.useState(false);
	const [busy, setBusy] = React.useState<'thinking' | 'speaking' | null>(null);
	const [interim, setInterim] = React.useState('');
	const [items, setItems] = React.useState<LopuVoiceItem[]>([]);
	const [nativeReady, setNativeReady] = React.useState(false);
	const [webSupported, setWebSupported] = React.useState(false);

	const sessionIdRef = React.useRef(newId('voice'));
	const activeRef = React.useRef(false);
	const nativeSessionRef = React.useRef(false);
	// recognition is paused for a turn / Lopu's speech (the feedback-loop guard)
	const pausedRef = React.useRef(false);
	const recognitionRef = React.useRef<any>(null);
	const restartTimerRef = React.useRef<number | null>(null);
	const queueRef = React.useRef<Promise<void>>(Promise.resolve());
	const startRecognitionRef = React.useRef<() => boolean>(() => false);
	const runTurnRef = React.useRef<(text: string) => Promise<void>>(async () => {});

	// capabilities are read after mount so the server and the first client
	// paint agree
	React.useEffect(() => {
		setWebSupported(!!webRecognitionCtor());
		setNativeReady(!!getNativeBridge()?.isNativeWebView);
	}, []);

	const pushItem = React.useCallback((item: Omit<LopuVoiceItem, 'id' | 'at'> & { id?: string }) => {
		setItems((current) => [...current, { ...item, id: item.id ?? newId(item.role), at: Date.now() }].slice(-MAX_LOCAL_ITEMS));
	}, []);

	const patchItem = React.useCallback((id: string, patch: (item: LopuVoiceItem) => LopuVoiceItem) => {
		setItems((current) => current.map((item) => (item.id === id ? patch(item) : item)));
	}, []);

	const applyVoiceEvent = React.useCallback(
		(assistantId: string, event: LopuVoiceEvent | null | undefined) => {
			if (!event || typeof event !== 'object') return;
			if (event.type === 'delta' && typeof event.text === 'string') {
				const delta = event.text;
				patchItem(assistantId, (item) => ({ ...item, text: item.text + delta }));
			} else if (event.type === 'quote' && typeof event.text === 'string') {
				const quote = event;
				patchItem(assistantId, (item) => ({ ...item, text: quote.text, quote: true, pageId: quote.page?.id ?? null, pageTitle: quote.page?.title ?? null }));
			} else if (event.type === 'error') {
				const message = typeof event.error === 'string' && event.error ? event.error : 'Lopu could not complete this turn.';
				patchItem(assistantId, (item) => ({ ...item, text: message, error: true }));
			}
		},
		[patchItem]
	);

	// ——— speech synthesis ——————————————————————————————————————————————————

	const speakText = React.useCallback(
		(text: string) =>
			new Promise<void>((resolve) => {
				const clean = speakable(text);
				if (!clean || typeof window === 'undefined' || !('speechSynthesis' in window)) {
					resolve();
					return;
				}
				try {
					window.speechSynthesis.cancel();
					const utterance = new SpeechSynthesisUtterance(clean);
					utterance.lang = speechLang();
					utterance.onend = () => resolve();
					utterance.onerror = () => resolve();
					window.speechSynthesis.speak(utterance);
				} catch {
					resolve();
				}
			}),
		[]
	);

	const cancelSpeech = React.useCallback(() => {
		if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
			try {
				window.speechSynthesis.cancel();
			} catch {
				// speech synthesis is best-effort
			}
		}
	}, []);

	// ——— web recognition ———————————————————————————————————————————————————

	const stopRecognition = React.useCallback(() => {
		if (restartTimerRef.current !== null) {
			window.clearTimeout(restartTimerRef.current);
			restartTimerRef.current = null;
		}
		const recognition = recognitionRef.current;
		recognitionRef.current = null;
		if (!recognition) return;
		recognition.onresult = null;
		recognition.onend = null;
		recognition.onerror = null;
		try {
			recognition.abort?.();
		} catch {
			// already stopped
		}
	}, []);

	const startRecognition = React.useCallback((): boolean => {
		if (recognitionRef.current) return true;
		const Recognition = webRecognitionCtor();
		if (!Recognition) return false;
		const recognition = new Recognition();
		recognition.continuous = true;
		recognition.interimResults = true;
		recognition.lang = speechLang();
		recognition.onresult = (event: any) => {
			let preview = '';
			for (let index = event.resultIndex; index < event.results.length; index += 1) {
				const text = event.results[index]?.[0]?.transcript || '';
				if (event.results[index].isFinal) void runTurnRef.current(text);
				else preview += text;
			}
			setInterim(preview);
		};
		recognition.onerror = (event: any) => {
			const code = typeof event?.error === 'string' ? event.error : '';
			// silence and transient hiccups: onend restarts the session
			if (code === 'aborted' || code === 'no-speech') return;
			recognitionRef.current = null;
			activeRef.current = false;
			setActive(false);
			setInterim('');
			pushItem({ role: 'assistant', text: `Microphone unavailable${code ? ` (${code})` : ''}. Type to Lopu instead.`, error: true });
		};
		recognition.onend = () => {
			if (recognitionRef.current !== recognition) return;
			recognitionRef.current = null;
			// browsers end a continuous session after a pause — keep listening
			// while the session is on and not paused for a turn
			if (!activeRef.current || pausedRef.current) return;
			restartTimerRef.current = window.setTimeout(() => {
				restartTimerRef.current = null;
				if (activeRef.current && !pausedRef.current) startRecognitionRef.current();
			}, RECOGNITION_RESTART_MS);
		};
		recognitionRef.current = recognition;
		try {
			recognition.start();
		} catch {
			recognitionRef.current = null;
			return false;
		}
		return true;
	}, [pushItem]);
	startRecognitionRef.current = startRecognition;

	// ——— turns ——————————————————————————————————————————————————————————————

	// transcribe mode: the utterance becomes a private page, quoted back
	const transcribeUtterance = React.useCallback(
		async (text: string) => {
			const assistantId = newId('lopu');
			pushItem({ role: 'user', text });
			pushItem({ id: assistantId, role: 'assistant', text: '' });
			try {
				const response = await fetch(VOICE_REPLY_ENDPOINT, {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
					body: JSON.stringify({ transcript: text, sessionId: sessionIdRef.current, transcribeMode: true })
				});
				await readNdjson(response, (event) => applyVoiceEvent(assistantId, event as unknown as LopuVoiceEvent));
			} catch (error) {
				const message = error instanceof Error && error.message ? error.message : 'Lopu could not save that transcript.';
				patchItem(assistantId, (item) => ({ ...item, text: message, error: true }));
			}
		},
		[applyVoiceEvent, patchItem, pushItem]
	);

	const runTurn = React.useCallback(
		(text: string): Promise<void> => {
			const clean = text.trim();
			if (!clean) return Promise.resolve();
			const run = async () => {
				const current = optionsRef.current;
				// the guard: no microphone while Lopu thinks or speaks
				pausedRef.current = true;
				stopRecognition();
				setInterim('');
				setBusy('thinking');
				try {
					if (current.transcribe) {
						await transcribeUtterance(clean);
					} else {
						const reply = speakable(await current.onFinalTranscript(clean));
						if (optionsRef.current.speak && reply) {
							setBusy('speaking');
							await speakText(reply);
						}
					}
				} catch (error) {
					pushItem({ role: 'assistant', text: error instanceof Error && error.message ? error.message : 'Lopu could not complete this turn.', error: true });
				} finally {
					setBusy(null);
					pausedRef.current = false;
					if (activeRef.current && !nativeSessionRef.current) startRecognitionRef.current();
				}
			};
			queueRef.current = queueRef.current.then(run, run);
			return queueRef.current;
		},
		[pushItem, speakText, stopRecognition, transcribeUtterance]
	);
	runTurnRef.current = runTurn;

	// ——— the iOS bridge ———————————————————————————————————————————————————

	React.useEffect(() => {
		const onMessage = (message: any) => {
			const type = message?.type;
			if (type === 'native-ready') {
				setNativeReady(true);
			} else if (type === 'lopu-voice-transcript' && typeof message.payload?.text === 'string') {
				const assistantId = typeof message.payload.assistantId === 'string' ? message.payload.assistantId : newId('lopu-native');
				pushItem({ role: 'user', text: message.payload.text });
				pushItem({ id: assistantId, role: 'assistant', text: '' });
				setInterim('');
				setBusy('thinking');
			} else if (type === 'lopu-voice-event') {
				const assistantId = message.payload?.assistantId;
				const event = message.payload?.event as LopuVoiceEvent | undefined;
				if (typeof assistantId === 'string') applyVoiceEvent(assistantId, event);
				if (event?.type === 'done' || event?.type === 'error') setBusy(null);
			} else if (type === 'lopu-voice-interim') {
				setInterim(typeof message.payload?.text === 'string' ? message.payload.text : '');
			} else if (type === 'lopu-voice-error') {
				pushItem({ role: 'assistant', text: typeof message.payload?.error === 'string' ? message.payload.error : 'Lopu voice stopped unexpectedly.', error: true });
				activeRef.current = false;
				nativeSessionRef.current = false;
				setActive(false);
				setBusy(null);
			} else if (type === 'lopu-voice-state') {
				const on = message.payload?.active === true;
				activeRef.current = on;
				if (!on) nativeSessionRef.current = false;
				setActive(on);
				if (!on) setBusy(null);
			}
		};
		const listener = ((event: CustomEvent) => onMessage(event.detail)) as EventListener;
		window.addEventListener(nativeBridgeMessageEvent, listener);
		return () => window.removeEventListener(nativeBridgeMessageEvent, listener);
	}, [applyVoiceEvent, pushItem]);

	// ——— session ————————————————————————————————————————————————————————————

	const start = React.useCallback(() => {
		if (activeRef.current) return;
		const current = optionsRef.current;
		const bridge = getNativeBridge();
		if (nativeReady && bridge) {
			nativeSessionRef.current = true;
			activeRef.current = true;
			setActive(true);
			bridge.postMessage({
				type: 'lopu-voice-start',
				payload: { textResponse: !current.speak, transcribeMode: current.transcribe, providerId: current.providerId ?? '', sessionId: sessionIdRef.current }
			});
			return;
		}
		nativeSessionRef.current = false;
		pausedRef.current = false;
		if (!startRecognition()) {
			lopu({
				title: 'No microphone here 🎙️',
				description: 'This browser does not offer speech recognition — type to Lopu below, or use the Thingtime iOS app.',
				status: 'info',
				duration: 8000
			});
			return;
		}
		activeRef.current = true;
		setActive(true);
	}, [lopu, nativeReady, startRecognition]);

	const stop = React.useCallback(() => {
		activeRef.current = false;
		setActive(false);
		if (nativeSessionRef.current) {
			nativeSessionRef.current = false;
			getNativeBridge()?.postMessage({ type: 'lopu-voice-stop' });
		}
		stopRecognition();
		cancelSpeech();
		setInterim('');
		setBusy(null);
	}, [cancelSpeech, stopRecognition]);

	const toggle = React.useCallback(() => {
		if (activeRef.current) stop();
		else start();
	}, [start, stop]);

	const interrupt = React.useCallback(() => {
		cancelSpeech();
		abortLopuTurn();
	}, [cancelSpeech]);

	const clearItems = React.useCallback(() => setItems([]), []);

	// leaving the surface ends the session: microphone, speech, native audio
	React.useEffect(() => {
		return () => {
			activeRef.current = false;
			if (nativeSessionRef.current) {
				nativeSessionRef.current = false;
				getNativeBridge()?.postMessage({ type: 'lopu-voice-stop' });
			}
			stopRecognition();
			cancelSpeech();
		};
	}, [cancelSpeech, stopRecognition]);

	return {
		supported: webSupported || nativeReady,
		nativeReady,
		active,
		phase: busy ?? (active ? 'listening' : 'idle'),
		interim,
		items,
		sessionId: sessionIdRef.current,
		start,
		stop,
		toggle,
		submit: runTurn,
		interrupt,
		speakText,
		clearItems
	};
};

// ——— controls ————————————————————————————————————————————————————————————

const ring = keyframes`
	0% { transform: scale(0.9); opacity: 0.9; }
	70% { transform: scale(1.45); opacity: 0; }
	100% { transform: scale(1.45); opacity: 0; }
`;

const breathe = keyframes`
	0% { transform: scale(1); }
	50% { transform: scale(1.06); }
	100% { transform: scale(1); }
`;

const spin = keyframes`
	to { transform: rotate(360deg); }
`;

export const lopuVoicePhaseLabel = (phase: LopuVoicePhase, supported = true): string => {
	if (phase === 'listening') return 'Listening…';
	if (phase === 'thinking') return 'Thinking…';
	if (phase === 'speaking') return 'Speaking…';
	return supported ? 'Tap to talk' : 'Type to Lopu';
};

// The big microphone: idle (card), listening (the rainbow with a soft pulse),
// thinking (spinner on the alt surface), speaking (rainbow, breathing).
export const LopuMicButton = (props: { phase: LopuVoicePhase; size?: number; onClick: () => void; disabled?: boolean }) => {
	const { phase, onClick, disabled } = props;
	const size = props.size ?? 64;
	const listening = phase === 'listening';
	const speaking = phase === 'speaking';
	const thinking = phase === 'thinking';
	const live = listening || speaking;
	const iconSize = Math.round(size * 0.36);
	const label = phase === 'idle' ? 'Start listening' : 'Stop listening';

	return (
		<Box
			as="button"
			type="button"
			className="lopuMicButton"
			data-phase={phase}
			aria-label={label}
			aria-pressed={phase !== 'idle'}
			title={label}
			disabled={disabled}
			position="relative"
			width={`${size}px`}
			height={`${size}px`}
			flexShrink={0}
			borderRadius="999px"
			background={live ? LOPU_UI.rainbow : thinking ? LOPU_UI.surfaceAlt : LOPU_UI.card}
			border={live ? '1px solid transparent' : LOPU_UI.border}
			color={live ? LOPU_UI.card : LOPU_UI.ink}
			boxShadow={LOPU_UI.shadowCard}
			cursor={disabled ? 'not-allowed' : 'pointer'}
			opacity={disabled ? 0.5 : 1}
			transition={`transform ${LOPU_UI.transitionFast}, background ${LOPU_UI.transition}, box-shadow ${LOPU_UI.transitionFast}`}
			_hover={disabled ? undefined : { transform: 'translateY(-1px)' }}
			_active={disabled ? undefined : { transform: 'translateY(0)' }}
			_focusVisible={{ outline: `2px solid ${LOPU_UI.ink}`, outlineOffset: '3px' }}
			_before={
				listening
					? {
							content: '""',
							position: 'absolute',
							inset: '-4px',
							borderRadius: '999px',
							background: LOPU_UI.rainbowSoft,
							animation: `${ring} 2.2s ease-out infinite`,
							pointerEvents: 'none'
						}
					: undefined
			}
			sx={{
				isolation: 'isolate',
				WebkitTapHighlightColor: 'transparent',
				touchAction: 'manipulation',
				animation: speaking ? `${breathe} 1.4s ease-in-out infinite` : 'none',
				'&::before': { zIndex: -1 },
				'@media (prefers-reduced-motion: reduce)': { animation: 'none', '&::before': { animation: 'none', opacity: 0.6 } }
			}}
			onClick={onClick}
		>
			<Center width="100%" height="100%">
				{thinking ? (
					<Box as="span" display="inline-flex" sx={{ animation: `${spin} 1s linear infinite`, '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }}>
						<Loader2 size={iconSize} strokeWidth={2} />
					</Box>
				) : speaking ? (
					<AudioLines size={iconSize} strokeWidth={2} />
				) : (
					<Mic size={iconSize} strokeWidth={2} />
				)}
			</Center>
		</Box>
	);
};

const DeckIconButton = (props: { label: string; onClick?: () => void; children: React.ReactNode; active?: boolean; size?: number; disabled?: boolean }) => {
	const size = props.size ?? 36;
	return (
		<Center
			as="button"
			type="button"
			aria-label={props.label}
			title={props.label}
			aria-pressed={props.active}
			disabled={props.disabled}
			width={`${size}px`}
			height={`${size}px`}
			flexShrink={0}
			borderRadius="999px"
			border={LOPU_UI.border}
			background={props.active ? LOPU_UI.surfaceAlt : LOPU_UI.card}
			color={props.active ? LOPU_UI.ink : LOPU_UI.muted}
			cursor={props.disabled ? 'not-allowed' : 'pointer'}
			opacity={props.disabled ? 0.5 : 1}
			transition={`background ${LOPU_UI.transitionFast}, color ${LOPU_UI.transitionFast}`}
			_hover={props.disabled ? undefined : { background: LOPU_UI.surfaceHover, color: LOPU_UI.ink }}
			_focusVisible={{ outline: `2px solid ${LOPU_UI.ink}`, outlineOffset: '2px' }}
			sx={{ WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}
			onClick={props.onClick}
		>
			{props.children}
		</Center>
	);
};

const PopoverRow = (props: { label: string; hint: string; children: React.ReactNode }) => (
	<Flex align="center" gap={3} py={1.5}>
		<Box minW={0} flex={1}>
			<Text fontSize="13px" fontWeight={600} color={LOPU_UI.ink} lineHeight="1.3">
				{props.label}
			</Text>
			<Text fontSize="11px" color={LOPU_UI.muted} lineHeight="1.4" whiteSpace="normal">
				{props.hint}
			</Text>
		</Box>
		<Box flexShrink={0}>{props.children}</Box>
	</Flex>
);

// The brain choice the session gear edits: the chat's own { model, providerId }
// (the same value the composer's picker reads and writes).
export type LopuVoiceProviderValue = { model: string | null; providerId: string | null };

// The session gear: a compact popover (never a full-width card pushing the
// conversation down) with Spoken replies, Transcribe mode and the provider
// (the same picker the composer exposes, as a single select).
export const LopuVoiceSettingsPopover = (props: { compact?: boolean; providerValue: LopuVoiceProviderValue; onProviderChange: (choice: LopuProviderSelectChange) => void }) => {
	const { settings, setSpokenReplies, setTranscribe } = useLopuSettings();

	return (
		<Popover placement="top-start" isLazy gutter={10}>
			<PopoverTrigger>
				<Center
					as="button"
					type="button"
					aria-label="Voice settings"
					title="Voice settings"
					width={props.compact ? '36px' : '40px'}
					height={props.compact ? '36px' : '40px'}
					flexShrink={0}
					borderRadius="999px"
					border={LOPU_UI.border}
					background={LOPU_UI.card}
					color={LOPU_UI.muted}
					cursor="pointer"
					transition={`background ${LOPU_UI.transitionFast}, color ${LOPU_UI.transitionFast}`}
					_hover={{ background: LOPU_UI.surfaceHover, color: LOPU_UI.ink }}
					_focusVisible={{ outline: `2px solid ${LOPU_UI.ink}`, outlineOffset: '2px' }}
					sx={{ WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}
				>
					<Settings2 size={16} strokeWidth={2} />
				</Center>
			</PopoverTrigger>
			<PopoverContent
				width={props.compact ? '272px' : '300px'}
				maxWidth="calc(100vw - 24px)"
				border={LOPU_UI.border}
				borderRadius={LOPU_UI.radiusLg}
				background={LOPU_UI.card}
				boxShadow={LOPU_UI.shadowFloating}
				_focusVisible={{ outline: 'none' }}
				_focus={{ boxShadow: LOPU_UI.shadowFloating }}
			>
				<PopoverBody px={4} py={3}>
					<Text sx={LOPU_UI.eyebrow} mb={1}>
						Voice session
					</Text>
					<PopoverRow label="Spoken replies" hint="Read Lopu's replies aloud">
						<Switch size="sm" isChecked={settings.spokenReplies} onChange={(event) => setSpokenReplies(event.target.checked)} aria-label="Spoken replies" />
					</PopoverRow>
					<PopoverRow label="Transcribe mode" hint="Save each utterance as a private page instead of asking Lopu">
						<Switch size="sm" isChecked={settings.transcribe} onChange={(event) => setTranscribe(event.target.checked)} aria-label="Transcribe mode" />
					</PopoverRow>
					<Box pt={1.5}>
						<Text fontSize="13px" fontWeight={600} color={LOPU_UI.ink} mb={1}>
							Provider
						</Text>
						<LopuProviderSelect
							value={props.providerValue}
							onChange={props.onProviderChange}
							compact
							disabled={settings.transcribe}
							maxWidth="100%"
							aria-label="AI provider"
							defaultLabel="Thingtime default"
						/>
						<Text fontSize="11px" color={LOPU_UI.muted} mt={1.5} lineHeight="1.4">
							<RouterLink to="/settings#secure-vault" style={{ textDecoration: 'underline' }}>
								Manage providers in Secure Vault
							</RouterLink>
						</Text>
					</Box>
				</PopoverBody>
			</PopoverContent>
		</Popover>
	);
};

// Local-only rows (native turns, transcribe quotes, microphone errors) as
// the same bubbles the conversation uses: viewer right on ink, Lopu left on
// the card with the 28px ring avatar.
// TODO(lopu-integration): interleave these into LopuChatView's list once it
// exposes a local-items slot; until then they sit directly under it.
export const LopuVoiceTranscript = (props: { items: LopuVoiceItem[]; compact?: boolean }) => {
	const { items, compact } = props;
	const scrollRef = React.useRef<HTMLDivElement | null>(null);

	React.useLayoutEffect(() => {
		const element = scrollRef.current;
		if (element) element.scrollTop = element.scrollHeight;
	}, [items]);

	if (!items.length) return null;

	return (
		<Box ref={scrollRef} className="lopuVoiceTranscript" flexShrink={0} maxH="38%" overflowY="auto" overflowX="hidden" px={compact ? 2 : 1} py={2}>
			<Flex direction="column" gap={2} maxW={LOPU_UI.conversationMaxWidth} mx="auto">
				{items.map((item, index) => {
					if (item.role === 'user') {
						return (
							<Box key={item.id} alignSelf="flex-end" maxW="78%" px={3.5} py={2} fontSize={LOPU_UI.fontBody} lineHeight="1.5" sx={LOPU_UI.userBubble} whiteSpace="pre-wrap" wordBreak="break-word">
								{item.text}
							</Box>
						);
					}
					const previous = items[index - 1];
					const showAvatar = !previous || previous.role !== 'assistant';
					return (
						<Flex key={item.id} align="flex-start" gap={2} maxW="100%">
							<Box width="28px" flexShrink={0} pt="1px">
								{showAvatar ? <LopuRingAvatar size={28} /> : null}
							</Box>
							<Box maxW="min(100%, 720px)" minW={0} px={3.5} py={2} fontSize={LOPU_UI.fontBody} lineHeight="1.5" color={item.error ? LOPU_UI.muted : LOPU_UI.ink} sx={LOPU_UI.lopuBubble} whiteSpace="pre-wrap" wordBreak="break-word">
								{item.quote ? (
									<Text sx={LOPU_UI.eyebrow} mb={1}>
										Transcript
									</Text>
								) : null}
								{item.text || '…'}
								{item.pageId ? (
									<Text mt={1.5} fontSize={LOPU_UI.fontSmall}>
										<RouterLink to={`/thing/${encodeURIComponent(item.pageId)}`} style={{ textDecoration: 'underline' }}>
											{item.pageTitle || 'Open the private transcript page'} ↗
										</RouterLink>
									</Text>
								) : null}
							</Box>
						</Flex>
					);
				})}
			</Flex>
		</Box>
	);
};

// The bottom deck: interim transcript line, gear · mic · stop, and the typed
// path (a single rounded field, Enter sends, the send button on the rainbow).
export const LopuVoiceDeck = (props: {
	voice: UseLopuVoice;
	compact?: boolean;
	disabled?: boolean;
	providerValue: LopuVoiceProviderValue;
	onProviderChange: (choice: LopuProviderSelectChange) => void;
}) => {
	const { voice, compact = false, disabled = false } = props;
	const [draft, setDraft] = React.useState('');
	const busy = voice.phase === 'thinking' || voice.phase === 'speaking';
	const canSend = !disabled && draft.trim().length > 0;

	const submitTyped = React.useCallback(() => {
		const text = draft.trim();
		if (!text || disabled) return;
		setDraft('');
		void voice.submit(text);
	}, [disabled, draft, voice]);

	return (
		<Box className="lopuVoiceDeck" flexShrink={0} pt={compact ? 2 : 3} px={compact ? 2 : 0} pb={compact ? 2 : 0}>
			<Text fontSize="13px" color={LOPU_UI.muted} fontStyle="italic" textAlign="center" minH="20px" noOfLines={2} px={2} aria-live="polite">
				{voice.interim}
			</Text>
			<Flex align="center" justify="center" gap={compact ? 3 : 5} py={compact ? 1 : 2}>
				<LopuVoiceSettingsPopover compact={compact} providerValue={props.providerValue} onProviderChange={props.onProviderChange} />
				<Flex direction="column" align="center" gap={compact ? 0 : 1.5}>
					<LopuMicButton phase={voice.phase} size={compact ? 48 : 64} onClick={voice.toggle} disabled={disabled} />
					{compact ? null : (
						<Text fontSize={LOPU_UI.fontSmall} color={LOPU_UI.muted} lineHeight="1">
							{lopuVoicePhaseLabel(voice.phase, voice.supported)}
						</Text>
					)}
				</Flex>
				{busy ? (
					<DeckIconButton label="Stop Lopu" onClick={voice.interrupt} size={compact ? 36 : 40}>
						<Square size={14} strokeWidth={2} />
					</DeckIconButton>
				) : (
					<Box width={compact ? '36px' : '40px'} height={compact ? '36px' : '40px'} flexShrink={0} aria-hidden />
				)}
			</Flex>
			<Flex
				align="center"
				gap={2}
				border={LOPU_UI.border}
				borderRadius="999px"
				background={LOPU_UI.card}
				pl={4}
				pr={1}
				py={1}
				maxW={LOPU_UI.composerMaxWidth}
				mx="auto"
				transition={`border-color ${LOPU_UI.transitionFast}`}
				_focusWithin={{ borderColor: LOPU_UI.faint }}
			>
				<Input
					variant="unstyled"
					value={draft}
					placeholder={busy ? 'Lopu is replying…' : 'Or type to Lopu…'}
					aria-label="Type to Lopu"
					fontSize={LOPU_UI.fontBody}
					height="32px"
					isDisabled={disabled}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
						event.preventDefault();
						submitTyped();
					}}
				/>
				<Center
					as="button"
					type="button"
					aria-label="Send"
					title="Send (Enter)"
					disabled={!canSend}
					width="32px"
					height="32px"
					flexShrink={0}
					borderRadius="999px"
					background={canSend ? LOPU_UI.rainbow : LOPU_UI.surfaceAlt}
					color={canSend ? LOPU_UI.card : LOPU_UI.faint}
					cursor={canSend ? 'pointer' : 'not-allowed'}
					transition={`background ${LOPU_UI.transition}, transform ${LOPU_UI.transitionFast}`}
					_hover={canSend ? { transform: 'translateY(-1px)' } : undefined}
					_focusVisible={{ outline: `2px solid ${LOPU_UI.ink}`, outlineOffset: '2px' }}
					onClick={submitTyped}
				>
					<ArrowUp size={16} strokeWidth={2.2} />
				</Center>
			</Flex>
		</Box>
	);
};

// ——— the surface ————————————————————————————————————————————————————————————

export type LopuVoiceSurfaceProps = {
	chatId?: string | null;
	onChatChange?: (chatId: string | null) => void;
	compact?: boolean;
	onOpenFull?: () => void;
	onPhaseChange?: (phase: LopuVoicePhase) => void;
};

// The conversation column in voice mode: the shared LopuChatView (its text
// composer dock folded away — the deck carries the typed path), the local
// transcript strip, and the deck. Each final utterance is a normal chat turn
// with the chat's own model/provider settings.
export const LopuVoiceSurface = ({ chatId, onChatChange, compact = false, onOpenFull, onPhaseChange }: LopuVoiceSurfaceProps) => {
	const chat = useLopuChat({ chatId });
	const { settings, setProviderId } = useLopuSettings();
	const sendRef = React.useRef(chat.send);
	sendRef.current = chat.send;
	const setChatSettingsRef = React.useRef(chat.setSettings);
	setChatSettingsRef.current = chat.setSettings;

	const onFinalTranscript = React.useCallback(async (text: string) => {
		const result = await sendRef.current(text);
		// a turn that never left (sign-in, still replying) already toasted
		if (!result.ok) return null;
		const turn = getLopuStoreSnapshot().turns[result.requestId];
		// an aborted or failed turn is never read aloud
		return turn && turn.status === 'done' ? turn.text : null;
	}, []);

	// the gear edits the chat's own brain (the composer picker's value) and
	// mirrors a vault choice into the voice preference the native bridge reads
	const providerValue = React.useMemo<LopuVoiceProviderValue>(() => ({ model: chat.settings.model, providerId: chat.settings.providerId }), [chat.settings.model, chat.settings.providerId]);
	const onProviderChange = React.useCallback(
		(choice: LopuProviderSelectChange) => {
			setChatSettingsRef.current({ model: choice.model, providerId: choice.providerId });
			setProviderId(choice.providerId);
		},
		[setProviderId]
	);

	const voice = useLopuVoice({
		onFinalTranscript,
		speak: settings.spokenReplies,
		transcribe: settings.transcribe,
		providerId: chat.settings.providerId ?? settings.providerId
	});

	React.useEffect(() => {
		onPhaseChange?.(voice.phase);
	}, [onPhaseChange, voice.phase]);

	return (
		<Flex className="lopuVoiceSurface" direction="column" flex={1} minH={0} minW={0} width="100%" sx={{ '& .lopuComposerDock, & .lopuComposer': { display: 'none' } }}>
			<LopuChatView chatId={chatId} onChatChange={onChatChange} compact={compact} showConversations={false} onOpenFull={onOpenFull} autoFocus={false} />
			<LopuVoiceTranscript items={voice.items} compact={compact} />
			<LopuVoiceDeck voice={voice} compact={compact} disabled={!chat.viewer.id} providerValue={providerValue} onProviderChange={onProviderChange} />
		</Flex>
	);
};
