import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ChakraProvider } from '@chakra-ui/react';
import { CurrentPageBuilderFixture } from './lib/CurrentPageBuilderFixture';
import { DeviceDetailsDrawer } from '../app/components/Devices/DeviceDetailsDrawer';
import { MobileDeviceSetupEntry, useMobileDeviceSetupStatus } from '../app/components/Devices/MobileDeviceSetupEntry';
import { nativeBridgeMessageEvent } from '../app/utils/nativeBridge';
import { ThingtimeContext, type EverythingTypes } from '../app/Providers/ThingtimeProvider';
import { ThingContextMenu } from '../app/components/Thingtime/ContextMenu/ThingContextMenu';
import type { DeviceRuntimeState } from '../app/components/Devices/deviceTypes';

const mode = new URLSearchParams(location.search).get('setup') || 'paired';
window.thingtimeNativeBridge = { version: '1.0.0', platform: 'ios', isNativeWebView: true, devicePairingVersion: '1.0.0', postMessage(message) {
 const request = message.payload as Record<string, unknown>;
 if (message.type !== 'mobile-device' || !request || request.action !== 'status' || mode === 'unknown') return;
 queueMicrotask(() => window.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, { detail: { type: 'mobile-device-result', payload: { ...request, state: mode, ...(mode === 'paired' ? { deviceId: 'fixture-device' } : {}) } } })));
} };
const now = Date.now();
const state = { deviceId: 'fixture-device', summary: { id: 'fixture-device', name: 'Fixture Mac', platform: 'macos', serviceStatus: 'running', pairingStatus: 'paired', transportStatus: 'online', permissionMode: 'always-allow', revision: 1, lastSeenAt: new Date(now).toISOString(), capabilities: [], system: { model: 'MacBook Pro', batteryPercent: 80 } }, snapshot: null, commands: [], approvals: [], screenSessions: [], agentSessions: [], lastEventSequence: 0 } as DeviceRuntimeState;
function Fixture() {
 const status = useMobileDeviceSetupStatus();
 const [menu, setMenu] = React.useState(false);
 return <main style={{ maxWidth: 760, margin: '24px auto', padding: 16 }}>
  <h1>Device details regression fixture</h1>
  <section aria-label="This device setup" data-setup-state={status?.state || 'unknown'}>
   {status && status.state !== 'paired' ? <><h2>This device</h2><MobileDeviceSetupEntry /></> : null}
  </section>
  <ThingtimeContext.Provider value={{ Everything: { thingtime: {} } } as EverythingTypes}><ThingContextMenu open={menu} presentation="modal" onClose={() => setMenu(false)} meta={{ path: 'Fixture Mac', type: 'Device' }} model={{ sections: [{ id: 'device-navigation', actions: [{ id: 'show-device-folder', label: 'Show Folder', icon: '🗂️', lucide: 'folder', href: '/things?folder=fixture' }] }] }} /></ThingtimeContext.Provider>
  <DeviceDetailsDrawer onContextMenu={(deviceId, event) => { event.preventDefault(); event.stopPropagation(); if (deviceId !== state.deviceId) throw new Error('Wrong menu device'); setMenu(true); }} isOpen onClose={() => {}} presentation="page" state={state} ownerId="fixture-owner" now={now} />
  <footer>End of fixture</footer>
 </main>;
}
const router = createBrowserRouter([{ id: 'root', path: '*', element: <CurrentPageBuilderFixture><Fixture /></CurrentPageBuilderFixture> }], { hydrationData: { loaderData: { root: { user: { id: 'fixture-owner', accountKind: 'user', username: 'synthetic' }, dataPlane: 'home' } } } });
createRoot(document.getElementById('root')!).render(<ChakraProvider><RouterProvider router={router} /></ChakraProvider>);
