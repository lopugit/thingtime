import React from 'react';
import { Box, Button, Flex, Input, Select, Text } from '@chakra-ui/react';
import { getElectronBridge } from '~/utils/electronBridge';
import { agentNetworkLabels, type AgentNetworkPolicy } from './networkTypes';

export type BrowserClaim = { id: string; token: string };
type Page = { id: string; url: string; title: string };
type Frame = { image: string; viewport: { width: number; height: number } };

export function AgentBrowserViewer({ claim, leaseId, taskId, policy }: { claim?: BrowserClaim; leaseId: string; taskId: string; policy: AgentNetworkPolicy }) {
	const [tabs, setTabs] = React.useState<Page[]>([]), [pageId, setPageId] = React.useState('');
	const [frame, setFrame] = React.useState<Frame | null>(null), [message, setMessage] = React.useState('');
	const [connectionError, setConnectionError] = React.useState('');
	const [url, setUrl] = React.useState(''), [text, setText] = React.useState(''), [busy, setBusy] = React.useState(false);
	const bridge = getElectronBridge();
	const command = React.useCallback(async (operation: string, args: Record<string, unknown> = {}) => {
		if (!bridge?.agentBrowsers) throw new Error('The desktop browser manager is unavailable.');
		return bridge.agentBrowsers({ method: claim ? 'browser' : 'observe', params: { leaseId, taskId, ...(claim ? { token: claim.token } : {}), operation, args } });
	}, [bridge, claim, leaseId, taskId]);
	React.useEffect(() => {
		let active = true, timer: ReturnType<typeof setTimeout>;
		const refresh = async () => {
			try {
				const nextTabs = await command('tabs') as Page[];
				if (!active) return;
				setTabs(nextTabs);
				const selected = nextTabs.find(page => page.id === pageId) || nextTabs[0];
				if (selected) {
					if (selected.id !== pageId) setPageId(selected.id);
					const nextFrame = await command('frame', { pageId: selected.id }) as Frame;
					if (active) { setFrame(nextFrame); setConnectionError(''); }
				} else setFrame(null);
			} catch (error) { if (active) setConnectionError(error instanceof Error ? error.message : 'Viewer disconnected.'); }
			finally { if (active) timer = setTimeout(refresh, 500); }
		};
		void refresh();
		return () => { active = false; clearTimeout(timer); };
	}, [command, pageId]);
	const act = async (operation: string, args: Record<string, unknown>) => {
		setBusy(true); setMessage('');
		try { await command(operation, { pageId, ...args }); return true; }
		catch (error) { setMessage(error instanceof Error ? error.message : 'The browser operation failed. Inspect the current page before retrying.'); return false; }
		finally { setBusy(false); }
	};
	return <Box borderWidth="1px" borderRadius="lg" padding={4} display="grid" gap={3} minWidth={0}>
		<Flex wrap="wrap" justify="space-between" gap={2}><Text fontWeight="semibold">Live browser</Text><Text fontSize="sm">{agentNetworkLabels[policy.mode]} · {claim ? 'Your claim' : 'Viewing agent session'}</Text></Flex>
		<Select aria-label="Browser tab" value={pageId} onChange={event => { setPageId(event.target.value); setFrame(null); }}>
			{tabs.map(page => <option key={page.id} value={page.id}>{page.title || page.url || 'New tab'}</option>)}
		</Select>
		{claim && <Flex gap={2} wrap="wrap"><Input aria-label="Test page URL" flex="1 1 220px" value={url} onChange={event => setUrl(event.target.value)} placeholder="http://127.0.0.1:…" /><Button isDisabled={busy || !pageId} onClick={() => act('navigate', { url })}>Go</Button></Flex>}
		{frame && <Box as="img" src={`data:image/jpeg;base64,${frame.image}`} alt="Live view of the task browser" width="100%" tabIndex={claim ? 0 : undefined}
			borderWidth="1px" borderRadius="md" cursor={claim ? 'crosshair' : 'default'}
			onClick={event => {
				if (!claim || busy) return;
				const bounds = event.currentTarget.getBoundingClientRect();
				void act('click', { x: (event.clientX - bounds.left) * frame.viewport.width / bounds.width, y: (event.clientY - bounds.top) * frame.viewport.height / bounds.height });
			}}
			onKeyDown={event => {
				if (!claim || busy || event.metaKey || event.ctrlKey || event.altKey) return;
				if (event.key === 'Tab') return;
				event.preventDefault(); void act('key', { key: event.key });
			}} />}
		{claim && <Flex gap={2} wrap="wrap"><Input aria-label="Text to type into browser" type="text" value={text} onChange={event => setText(event.target.value)} placeholder="Type into the selected field" />
			<Button isDisabled={busy || !pageId || !text} onClick={async () => { if (await act('type', { text })) setText(''); }}>Type text</Button>
			<Button isDisabled={busy || !pageId} onClick={() => act('scroll', { y: -500 })}>Scroll up</Button><Button isDisabled={busy || !pageId} onClick={() => act('scroll', { y: 500 })}>Scroll down</Button>
			<Button isDisabled={busy || !pageId} onClick={() => act('viewport', { width: 375, height: 812 })}>Mobile</Button><Button isDisabled={busy || !pageId} onClick={() => act('viewport', { width: 1280, height: 800 })}>Desktop</Button>
		</Flex>}
		{message && <Text role="status" fontSize="sm">{message}</Text>}
		{connectionError && <Text role="status" fontSize="sm">{connectionError}</Text>}
	</Box>;
}
