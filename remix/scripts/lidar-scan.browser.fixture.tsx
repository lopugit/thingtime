import { CurrentPageBuilderFixture } from './lib/CurrentPageBuilderFixture';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createBrowserRouter, RouterProvider, useRouteLoaderData } from 'react-router';
import { LidarScanProvider } from '../app/components/NativeBridge/LidarScanProvider';
import { LidarScanLibraryPage } from '../app/components/NativeBridge/LidarScanLibraryPage';
import { ThingtimeProvider } from '../app/Providers/ThingtimeProvider';
import { lidarAppLink } from '../app/components/NativeBridge/lidarScanBridge';
import { PageActionSurface } from '../app/components/Builder/PageActionSurface';
import { WebpageBlocksRenderer } from '../app/components/Builder/WebpageBlocksRenderer';
import type { WebpageBlock } from '../app/components/Builder/webpageBlocks';
import { nativeBridgeMessageEvent, type ThingtimeBridgeMessage } from '../app/utils/nativeBridge';
import { rootIdentity } from '../app/utils/rootIdentity';

const mode = new URLSearchParams(location.search).get('mode');
const ownerId = 'fixture-lidar-owner';
type Request = { action: string; requestId: string; ownerId: string; origin: string; scanId?: string };
const requests: Request[] = [];
let savedNotifications = 0;
const scans = ['510fbf8b-5c32-4ddc-8089-c70b392d3aae', '610fbf8b-5c32-4ddc-8089-c70b392d3aae', '710fbf8b-5c32-4ddc-8089-c70b392d3aae'].map((scanId, index) => ({ scanId, createdAt: `2026-11-${12-index}T01:00:00Z`, byteCount: index === 0 ? 11_360_000_000 : 1024, frameCount: 40, available: index !== 2, isPartial: index === 0, deviceSaved: index === 1 }));
let status: Record<string, unknown> = { state: 'idle', supported: mode !== 'unsupported', scans };
const reply = (request: Request, result: Record<string, unknown>) => window.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, {
	detail: { type: 'lidar-scan-result', payload: { ...request, supported: true, ...result } }
}));
if (mode !== 'browser') {
	window.thingtimeNativeBridge = {
		version: '1.0.0', platform: 'ios', isNativeWebView: true, lidarVersion: mode === 'outdated' ? '1.0.0' : '1.1.0',
		postMessage(message: ThingtimeBridgeMessage) {
			if (message.type !== 'lidar-scan') return;
			const request = message.payload as Request;
			requests.push(request);
			if (request.action === 'status') queueMicrotask(() => reply(request, status));
		}
	};
}
Object.assign(window, { lidarFixture: {
	requests, reply, savedNotifications: () => savedNotifications,
	setStatus: (next: Record<string, unknown>) => { status = next; },
	announceNativeChange: (scope: Record<string, unknown> = {}) => window.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, {
		detail: { type: 'lidar-scan-changed', payload: { ownerId, origin: location.origin, ...scope } }
	})),
	changeIdentity: () => rootIdentity.changed(),
	appLink: () => lidarAppLink(location.origin, navigator.userAgent, navigator.platform, navigator.maxTouchPoints)
} });
const authored: WebpageBlock[] = [
	{ id: 'fixture-authored-scan', type: 'element', tag: 'button', text: 'Builder scan action', props: {
		type: 'button', 'data-tt-action': '$ui', 'data-tt-action-inputs': { op: 'native', capability: 'lidar.scan' }
	} },
	{ id: 'fixture-authored-refusal', type: 'element', tag: 'button', text: 'Builder scan with unknown arguments', props: {
		type: 'button', 'data-tt-action': '$ui', 'data-tt-action-inputs': { op: 'native', capability: 'lidar.scan', ownerId: 'other' }
	} }
];
function Fixture() {
	const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
	const data = useRouteLoaderData('root') as { user: { id: string }; dataPlane: string };
	return <LidarScanProvider ownerId={identity.pending ? undefined : data.user.id} generation={identity.generation}>
		<h1>Things</h1>
		<PageActionSurface actionEnabled><WebpageBlocksRenderer blocks={authored} componentsByRef={{}} interactive /></PageActionSurface>
		<LidarScanLibraryPage />
		<div style={{ minHeight: '80vh' }} />
		<footer>End of Things</footer>
	</LidarScanProvider>;
}
const router = createBrowserRouter([{ id: 'root', path: '*', element: <ThingtimeProvider storageKey="lidar-library-isolated-acceptance" accountId={ownerId} exposeGlobals={false}><CurrentPageBuilderFixture><Fixture /></CurrentPageBuilderFixture></ThingtimeProvider> }], {
	hydrationData: { loaderData: { root: { user: { id: ownerId, accountKind: 'user' }, dataPlane: 'home' } } }
});
createRoot(document.getElementById('root')!).render(<ChakraProvider><RouterProvider router={router} /></ChakraProvider>);
