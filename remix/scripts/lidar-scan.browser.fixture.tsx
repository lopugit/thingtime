import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createBrowserRouter, RouterProvider, useRouteLoaderData } from 'react-router';
import { LidarScanProvider } from '../app/components/NativeBridge/LidarScanProvider';
import { LidarScanControls } from '../app/components/NativeBridge/LidarScanControls';
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
let status: Record<string, unknown> = { state: 'idle', supported: mode !== 'unsupported' };
const reply = (request: Request, result: Record<string, unknown>) => window.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, {
	detail: { type: 'lidar-scan-result', payload: { ...request, supported: true, ...result } }
}));
if (mode !== 'browser') {
	window.thingtimeNativeBridge = {
		version: '1.0.0', platform: 'ios', isNativeWebView: true, lidarVersion: mode === 'outdated' ? '0.9.0' : '1.0.0',
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
		<LidarScanControls onSaved={() => { savedNotifications++; }} />
		<div style={{ minHeight: '80vh' }} />
		<footer>End of Things</footer>
	</LidarScanProvider>;
}
const router = createBrowserRouter([{ id: 'root', path: '*', element: <Fixture /> }], {
	hydrationData: { loaderData: { root: { user: { id: ownerId, accountKind: 'user' }, dataPlane: 'home' } } }
});
createRoot(document.getElementById('root')!).render(<ChakraProvider><RouterProvider router={router} /></ChakraProvider>);
