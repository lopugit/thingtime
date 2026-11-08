import React from 'react';
import { getNativeBridge, nativeBridgeMessageEvent, nativeBridgeReadyEvent } from '../../utils/nativeBridge';
import { rootIdentity } from '../../utils/rootIdentity';
import { createLidarScanClient, lidarAppLink, supportsLidarScan, type LidarScanSnapshot } from './lidarScanBridge';

type Activation = (viewerId?: string) => string | null;
type Controls = {
	ownerId: string;
	generation: number;
	mode: 'native' | 'browser' | 'outdated';
	snapshot: LidarScanSnapshot;
	handoff: boolean;
	start: Activation;
	check: () => boolean;
	retry: () => boolean;
};
const LidarActivationContext = React.createContext<Activation | null>(null);
const LidarControlsContext = React.createContext<Controls | null>(null);
export const useLidarScanActivation = () => React.useContext(LidarActivationContext);
export const useLidarScanControls = () => React.useContext(LidarControlsContext);

export function LidarScanProvider({ ownerId, generation, children }: {
	ownerId?: string;
	generation: number;
	children: React.ReactNode;
}) {
	const [host, setHost] = React.useState<{
		bridge: ReturnType<typeof getNativeBridge>;
		origin: string;
		appLink: string | null;
	}>();
	const [session, setSession] = React.useState<{
		ownerId: string; generation: number; host: typeof host; snapshot: LidarScanSnapshot;
	}>();
	const [handoffGeneration, setHandoffGeneration] = React.useState<number>();
	const scopeRef = React.useRef({ ownerId, generation });
	scopeRef.current = { ownerId, generation };
	const client = React.useRef<ReturnType<typeof createLidarScanClient> | null>(null);
	const check = React.useCallback(() => client.current?.request('status') ?? false, []);
	React.useEffect(() => {
		const discover = () => {
			const bridge = getNativeBridge();
			const origin = window.location.origin;
			const appLink = bridge?.isNativeWebView ? null :
				lidarAppLink(origin, navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
			setHost(previous => previous?.bridge === bridge && previous?.origin === origin ? previous : { bridge, origin, appLink });
		};
		discover();
		window.addEventListener(nativeBridgeReadyEvent, discover);
		return () => window.removeEventListener(nativeBridgeReadyEvent, discover);
	}, []);

	React.useEffect(() => {
		if (!ownerId || !host || !supportsLidarScan(host.bridge)) return;
		const { bridge, origin } = host;
		const scope = { ownerId, origin };
		const sameAccount = () => {
			const current = rootIdentity.read();
			return scopeRef.current.ownerId === ownerId && scopeRef.current.generation === generation &&
				!current.pending && current.generation === generation;
		};
		const isCurrent = () => sameAccount() && window.location.origin === origin && getNativeBridge() === bridge;
		const next = createLidarScanClient({
			scope,
			send: message => bridge.postMessage(message),
			isCurrent,
			update: snapshot => setSession({ ownerId, generation, host, snapshot }),
			newId: () => crypto.randomUUID()
		});
		client.current = next;
		const receive = (event: Event) => {
			const detail = (event as CustomEvent).detail;
			if (detail?.type === 'lidar-scan-changed' && detail.payload?.ownerId === ownerId && detail.payload?.origin === origin) {
				if (document.visibilityState === 'visible') next.refresh();
			} else {
				next.receive(detail);
			}
		};
		const refresh = () => { if (document.visibilityState === 'visible') next.refresh(); };
		const unsubscribe = rootIdentity.subscribe(() => {
			if (!sameAccount()) next.close(true);
		});
		window.addEventListener(nativeBridgeMessageEvent, receive);
		document.addEventListener('visibilitychange', refresh);
		next.request('status');
		return () => {
			unsubscribe();
			window.removeEventListener(nativeBridgeMessageEvent, receive);
			document.removeEventListener('visibilitychange', refresh);
			next.close(!sameAccount() && window.location.origin === origin);
			if (client.current === next) client.current = null;
		};
	}, [ownerId, generation, host]);

	const snapshot = session && session.ownerId === ownerId && session.generation === generation && session.host === host
		? session.snapshot : {};
	const current = React.useRef({ host, snapshot });
	current.current = { host, snapshot };
	const start = React.useCallback<Activation>(viewerId => {
		const { host, snapshot } = current.current;
		const scope = scopeRef.current;
		const identity = rootIdentity.read();
		if (!viewerId || viewerId !== scope.ownerId || identity.pending || identity.generation !== scope.generation)
			return 'Sign in to your permanent account on Home to scan and save privately.';
		if (!host || host.origin !== window.location.origin) return 'The scanner is unavailable on this page.';
		if (navigator.userActivation?.isActive === false) return 'Select the scanner button to open Thingtime.';
		if (supportsLidarScan(host.bridge)) {
			if (client.current?.request('start')) return null;
			if (snapshot.result?.state === 'pending') return 'Your earlier scan is saved on this device. Open Things to retry its upload.';
			if (snapshot.result?.supported === false) return 'LiDAR scanning requires a supported iPhone or iPad.';
			return 'Open Things to check the scanner’s current status.';
		}
		if (host.bridge?.platform === 'ios') return 'Update the Thingtime iOS app to use LiDAR scanning.';
		if (!host.appLink) return 'Open Thingtime on an iPhone or iPad with LiDAR to scan.';
		setHandoffGeneration(scope.generation);
		window.location.assign(host.appLink);
		return null;
	}, []);
	const mode = supportsLidarScan(host?.bridge) ? 'native' : host?.appLink ? 'browser' : host?.bridge?.platform === 'ios' ? 'outdated' : null;
	const controls: Controls | null = ownerId && mode ? {
		ownerId, generation, mode, snapshot, handoff: handoffGeneration === generation,
		start, check, retry: () => client.current?.request('retry') ?? false
	} : null;

	return <LidarActivationContext.Provider value={start}>
		<LidarControlsContext.Provider value={controls}>{children}</LidarControlsContext.Provider>
	</LidarActivationContext.Provider>;
}
