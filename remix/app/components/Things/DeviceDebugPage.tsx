import React from 'react';
import { Box, Text, Button } from '@chakra-ui/react';
import { useApi } from '~/hooks/useApi';
import { getElectronBridge, selectedDesktopApiOrigin } from '~/utils/electronBridge';
import { createFolderHostFetch } from '~/fileSync/folderHostFetch.client';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { deviceDebugBlocks } from './deviceDebugBlocks';
import { createDeviceDebugClient, debugEventDisplay, DebugReadError, mergeDebugEvents, type DebugFilters, type DebugPage } from './deviceDebug.client';

export function DeviceDebugPage() {
	const user = useCurrentUser();
	const dataPlane = useDataPlane();
	const rendererOrigin = window.location.origin, bridge = getElectronBridge();
	const [selection, setSelection] = React.useState<{ origin: string | null; error: boolean }>({ origin: bridge ? null : rendererOrigin, error: false });
	const [retry, setRetry] = React.useState(0);
	React.useEffect(() => {
		let current = true;
		if (!bridge) { setSelection({ origin: rendererOrigin, error: false }); return; }
		setSelection({ origin: null, error: false });
		if (!bridge.getInfo) { setSelection({ origin: null, error: true }); return; }
		void bridge.getInfo?.().then(info => {
			if (current && getElectronBridge() === bridge) { const origin = selectedDesktopApiOrigin(rendererOrigin, info); setSelection({ origin, error: !origin }); }
		}).catch(() => { if (current) setSelection({ origin: null, error: true }); });
		return () => { current = false; };
	}, [bridge, rendererOrigin, user?.id, retry]);
	if (!selection.origin) return <Box pt="100px" px={4}><Text role={selection.error ? 'alert' : 'status'}>{selection.error ? 'The selected API server could not be verified.' : 'Verifying your selected server…'}</Text>{selection.error && <Button onClick={() => setRetry(n => n + 1)}>Try again</Button>}</Box>;
	return <DeviceDebugSession key={JSON.stringify([user?.id, selection.origin, dataPlane])} ownerId={user?.id} origin={selection.origin} rendererOrigin={rendererOrigin} dataPlane={dataPlane} />;
}

