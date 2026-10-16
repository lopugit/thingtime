// Render the production editor and useApi under StrictMode. Only the Things API
// and native grants are synthetic. Never loads credentials or real user files.
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Box, Button, ChakraProvider, Flex, Text } from '@chakra-ui/react';
import { MobileFolderAccess } from '../app/components/Devices/MobileFolderAccess';
import { nativeBridgeMessageEvent } from '../app/utils/nativeBridge';
const ownerId = 'sync-ui-fixture',
	deviceId = 'sync-ui-device',
	databaseKey = 'tt:fixture:sync-editor-database';
let rows: any[] = JSON.parse(localStorage.getItem(databaseKey) || 'null') ?? [
	{ id: 'cloud-documents', thingtime: ['folder'], author: { id: ownerId }, acl: ['tt:user'], crystal: { name: 'Cloud documents' } }
];
let roots = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Project documents' }],
	loseReply = false,
	unavailable = false;
const persist = () => localStorage.setItem(databaseKey, JSON.stringify(rows));
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
	const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
	init?.signal?.throwIfAborted();
	if (url.pathname !== '/api/v1/things') return originalFetch(input, init);
	const headers = new Headers(init?.headers);
	if (headers.get('X-Thingtime-Expected-Actor') !== ownerId || headers.get('X-Thingtime-Expected-Data-Plane') !== 'home')
		return Response.json({ ok: false, error: 'Missing fixture scope headers' }, { status: 409 });
	const method = init?.method || 'GET';
	if (method === 'GET') {
		const id = url.searchParams.get('id');
		if (id) {
			const thing = rows.find((r) => r.id === id);
			return Response.json(thing ? { ok: true, thing } : { ok: false, error: 'Not found' }, { status: thing ? 200 : 404 });
		}
		return Response.json({ ok: true, things: rows.filter((r) => r.thingtime.includes(url.searchParams.get('thingtime'))), nextCursor: null });
	}
	if (unavailable) throw Error('Fixture is offline');
	const body = JSON.parse(String(init?.body));
	if (method === 'POST') {
		if (rows.some((r) => r.id === body.shareId)) return Response.json({ ok: false, error: 'Already exists' }, { status: 409 });
		rows.push({
			id: body.shareId,
			thingtime: body.thingtime,
			crystal: body.crystal,
			author: { id: ownerId },
			acl: body.acl,
			updatedAt: new Date().toISOString()
		});
	} else if (method === 'PATCH') {
		const row = rows.find((r) => r.id === body.id);
		if (!row || row.updatedAt !== body.expectedUpdatedAt) return Response.json({ ok: false, error: 'Stale revision' }, { status: 409 });
		row.crystal = body.crystal;
		row.updatedAt = new Date().toISOString();
	} else throw Error('Unsupported fixture method');
	persist();
	if (loseReply) {
		loseReply = false;
		throw Error('Fixture lost the accepted response');
	}
	return Response.json({ ok: true, thing: rows.at(-1) });
};
window.thingtimeNativeBridge = {
	version: '1.0.0',
	platform: 'android',
	isNativeWebView: true,
	devicePairingVersion: '1.0.0',
	fileAccessVersion: '1.0.0',
	postMessage(message) {
		const request = message.payload as any;
		if (request.action === 'suspend') return;
		setTimeout(() => {
			if (message.type === 'mobile-device')
				window.dispatchEvent(
					new CustomEvent(nativeBridgeMessageEvent, { detail: { type: 'mobile-device-result', payload: { ...request, state: 'paired', deviceId } } })
				);
			else {
				if (request.action === 'remove') roots = roots.filter((r) => r.id !== request.rootId);
				if (request.action === 'choose') roots = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Project documents' }];
				window.dispatchEvent(
					new CustomEvent(nativeBridgeMessageEvent, {
						detail: {
							type: 'mobile-files-result',
							payload: { ...request, roots, ...(request.action === 'scan' ? { complete: true, entries: [] } : {}) }
						}
					})
				);
			}
		}, 30);
	}
};
function Fixture() {
	return (
		<ChakraProvider>
			<Box maxWidth="760px" margin="auto" padding={4}>
				<Text as="h1" fontSize="20px" fontWeight="bold">
					Mobile sync editor regression
				</Text>
				<Text fontSize="12px">Synthetic API and native grants. No files are accessed or uploaded.</Text>
				<Flex gap={2} wrap="wrap" marginY={3}>
					<Button
						size="sm"
						onClick={() => {
							loseReply = true;
						}}
					>
						Lose next save reply
					</Button>
					<Button
						size="sm"
						onClick={() => {
							unavailable = true;
						}}
					>
						Go offline
					</Button>
					<Button
						size="sm"
						onClick={() => {
							unavailable = false;
						}}
					>
						Go online
					</Button>
					<Button
						size="sm"
						onClick={() => {
							for (const r of rows)
								if (r.thingtime.includes('file-sync')) {
									r.crystal.name = 'Changed elsewhere';
									r.updatedAt = new Date().toISOString();
								}
							persist();
						}}
					>
						Change saved version elsewhere
					</Button>
				</Flex>
				<Box border="1px solid #ddd" borderRadius="12px" padding={4}>
					<Text fontWeight="bold">This device is added</Text>
					<MobileFolderAccess ownerId={ownerId} deviceId={deviceId} />
				</Box>
			</Box>
		</ChakraProvider>
	);
}
const router = createMemoryRouter([{ id: 'root', path: '/', loader: () => ({ user: { id: ownerId }, dataPlane: 'home' }), element: <Fixture /> }]);
createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>
);
