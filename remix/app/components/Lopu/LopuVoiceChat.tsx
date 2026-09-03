import React from 'react';
import { Badge, Box, Button, Flex, IconButton, Input, Select, Switch, Text } from '@chakra-ui/react';
import { Mic, Send, Settings as SettingsIcon, Square, X } from 'lucide-react';
import { Link } from 'react-router';

import { useCurrentUser } from '~/hooks/useCurrentUser';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { getNativeBridge, nativeBridgeMessageEvent } from '~/utils/nativeBridge';
import { LopuVoiceRealtime } from './lopuVoiceRealtime';

type VoiceSettings = {
	textResponse: boolean;
	transcribeMode: boolean;
	providerId: string;
	inputMode: 'native-transcript' | 'provider-audio';
	model: string;
	customModel: string;
	effort: string;
	speed: 'normal' | 'fast';
};
type ProviderEntry = { id: string; name: string; provider?: string };
type ProviderModel = { id: string; label: string; efforts: readonly string[]; speeds: readonly ('normal' | 'fast')[]; audioInput?: 'realtime' };
type ProviderTemplate = { id: string; label: string; endpoint: string; models: readonly ProviderModel[] };
type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; quote?: boolean; pageId?: string; pageTitle?: string; error?: boolean };
declare global {
	interface Window {
		webkitSpeechRecognition?: new () => any;
		SpeechRecognition?: new () => any;
	}
}

const defaultSettings: VoiceSettings = {
	textResponse: false,
	transcribeMode: false,
	providerId: '',
	inputMode: 'native-transcript',
	model: '',
	customModel: '',
	effort: '',
	speed: 'normal'
};

const cachedSettings = (key: string): VoiceSettings => ({ ...defaultSettings, ...(readLocalCache<Partial<VoiceSettings>>(key) || {}) });

