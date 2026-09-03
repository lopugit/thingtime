import React from 'react';
import { Badge, Box, Button, Flex, IconButton, Input, Select, Switch, Text } from '@chakra-ui/react';
import { Mic, Send, Settings as SettingsIcon, Square, X } from 'lucide-react';
import { Link } from 'react-router';

import { useCurrentUser } from '~/hooks/useCurrentUser';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { getNativeBridge, nativeBridgeMessageEvent } from '~/utils/nativeBridge';

type VoiceSettings = { textResponse: boolean; transcribeMode: boolean; providerId: string };
type ProviderEntry = { id: string; name: string; provider?: string; model?: string };
type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; quote?: boolean; pageId?: string; pageTitle?: string; error?: boolean };
declare global {
	interface Window {
		webkitSpeechRecognition?: new () => any;
		SpeechRecognition?: new () => any;
	}
}

const defaultSettings: VoiceSettings = { textResponse: false, transcribeMode: false, providerId: '' };

const messageId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const LopuVoiceChat = () => {
	const user = useCurrentUser();
	const settingsKey = user ? `tt-lopu-voice-settings-${user.id}` : 'tt-lopu-voice-settings';
	const [settings, setSettings] = React.useState<VoiceSettings>(() => readLocalCache<VoiceSettings>(settingsKey) || defaultSettings);
	const [providers, setProviders] = React.useState<ProviderEntry[]>([]);
	const [messages, setMessages] = React.useState<ChatMessage[]>([]);
	const [draft, setDraft] = React.useState('');
	const [active, setActive] = React.useState(false);
	const [settingsOpen, setSettingsOpen] = React.useState(true);
	const [interim, setInterim] = React.useState('');
	const [nativeReady, setNativeReady] = React.useState(() => !!getNativeBridge()?.isNativeWebView);
	const sessionIdRef = React.useRef(`voice-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const settingsKeyRef = React.useRef(settingsKey);
	const recognitionRef = React.useRef<any>(null);
	const startRef = React.useRef<() => void>(() => {});
	const webResumeRequestedRef = React.useRef(false);
	const turnQueueRef = React.useRef<Promise<void>>(Promise.resolve());
	const settingsRef = React.useRef(settings);
	const historyRef = React.useRef<ChatMessage[]>([]);
	const scrollRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		if (settingsKeyRef.current !== settingsKey) {
			settingsKeyRef.current = settingsKey;
			const next = readLocalCache<VoiceSettings>(settingsKey) || defaultSettings;
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
				setSettings((current) => current.providerId || !next[0] ? current : { ...current, providerId: next[0].id });
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

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

	const start = React.useCallback(() => {
		if (active) return;
		const bridge = getNativeBridge();
		if (nativeReady && bridge) {
			bridge.postMessage({ type: 'lopu-voice-start', payload: { ...settingsRef.current, sessionId: sessionIdRef.current } });
			setActive(true);
			setSettingsOpen(false);
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

	const stop = () => {
		webResumeRequestedRef.current = false;
		getNativeBridge()?.postMessage({ type: 'lopu-voice-stop' });
		recognitionRef.current?.stop?.();
		recognitionRef.current = null;
		window.speechSynthesis?.cancel();
		setInterim('');
		setActive(false);
	};

	if (!user) return <Flex minH="100vh" width="100%" align="center" justify="center"><Text>Please sign in to talk with Lopu.</Text></Flex>;

	return (
		<Flex width="100%" height="100dvh" background="var(--tt-surface, #fafafb)" direction="column" overflow="hidden" pt="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px))" pb="var(--thingtime-safe-area-bottom, 0px)">
			<Flex align="center" px={[4, 6]} py={3} borderBottom="1px solid var(--tt-border, #ececef)" gap={3}>
				<Box flex="1">
					<Text fontWeight={800}>Lopu voice</Text>
					<Text fontSize="xs" color="var(--tt-muted, #777783)">{active ? 'Listening — the session continues in the iOS background' : 'Ready when you are'}</Text>
				</Box>
				{nativeReady ? <Badge colorScheme="purple">iOS native audio</Badge> : <Badge>Web audio</Badge>}
				<IconButton aria-label="Voice settings" icon={<SettingsIcon size={18} />} variant={settingsOpen ? 'solid' : 'ghost'} onClick={() => setSettingsOpen((open) => !open)} />
			</Flex>

			{settingsOpen ? (
				<Box mx={[3, 6]} mt={3} p={4} border="1px solid var(--tt-border, #ececef)" borderRadius="16px" background="var(--tt-surface-elevated, white)" boxShadow="var(--tt-shadow, 0 12px 30px rgba(0,0,0,.08))">
					<Flex justify="space-between" align="center" mb={3}><Text fontWeight={800}>Session settings</Text><IconButton size="sm" aria-label="Close settings" icon={<X size={16} />} variant="ghost" onClick={() => setSettingsOpen(false)} /></Flex>
					<Flex direction="column" gap={3}>
						<Flex justify="space-between" gap={4}><Box><Text fontWeight={700} fontSize="sm">Text response</Text><Text fontSize="xs" color="var(--tt-muted, #777783)">Show Lopu’s reply without speaking it aloud.</Text></Box><Switch isChecked={settings.textResponse} onChange={(event) => setSettings((current) => ({ ...current, textResponse: event.target.checked }))} /></Flex>
						<Flex justify="space-between" gap={4}><Box><Text fontWeight={700} fontSize="sm">Transcribe mode</Text><Text fontSize="xs" color="var(--tt-muted, #777783)">Save each final utterance as a private timestamped Thing page and quote it back.</Text></Box><Switch isChecked={settings.transcribeMode} onChange={(event) => setSettings((current) => ({ ...current, transcribeMode: event.target.checked }))} /></Flex>
						<Box><Text fontWeight={700} fontSize="sm" mb={1}>AI provider for this chat</Text><Select value={settings.providerId} isDisabled={settings.transcribeMode} onChange={(event) => setSettings((current) => ({ ...current, providerId: event.target.value }))}><option value="">Choose a Secure Vault provider</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.model}</option>)}</Select><Text mt={1} fontSize="xs" color="var(--tt-muted, #777783)"><Link to="/settings">Manage encrypted provider connections in Settings → Secure Vault.</Link></Text></Box>
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

			<Flex px={[3, 6]} py={3} borderTop="1px solid var(--tt-border, #ececef)" gap={2} align="center" background="var(--tt-surface-elevated, white)">
				<Button minW="112px" colorScheme={active ? 'red' : 'purple'} leftIcon={active ? <Square size={16} /> : <Mic size={18} />} onClick={active ? stop : start}>{active ? 'Stop' : 'Start voice'}</Button>
				<Input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); enqueueTurn(draft); } }} placeholder="Or type to Lopu…" aria-label="Message Lopu" />
				<IconButton aria-label="Send to Lopu" icon={<Send size={18} />} isDisabled={!draft.trim()} onClick={() => enqueueTurn(draft)} />
			</Flex>
		</Flex>
	);
};