function DeviceDebugSession({ ownerId, origin, rendererOrigin, dataPlane }: { ownerId?: string; origin: string; rendererOrigin: string; dataPlane: string | null }) {
	const [filters, setFilters] = React.useState<DebugFilters>({ deviceId: '', level: '', category: '' });
	const [result, setResult] = React.useState<DebugPage | null>(null);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState('');
	const [offline, setOffline] = React.useState(!navigator.onLine);
	const [refresh, setRefresh] = React.useState(0);
	const clearRequest = React.useRef<{ requestId: string; throughSequence: number } | null>(null);
	const api = useApi();
	const [clearArmed, setClearArmed] = React.useState(false);
	const [writing, setWriting] = React.useState(false);
	const [settingsUncertain, setSettingsUncertain] = React.useState(false);
	const lifetime = React.useRef({ alive: true, generation: 0, controller: null as AbortController | null });
	const bridge = getElectronBridge();
	const check = () => { if (!lifetime.current.alive || window.location.origin !== rendererOrigin || getElectronBridge() !== bridge) throw new DebugReadError(true, 'Your account or server changed.'); };
	const verifyOrigin = async () => { check(); if (bridge) { const info = await bridge.getInfo?.(); check(); if (!info || selectedDesktopApiOrigin(rendererOrigin, info) !== origin) throw new DebugReadError(true, 'Your selected server changed.'); } };
	const client = createDeviceDebugClient({ ownerId: ownerId || '', origin, dataPlane, isCurrent: () => lifetime.current.alive && window.location.origin === rendererOrigin && getElectronBridge() === bridge }, {
		request: async (query, body, signal) => {
			await verifyOrigin();
			try { return await api.deviceDiagnosticsRequest(Object.fromEntries(new URLSearchParams(query)), body || null, { expectedActor: ownerId, expectedApiOrigin: origin, expectedDataPlane: 'home', signal }); }
			finally { await verifyOrigin(); }
		}
	});
	const checkRef = React.useRef(check); checkRef.current = check;
	const accountTransport = React.useMemo(() => ({ origin, currentOrigin: () => origin, fetch: createFolderHostFetch({ origin, localOrigin: rendererOrigin, ownerId: ownerId || '', signal: new AbortController().signal, check: () => checkRef.current(), fetch: (target, init) => fetch(target, init) }) }), [origin, rendererOrigin, ownerId]);
	React.useLayoutEffect(() => { const state = lifetime.current; state.alive = true; return () => { state.alive = false; state.generation++; state.controller?.abort(); }; }, []);
	React.useEffect(() => {
		const change = () => setOffline(!navigator.onLine);
		window.addEventListener('online', change); window.addEventListener('offline', change);
		return () => { window.removeEventListener('online', change); window.removeEventListener('offline', change); };
	}, []);
	const begin = () => {
		lifetime.current.controller?.abort();
		const controller = new AbortController(); lifetime.current.controller = controller;
		return { run: ++lifetime.current.generation, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) };
	};
	const load = async (cursor?: string) => {
		if (!ownerId || writing) return;
		const { run, signal } = begin();
		setBusy(true); setError('');
		try {
			let page = await client.read(filters, signal, cursor);
			if (!page.folder) { await client.ensure(signal); page = await client.read(filters, signal, cursor); }
			if (!lifetime.current.alive || signal.aborted || run !== lifetime.current.generation) return;
			setSettingsUncertain(false);
			setResult(previous => ({ ...page, events: cursor && previous ? mergeDebugEvents(previous.events, page.events) : page.events }));
		} catch (cause) {
			if (!lifetime.current.alive || run !== lifetime.current.generation || lifetime.current.controller?.signal.aborted) return;
			if (cause instanceof DebugReadError && cause.clear) setResult(null);
			setError(cause instanceof DebugReadError ? cause.message : 'Could not refresh device activity. Saved events are kept; try again when connected.');
		} finally { if (lifetime.current.alive && run === lifetime.current.generation) setBusy(false); }
	};
	const loadRef = React.useRef(load); loadRef.current = load;
	React.useEffect(() => {
		const state = lifetime.current;
		const timer = setTimeout(() => void loadRef.current(), 200);
		return () => { clearTimeout(timer); state.generation++; state.controller?.abort(); };
	}, [filters.deviceId, filters.level, filters.category, refresh]);
	const saveCapture = async () => {
		if (!result || busy || writing || !ownerId) return;
		const expected = !result.settings.enabled;
		const { run, signal } = begin(); setWriting(true); setBusy(true); setError('');
		try {
			await client.setEnabled(expected, signal);
			const page = await client.read(filters, signal);
			if (page.settings.enabled !== expected) throw new DebugReadError(false, 'The capture setting could not be confirmed. Refresh before trying again.');
			if (lifetime.current.alive && run === lifetime.current.generation) setResult(page);
		} catch (cause) { if (lifetime.current.alive && run === lifetime.current.generation) { if (cause instanceof DebugReadError && cause.clear) setResult(null); setSettingsUncertain(true); setError('The capture setting was not confirmed. Refresh to check its saved state before trying again.'); } }
		finally { if (lifetime.current.alive && run === lifetime.current.generation) { setWriting(false); setBusy(false); } }
	};
	const clear = async () => {
		if (!clearArmed) { setClearArmed(true); return; }
		if (busy || writing || !ownerId || !result) return;
		const { run, signal } = begin(); setWriting(true); setBusy(true); setError(''); setClearArmed(false);
		try {
			const identity = clearRequest.current ||= { requestId: crypto.randomUUID(), throughSequence: result.throughSequence };
			let more = true;
			while (more) { const batch = await client.clear(identity.requestId, identity.throughSequence, signal); more = batch.hasMore; if (more && batch.deleted === 0) throw new Error('No progress'); }
			const page = await client.read(filters, signal);
			if (lifetime.current.alive && run === lifetime.current.generation) { clearRequest.current = null; setResult(page); }
		} catch { if (lifetime.current.alive && run === lifetime.current.generation) { setResult(null); setError('Clearing was interrupted. Refresh to see which events remain before trying again.'); } }
		finally { if (lifetime.current.alive && run === lifetime.current.generation) { setWriting(false); setBusy(false); } }
	};
	const exportShown = () => {
		if (!result?.events.length) return;
		const blob = new Blob([JSON.stringify({ events: result.events }, null, 2)], { type: 'application/json' });
		const href = URL.createObjectURL(blob), a = document.createElement('a');
		a.href = href; a.download = 'thingtime-device-events.json'; a.click(); setTimeout(() => URL.revokeObjectURL(href), 0);
	};
	const signedIn = Boolean(ownerId);
	const status = !signedIn ? 'Sign in to see your private device activity.' : dataPlane !== 'home' ? 'Switch to your home database to read private device activity.' : offline ? 'Offline · saved events stay visible. Refresh when connected.' : result ? `${result.events.length} saved event${result.events.length === 1 ? '' : 's'} shown${busy ? ' · Updating' : ''}` : busy ? 'Reading private device activity' : 'Your private device activity';
	return <Box width="100%" minWidth={0} minHeight="100vh" bg="var(--tt-surface, #fafafb)" pt="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 20px)" pb={20}>
		<Box maxWidth="960px" mx="auto" px={[4, 6]} minWidth={0}>
			<SettingsDocumentHost documentKey="private-device-debug" scopeKey="private-device-debug" defaultDocument={deviceDebugBlocks} title="Device debug layout" layoutEditingDisabled={writing} accountTransport={accountTransport}>
				{({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={JSON.stringify([ownerId, origin, dataPlane])} enabled={!editing} scope={{ debug: {
					...filters, rows: result?.events.map(event => debugEventDisplay(event, ownerId!)) || [], busy,
					status, loadingIcon: busy ? '◌' : '', error, hasError: Boolean(error), hasMore: Boolean(result?.nextCursor),
					empty: !signedIn || busy || error || !result ? '' : 'No events match these filters. Your devices will report safe progress and error events during testing.',
					exportDisabled: !result?.events.length || writing, retryDisabled: busy || !signedIn, olderDisabled: busy || !result?.nextCursor,
					settingsDisabled: busy || settingsUncertain || !result || !signedIn, captureLabel: result?.settings.enabled ? 'Pause diagnostics capture' : 'Enable diagnostics capture',
					captureDescription: !result ? 'Capture settings are available after this private folder is loaded.' : result.settings.enabled ? 'Diagnostics capture is on. Devices report safe progress and errors to your private folder.' : 'Diagnostics capture is off. Previously saved events remain readable.',
					clearArmed, clearLabel: clearArmed ? (clearRequest.current ? 'Confirm continue clearing snapshot' : 'Confirm clear all saved events') : (clearRequest.current ? 'Continue clearing original snapshot' : 'Clear saved events')
				} }} actions={{ refresh: () => setRefresh(n => n + 1), older: () => result?.nextCursor ? load(result.nextCursor) : undefined,
					level: ({ value }) => { if (!writing) setFilters(f => ({ ...f, level: String(value) })); },
					category: ({ value }) => { if (!writing) setFilters(f => ({ ...f, category: String(value) })); },
					device: ({ value }) => { if (!writing) setFilters(f => ({ ...f, deviceId: String(value).trim() })); },
					export: exportShown, capture: saveCapture, clear, 'cancel-clear': () => setClearArmed(false)
				}}><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} /></TransientBlockHost>}
			</SettingsDocumentHost>
		</Box>
	</Box>;
}

export default DeviceDebugPage;