const messageId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const LopuVoiceChat = () => {
	const user = useCurrentUser();
	const settingsKey = user ? `tt-lopu-voice-settings-${user.id}` : 'tt-lopu-voice-settings';
	const [settings, setSettings] = React.useState<VoiceSettings>(() => cachedSettings(settingsKey));
	const [providers, setProviders] = React.useState<ProviderEntry[]>([]);
	const [templates, setTemplates] = React.useState<ProviderTemplate[]>([]);
	const [messages, setMessages] = React.useState<ChatMessage[]>([]);
	const [draft, setDraft] = React.useState('');
	const [active, setActive] = React.useState(false);
	const [settingsOpen, setSettingsOpen] = React.useState(true);
	const [interim, setInterim] = React.useState('');
	const [nativeReady, setNativeReady] = React.useState(() => !!getNativeBridge()?.isNativeWebView);
	const sessionIdRef = React.useRef(`voice-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const settingsKeyRef = React.useRef(settingsKey);
	const recognitionRef = React.useRef<any>(null);
	const realtimeRef = React.useRef<LopuVoiceRealtime | null>(null);
	const startRef = React.useRef<() => void>(() => {});
	const webResumeRequestedRef = React.useRef(false);
	const turnQueueRef = React.useRef<Promise<void>>(Promise.resolve());
	const settingsRef = React.useRef(settings);
	const historyRef = React.useRef<ChatMessage[]>([]);
	const scrollRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		if (settingsKeyRef.current !== settingsKey) {
			settingsKeyRef.current = settingsKey;
			const next = cachedSettings(settingsKey);
			settingsRef.current = next;
			setSettings(next);
			return;
		}
		settingsRef.current = settings;
		writeLocalCache(settingsKey, settings);
	}, [settings, settingsKey]);

	React.useEffect(() => {
		historyRef.current = messages;
		scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
	}, [messages, interim]);

	React.useEffect(() => {
		let cancelled = false;
		fetch('/api/v1/lopu/vault', { credentials: 'include', cache: 'no-store' })
			.then(async (response) => {
				const payload = await response.json();
				if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Provider list unavailable.');
				if (cancelled) return;
				const next = (payload.entries || []).filter((entry: any) => entry.kind === 'provider');
				setProviders(next);
				const nextTemplates = Array.isArray(payload.providerTemplates) ? payload.providerTemplates : [];
				setTemplates(nextTemplates);
				setSettings((current) => {
					const provider = next.find((entry: ProviderEntry) => entry.id === current.providerId) || next[0];
					if (!provider) return current;
					const template = nextTemplates.find((entry: ProviderTemplate) => entry.id === provider.provider);
					const model = current.model || template?.models?.[0]?.id || '';
					const modelInfo = template?.models?.find((entry: ProviderModel) => entry.id === model);
					return {
						...current,
						providerId: provider.id,
						model,
						effort: current.effort || modelInfo?.efforts?.[0] || '',
						speed: modelInfo?.speeds?.includes(current.speed) ? current.speed : modelInfo?.speeds?.[0] || 'normal'
					};
				});
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	const selectedProvider = providers.find((provider) => provider.id === settings.providerId);
	const selectedTemplate = templates.find((template) => template.id === selectedProvider?.provider);
	const selectedModel = selectedTemplate?.models.find((model) => model.id === settings.model);
	const effectiveModel = settings.model === '__custom__' ? settings.customModel.trim() : settings.model;
	const directAudioAvailable = selectedModel?.audioInput === 'realtime';
	const effortOptions = selectedModel?.efforts.length ? selectedModel.efforts : ['none', 'low', 'medium', 'high'];
	const speedOptions = selectedModel?.speeds.length ? selectedModel.speeds : ['normal', 'fast'];

	const selectProvider = (providerId: string) => {
		const provider = providers.find((entry) => entry.id === providerId);
		const template = templates.find((entry) => entry.id === provider?.provider);
		const model = template?.models[0];
		setSettings((current) => ({
			...current,
			providerId,
			model: model?.id || '__custom__',
			customModel: model ? '' : current.customModel,
			effort: model?.efforts[0] || '',
			speed: model?.speeds[0] || 'normal',
			inputMode: 'native-transcript'
		}));
	};

	const selectModel = (modelId: string) => {
		const model = selectedTemplate?.models.find((entry) => entry.id === modelId);
		setSettings((current) => ({
			...current,
			model: modelId,
			effort: model?.efforts[0] || '',
			speed: model?.speeds[0] || 'normal',
			inputMode: model?.audioInput === 'realtime' ? current.inputMode : 'native-transcript'
		}));
	};

	const applyEvent = React.useCallback((event: any, assistantId: string, spoken: { text: string }) => {
		if (event?.type === 'delta' && typeof event.text === 'string') {
			spoken.text += event.text;
			setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, text: message.text + event.text } : message));
		} else if (event?.type === 'quote' && typeof event.text === 'string') {
			spoken.text = event.text;
			setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, text: event.text, quote: true, pageId: event.page?.id, pageTitle: event.page?.title } : message));
		} else if (event?.type === 'error') {
			setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, text: event.error || 'Lopu could not complete this turn.', error: true } : message));
		}
	}, []);

	const sendTurn = React.useCallback(async (transcript: string, options: { fromNative?: boolean } = {}) => {
		const clean = transcript.trim();
		if (!clean || !user) return;
		const assistantId = messageId('lopu');
		const prior = historyRef.current;
		setMessages((current) => [...current, { id: messageId('you'), role: 'user', text: clean }, { id: assistantId, role: 'assistant', text: '' }]);
		setDraft('');
		setInterim('');
		if (options.fromNative) return;
		const spoken = { text: '' };
		try {
			const response = await fetch('/api/v1/lopu/voice/reply', {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
				body: JSON.stringify({
					transcript: clean,
					sessionId: sessionIdRef.current,
					providerId: settingsRef.current.providerId,
					model: settingsRef.current.model === '__custom__' ? settingsRef.current.customModel.trim() : settingsRef.current.model,
					effort: settingsRef.current.effort,
					speed: settingsRef.current.speed,
					transcribeMode: settingsRef.current.transcribeMode,
					history: prior.filter((message) => !message.error).slice(-20).map((message) => ({ role: message.role, content: message.text }))
				})
			});
			if (!response.ok || !response.body) {
				const payload = await response.json().catch(() => ({}));
				throw new Error(payload?.error || `Lopu reply failed (${response.status}).`);
			}
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			for (;;) {
				const { done, value } = await reader.read();
				buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';
				for (const line of lines) if (line.trim()) applyEvent(JSON.parse(line), assistantId, spoken);
				if (done) break;
			}
			if (buffer.trim()) applyEvent(JSON.parse(buffer), assistantId, spoken);
			if (!settingsRef.current.textResponse && !settingsRef.current.transcribeMode && spoken.text && 'speechSynthesis' in window) {
				window.speechSynthesis.cancel();
				await new Promise<void>((resolve) => {
					const utterance = new SpeechSynthesisUtterance(spoken.text);
					utterance.onend = () => resolve();
					utterance.onerror = () => resolve();
					window.speechSynthesis.speak(utterance);
				});
			}
		} catch (error) {
			setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, text: error instanceof Error ? error.message : 'Lopu could not complete this turn.', error: true } : message));
		}
	}, [applyEvent, user]);

	const enqueueTurn = React.useCallback((transcript: string) => {
		const webRecognition = recognitionRef.current;
		const shouldResumeWebRecognition = !!webRecognition;
		if (webRecognition) {
			webResumeRequestedRef.current = true;
			webRecognition.onresult = null;
			webRecognition.onend = null;
			webRecognition.abort?.();
			recognitionRef.current = null;
			setActive(false);
		}
		turnQueueRef.current = turnQueueRef.current
			.then(() => sendTurn(transcript))
			.catch(() => {})
			.finally(() => {
				if (shouldResumeWebRecognition && webResumeRequestedRef.current) startRef.current();
			});
	}, [sendTurn]);

	React.useEffect(() => {
		const onMessage = (message: any) => {
			if (message?.type === 'native-ready') setNativeReady(true);
			if (message?.type === 'lopu-voice-transcript' && typeof message.payload?.text === 'string') {
				const assistantId = typeof message.payload.assistantId === 'string' ? message.payload.assistantId : messageId('lopu-native');
				setMessages((current) => [
					...current,
					{ id: messageId('you-native'), role: 'user', text: message.payload.text },
					{ id: assistantId, role: 'assistant', text: '' }
				]);
			}
			if (message?.type === 'lopu-voice-event' && message.payload?.assistantId) {
				applyEvent(message.payload.event, message.payload.assistantId, { text: '' });
			}
			if (message?.type === 'lopu-voice-realtime-user' && typeof message.payload?.text === 'string') {
				setMessages((current) => [...current, { id: messageId('you-realtime-native'), role: 'user', text: message.payload.text }]);
			}
			if (message?.type === 'lopu-voice-realtime-assistant-start' && typeof message.payload?.assistantId === 'string') {
				setMessages((current) => current.some((entry) => entry.id === message.payload.assistantId) ? current : [...current, { id: message.payload.assistantId, role: 'assistant', text: '' }]);
			}
			if (message?.type === 'lopu-voice-interim') setInterim(typeof message.payload?.text === 'string' ? message.payload.text : '');
			if (message?.type === 'lopu-voice-error') {
				setMessages((current) => [...current, { id: messageId('native-error'), role: 'assistant', text: message.payload?.error || 'Lopu voice stopped unexpectedly.', error: true }]);
				setActive(false);
			}
			if (message?.type === 'lopu-voice-state') setActive(message.payload?.active === true);
		};
		const domListener = ((event: CustomEvent) => onMessage(event.detail)) as EventListener;
		window.addEventListener(nativeBridgeMessageEvent, domListener);
		return () => {
			window.removeEventListener(nativeBridgeMessageEvent, domListener);
		};
	}, [applyEvent]);

	const start = React.useCallback(async () => {
		if (active) return;
		const bridge = getNativeBridge();
		if (nativeReady && bridge) {
			bridge.postMessage({ type: 'lopu-voice-start', payload: { ...settingsRef.current, sessionId: sessionIdRef.current } });
			setActive(true);
			setSettingsOpen(false);
			return;
		}
		if (settingsRef.current.inputMode === 'provider-audio' && !settingsRef.current.transcribeMode) {
			try {
				const response = await fetch('/api/v1/lopu/voice/session', {
					method: 'POST',
					credentials: 'include',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						providerId: settingsRef.current.providerId,
						model: settingsRef.current.model === '__custom__' ? settingsRef.current.customModel.trim() : settingsRef.current.model,
						effort: settingsRef.current.effort,
						textResponse: settingsRef.current.textResponse
					})
				});
				const payload = await response.json().catch(() => ({}));
				if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Lopu could not start direct audio.');
				const realtime = new LopuVoiceRealtime({
					onActive: (next) => setActive(next),
					onUserTranscript: (text, final) => {
						setInterim(final ? '' : text);
						if (final && text.trim()) setMessages((current) => [...current, { id: messageId('you-realtime'), role: 'user', text: text.trim() }]);
					},
					onAssistantStart: (id) => setMessages((current) => current.some((message) => message.id === id) ? current : [...current, { id, role: 'assistant', text: '' }]),
					onAssistantDelta: (id, text) => setMessages((current) => current.map((message) => message.id === id ? { ...message, text: message.text + text } : message)),
					onError: (error) => setMessages((current) => [...current, { id: messageId('realtime-error'), role: 'assistant', text: error, error: true }])
				});
				realtimeRef.current = realtime;
				await realtime.start(payload.session);
				setSettingsOpen(false);
			} catch (error) {
				await realtimeRef.current?.stop();
				realtimeRef.current = null;
				setMessages((current) => [...current, { id: messageId('realtime-error'), role: 'assistant', text: error instanceof Error ? error.message : 'Lopu could not start direct audio.', error: true }]);
				setActive(false);
			}
			return;
		}
		const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
		if (!Recognition) {
			setMessages((current) => [...current, { id: messageId('error'), role: 'assistant', text: 'This browser does not offer speech recognition. Type a message below, or use the Thingtime iOS app.', error: true }]);
			return;
		}
		const recognition = new Recognition();
		recognition.continuous = true;
		recognition.interimResults = true;
		recognition.lang = navigator.language || 'en-US';
		recognition.onresult = (event: any) => {
			let preview = '';
			for (let index = event.resultIndex; index < event.results.length; index += 1) {
				const text = event.results[index]?.[0]?.transcript || '';
				if (event.results[index].isFinal) enqueueTurn(text);
				else preview += text;
			}
			setInterim(preview);
		};
		recognition.onerror = (event: any) => {
			webResumeRequestedRef.current = false;
			setMessages((current) => [...current, { id: messageId('error'), role: 'assistant', text: `Microphone unavailable${event?.error ? `: ${event.error}` : '.'}`, error: true }]);
			setActive(false);
		};
		recognition.onend = () => {
			webResumeRequestedRef.current = false;
			setActive(false);
		};
		recognitionRef.current = recognition;
		webResumeRequestedRef.current = true;
		recognition.start();
		setActive(true);
		setSettingsOpen(false);
	}, [active, enqueueTurn, nativeReady]);

	React.useEffect(() => {
		startRef.current = start;
	}, [start]);

	React.useEffect(() => () => {
		realtimeRef.current?.stop();
		recognitionRef.current?.abort?.();
	}, []);

	const stop = () => {
		webResumeRequestedRef.current = false;
		getNativeBridge()?.postMessage({ type: 'lopu-voice-stop' });
		recognitionRef.current?.stop?.();
		recognitionRef.current = null;
		realtimeRef.current?.stop();
		realtimeRef.current = null;
		window.speechSynthesis?.cancel();
		setInterim('');
		setActive(false);
	};

	if (!user) return <Flex minH="100vh" width="100%" align="center" justify="center"><Text>Please sign in to talk with Lopu.</Text></Flex>;

	return (
		<Flex width="100%" height="100dvh" boxSizing="border-box" background="var(--tt-surface, #fafafb)" direction="column" overflow="hidden" pt="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))" pb="var(--thingtime-safe-area-bottom, 0px)">
			<Flex align="center" px={[4, 6]} py={3} borderBottom="1px solid var(--tt-border, #ececef)" gap={3} flexShrink={0}>
				<Box flex="1">
					<Text fontWeight={800}>Lopu voice</Text>
					<Text fontSize="xs" color="var(--tt-muted, #777783)">{active ? 'Listening — the session continues in the iOS background' : 'Ready when you are'}</Text>
				</Box>
				{nativeReady ? <Badge colorScheme="purple">iOS audio</Badge> : <Badge>{settings.inputMode === 'provider-audio' ? 'Provider audio' : 'Native transcription'}</Badge>}
				<IconButton aria-label="Voice settings" icon={<SettingsIcon size={18} />} variant={settingsOpen ? 'solid' : 'ghost'} onClick={() => setSettingsOpen((open) => !open)} />
			</Flex>

			{settingsOpen ? (
				<Box mx={[3, 6]} mt={3} p={4} maxHeight="min(58dvh, 560px)" overflowY="auto" flexShrink={1} border="1px solid var(--tt-border, #ececef)" borderRadius="16px" background="var(--tt-surface-elevated, white)" boxShadow="var(--tt-shadow, 0 12px 30px rgba(0,0,0,.08))">
					<Flex justify="space-between" align="center" mb={3}><Text fontWeight={800}>Session settings</Text><IconButton size="sm" aria-label="Close settings" icon={<X size={16} />} variant="ghost" onClick={() => setSettingsOpen(false)} /></Flex>
					<Flex direction="column" gap={3}>
						<Flex justify="space-between" gap={4}><Box><Text fontWeight={700} fontSize="sm">Text response</Text><Text fontSize="xs" color="var(--tt-muted, #777783)">Show Lopu’s reply without speaking it aloud.</Text></Box><Switch isChecked={settings.textResponse} onChange={(event) => setSettings((current) => ({ ...current, textResponse: event.target.checked }))} /></Flex>
						<Flex justify="space-between" gap={4}><Box><Text fontWeight={700} fontSize="sm">Transcribe mode</Text><Text fontSize="xs" color="var(--tt-muted, #777783)">Save each final utterance as a private timestamped Thing page and quote it back.</Text></Box><Switch isChecked={settings.transcribeMode} onChange={(event) => setSettings((current) => ({ ...current, transcribeMode: event.target.checked, inputMode: event.target.checked ? 'native-transcript' : current.inputMode }))} /></Flex>
						<Box>
							<Text fontWeight={700} fontSize="sm" mb={1}>Voice input</Text>
							<Select value={settings.inputMode} isDisabled={settings.transcribeMode} onChange={(event) => setSettings((current) => ({ ...current, inputMode: event.target.value as VoiceSettings['inputMode'] }))}>
								<option value="native-transcript">Device transcription → text model</option>
								<option value="provider-audio" disabled={!directAudioAvailable}>Stream microphone audio to provider{directAudioAvailable ? '' : ' (choose a supported voice model)'}</option>
							</Select>
							<Text mt={1} fontSize="xs" color="var(--tt-muted, #777783)">{settings.inputMode === 'provider-audio' ? '24 kHz PCM audio streams directly to the selected realtime voice model.' : 'Your device transcribes speech first; only text is sent to the selected model.'}</Text>
						</Box>
						<Box><Text fontWeight={700} fontSize="sm" mb={1}>AI provider for this chat</Text><Select value={settings.providerId} isDisabled={settings.transcribeMode} onChange={(event) => selectProvider(event.target.value)}><option value="">Choose a Secure Vault provider</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</Select><Text mt={1} fontSize="xs" color="var(--tt-muted, #777783)"><Link to="/settings">Manage encrypted provider connections in Settings → Secure Vault.</Link></Text></Box>
						<Box>
							<Text fontWeight={700} fontSize="sm" mb={1}>Model for this chat</Text>
							<Select value={settings.model} isDisabled={settings.transcribeMode || !settings.providerId} onChange={(event) => selectModel(event.target.value)} aria-label="Lopu voice model">
								{selectedTemplate?.models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
								<option value="__custom__">Custom model id…</option>
							</Select>
							{settings.model === '__custom__' ? <Input mt={2} value={settings.customModel} onChange={(event) => setSettings((current) => ({ ...current, customModel: event.target.value, inputMode: 'native-transcript' }))} placeholder="Provider model id" aria-label="Custom Lopu model id" /> : null}
						</Box>
						<Flex gap={3} direction={['column', 'row']}>
							<Box flex="1"><Text fontWeight={700} fontSize="sm" mb={1}>Reasoning</Text><Select value={settings.effort} isDisabled={settings.transcribeMode || !effectiveModel} onChange={(event) => setSettings((current) => ({ ...current, effort: event.target.value }))}>{effortOptions.length === 0 ? <option value="">Provider default</option> : effortOptions.map((effort) => <option key={effort} value={effort}>{effort === 'none' ? 'None' : effort}</option>)}</Select></Box>
							<Box flex="1"><Text fontWeight={700} fontSize="sm" mb={1}>Speed</Text><Select value={settings.speed} isDisabled={settings.transcribeMode || !effectiveModel} onChange={(event) => setSettings((current) => ({ ...current, speed: event.target.value as VoiceSettings['speed'] }))}>{speedOptions.map((speed) => <option key={speed} value={speed}>{speed === 'fast' ? 'Fast' : 'Normal'}</option>)}</Select></Box>
						</Flex>
					</Flex>
				</Box>
			) : null}

			<Box ref={scrollRef} flex="1" overflowY="auto" px={[3, 6]} py={4}>
				<Flex direction="column" gap={3} maxWidth="760px" mx="auto">
					{messages.length === 0 ? <Box textAlign="center" py={12}><Text fontSize="4xl">🦄</Text><Text fontWeight={800} mt={2}>Talk naturally with Lopu</Text><Text fontSize="sm" color="var(--tt-muted, #777783)" mt={1}>Use the gear before or during the session to choose spoken replies, transcription, and your provider.</Text></Box> : null}
					{messages.map((message) => <Box key={message.id} alignSelf={message.role === 'user' ? 'flex-end' : 'flex-start'} maxWidth="85%" background={message.role === 'user' ? 'var(--tt-accent, #17171a)' : 'var(--tt-surface-elevated, white)'} color={message.role === 'user' ? 'white' : message.error ? 'red.600' : 'inherit'} border={message.role === 'assistant' ? '1px solid var(--tt-border, #ececef)' : undefined} borderLeft={message.quote ? '4px solid var(--tt-accent, #17171a)' : undefined} borderRadius="16px" px={4} py={3}><Text fontSize="sm">{message.text || '…'}</Text>{message.pageId ? <Text mt={2} fontSize="xs" textDecoration="underline"><Link to={`/thing/${encodeURIComponent(message.pageId)}`}>{message.pageTitle || 'Open private transcript page'}</Link></Text> : null}</Box>)}
					{interim ? <Box alignSelf="flex-end" maxWidth="85%" opacity={0.55} borderRadius="16px" px={4} py={3} background="var(--tt-accent, #17171a)" color="white"><Text fontSize="sm">{interim}</Text></Box> : null}
				</Flex>
			</Box>

			<Flex px={[3, 6]} py={3} borderTop="1px solid var(--tt-border, #ececef)" gap={2} align="center" flexShrink={0} background="var(--tt-surface-elevated, white)">
				<Button minW="112px" colorScheme={active ? 'red' : 'purple'} leftIcon={active ? <Square size={16} /> : <Mic size={18} />} onClick={active ? stop : start}>{active ? 'Stop' : 'Start voice'}</Button>
				<Input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); enqueueTurn(draft); } }} placeholder="Or type to Lopu…" aria-label="Message Lopu" />
				<IconButton aria-label="Send to Lopu" icon={<Send size={18} />} isDisabled={!draft.trim()} onClick={() => enqueueTurn(draft)} />
			</Flex>
		</Flex>
	);
};
