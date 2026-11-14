// Isolated rendering fixture only. API persistence and ACL acceptance are
// independently exercised against the built server by the diagnostics runner.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ChakraProvider } from '@chakra-ui/react';
import { DeviceDebugPage } from '../app/components/Things/DeviceDebugPage';
import { rootIdentity } from '../app/utils/rootIdentity';
import { CurrentPageBuilderFixture } from './lib/CurrentPageBuilderFixture';

const owner = 'debug-render-owner';
const selectedOrigin = new URLSearchParams(location.search).has('remote') ? 'https://selected-api.example' : location.origin;
if (selectedOrigin !== location.origin) window.thingtimeDesktop = { getInfo: async () => ({ contentOrigin: location.origin, apiOrigin: selectedOrigin }) };
const json = (value: unknown) => Response.json(value, { headers: selectedOrigin === location.origin || badFallback ? {} : { 'x-thingtime-api-fallback': selectedOrigin } });
let enabled = true, fail = false, empty = false, badFallback = false, held: (() => void) | undefined;
const events = Array.from({ length: 12 }, (_, n) => ({ id: `debug-event-${n}`, eventId: `ee0ee89e-7e4a-4dca-ab24-${String(n).padStart(12, '0')}`, deviceId: 'test-iphone-15', occurredAt: new Date(Date.now() - n * 60_000).toISOString(), receivedAt: new Date().toISOString(),
	category: 'sync', level: n === 0 ? 'error' : 'info', code: n === 0 ? 'sync.failed' : 'sync.snapshot', state: n === 0 ? 'failed' : 'running', phase: 'uploading', reason: n === 0 ? 'cloud-request' : undefined,
	failureOperation: n === 0 ? 'parts' : undefined, retryAt: n === 0 ? new Date(Date.now() + 60_000).toISOString() : undefined,
	counts: { inspectedAssets: 100, uploadedFiles: 7, uploadedBytes: 12941177 }, runtime: { platform: 'ios', appVersion: '1.0', build: '70', osVersion: '26.1' },
	systemError: n === 0 ? { domain: 'NSURLErrorDomain', code: -1009 } : undefined }));
let layout: any = null;
const trace: string[] = [];
window.fetch = async (input, init) => {
	const url = new URL(String(input), location.origin); trace.push(url.pathname);
	if (url.pathname === '/api/v1/capabilities') return json({ ok: true, schemaVersion: 1, origin: selectedOrigin, features: { 'api.devices-diagnostics': '1.0.0' } });
	if (url.pathname.endsWith('capabilities.json')) return json({ schemaVersion: 1, origin: selectedOrigin, features: Object.fromEntries(Object.entries({ 'api.devices-diagnostics': '1.0.0', 'api.webpages-resolve': '1.6.0', 'api.actions-run': '1.7.0', 'api.mongodb-endpoint': '1.1.0', 'api.things': '1.64.0' }).map(([k, version]) => [k, { version }])) });
	if (url.pathname === '/api/v1/webpages/resolve') { layout = JSON.parse(localStorage.getItem('debug-layout-fixture') || 'null'); return json({ ok: true, page: layout, source: layout ? 'user' : 'builtin' }); }
	if (url.pathname === '/api/v1/things') {
		const body = JSON.parse(String(init?.body || '{}'));
		layout = { id: body.id || body.shareId, author: { id: owner }, updatedAt: new Date().toISOString(), crystal: body.crystal };
		localStorage.setItem('debug-layout-fixture', JSON.stringify(layout)); return json({ ok: true, thing: layout });
	}
	if (url.pathname === '/api/v1/devices/diagnostics') {
		if (new URLSearchParams(location.search).has('hold')) await new Promise<void>(resolve => { held = resolve; });
		if (fail) throw new TypeError('Synthetic connection unavailable');
		if (init?.method === 'POST') { const body = JSON.parse(String(init.body)); if (body.action === 'settings') enabled = body.enabled; if (body.action === 'clear') { empty = true; return json({ ok: true, requestId: body.requestId, throughSequence: body.throughSequence, deleted: events.length, hasMore: false }); } return json({ ok: true }); }
		const filtered = (empty ? [] : events).filter(e => (!url.searchParams.get('level') || e.level === url.searchParams.get('level')) && (!url.searchParams.get('category') || e.category === url.searchParams.get('category')) && (!url.searchParams.get('deviceId') || e.deviceId === url.searchParams.get('deviceId')));
		const offset = Number(url.searchParams.get('cursor') || '0');
		return json({ ok: true, folder: { id: 'debug-folder', name: 'Debug', hidden: true }, settings: { enabled }, throughSequence: 12, events: filtered.slice(offset, offset + 6), nextCursor: filtered.length > offset + 6 ? String(offset + 6) : null });
	}
	return json({ ok: true, things: [] });
};
Object.assign(window, { debugFixture: { trace, retireIdentity: () => rootIdentity.changed(), badFallback: (v: boolean) => { badFallback = v; }, fail: (v: boolean) => { fail = v; }, empty: (v: boolean) => { empty = v; }, release: () => held?.() } });
const router = createMemoryRouter([{ id: 'root', path: '*', loader: () => ({ user: { id: owner, username: 'debug-render', accountKind: 'user' }, dataPlane: 'home' }), element: <ChakraProvider><CurrentPageBuilderFixture><DeviceDebugPage /></CurrentPageBuilderFixture></ChakraProvider> }]);
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
