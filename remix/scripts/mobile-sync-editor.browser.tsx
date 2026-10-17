// Render the production editor and useApi under StrictMode. Only the Things API
// and native grants are synthetic. Never loads credentials or real user files.
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Box, Button, ChakraProvider, Flex, Text } from '@chakra-ui/react';
import { DesktopFolderAccess } from '../app/components/Devices/DesktopFolderAccess';
import { MobileFolderAccess } from '../app/components/Devices/MobileFolderAccess';
import { nativeBridgeMessageEvent } from '../app/utils/nativeBridge';
const desktop = new URLSearchParams(location.search).get('platform') === 'desktop';
const canonicalOrigin = 'https://desktop-sync.invalid';
const ownerId = 'sync-ui-fixture',
	deviceId = 'sync-ui-device',
	databaseKey = 'tt:fixture:sync-editor-database';
let rows: any[] = JSON.parse(localStorage.getItem(databaseKey) || 'null') ?? [
	{ id: 'cloud-documents', thingtime: ['folder'], author: { id: ownerId }, acl: ['tt:user'], crystal: { name: 'Cloud documents' } }
];
let transferFolders: any[] = JSON.parse(localStorage.getItem('tt:fixture:sync-transfer-folders') || '[]');
let holdNextScan = false;
let loseTransferReply = false,
	network = 'wifi';
const localEntries = [{ path: 'Upload sample', id: 'native-sample-folder', version: 'native-v1', kind: 'folder', size: 0, sha256: null }];
let roots = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Project documents' }],
	loseReply = false,
	unavailable = false;
const persist = () => localStorage.setItem(databaseKey, JSON.stringify(rows));
const originalFetch = window.fetch.bind(window);
const fixtureJson = (data: any, init?: ResponseInit) =>
	Response.json(data, { ...init, headers: { ...init?.headers, ...(desktop ? { 'x-thingtime-api-fallback': canonicalOrigin } : {}) } });
window.fetch = async (input, init) => {
	const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
	init?.signal?.throwIfAborted();
	if (
		desktop &&
		['/api/v1/files', '/api/v1/things'].includes(url.pathname) &&
		(url.origin !== location.origin || new Headers(init?.headers).get('X-Thingtime-Expected-Api-Origin') !== canonicalOrigin)
	)
		throw Error('Desktop proxy destination was not pinned');
	if (url.pathname === '/api/v1/files') {
		if (unavailable) throw Error('Fixture is offline');
		const headers = new Headers(init?.headers);
		if (headers.get('X-Thingtime-Expected-Actor') !== ownerId || headers.get('X-Thingtime-Expected-Data-Plane') !== 'home')
			return fixtureJson({ ok: false }, { status: 409 });
		if (init?.method === 'POST') {
			const body = JSON.parse(String(init.body));
			if (body.kind !== 'folder') throw Error('No real file uploads in this fixture');
			const existing = transferFolders.find((row) => row.id === body.id);
			if (existing) return fixtureJson({ ok: true, folder: existing, replayed: true });
			const folder = { id: body.id, folderId: body.folderId, name: body.name, revision: 'fixture-' + body.id };
			transferFolders.push(folder);
			localStorage.setItem('tt:fixture:sync-transfer-folders', JSON.stringify(transferFolders));
			if (loseTransferReply) {
				loseTransferReply = false;
				throw Error('Fixture lost accepted folder creation');
			}
			return fixtureJson({ ok: true, folder, replayed: false });
		}
		if (url.searchParams.has('rootId'))
			return fixtureJson({
				ok: true,
				inventory: {
					version: 1,
					complete: true,
					rootId: url.searchParams.get('rootId'),
					rootRevision: 'fixture-root-v1',
					nodes: transferFolders.map((row) => ({ kind: 'folder', path: row.name, id: row.id, folderId: row.folderId, revision: row.revision }))
				}
			});
		const folder = transferFolders.find((row) => row.id === url.searchParams.get('folderId'));
		if (url.searchParams.has('operationId')) return fixtureJson({ ok: true, receipt: folder ?? null });
		return folder ? fixtureJson({ ok: true, folder }) : fixtureJson({ ok: false }, { status: 404 });
	}
	if (url.pathname !== '/api/v1/things') return originalFetch(input, init);
	const headers = new Headers(init?.headers);
	if (headers.get('X-Thingtime-Expected-Actor') !== ownerId || headers.get('X-Thingtime-Expected-Data-Plane') !== 'home')
		return fixtureJson({ ok: false, error: 'Missing fixture scope headers' }, { status: 409 });
	const method = init?.method || 'GET';
	if (method === 'GET') {
		const id = url.searchParams.get('id');
		if (id) {
			const thing = rows.find((r) => r.id === id);
			return fixtureJson(thing ? { ok: true, thing } : { ok: false, error: 'Not found' }, { status: thing ? 200 : 404 });
		}
		return fixtureJson({ ok: true, things: rows.filter((r) => r.thingtime.includes(url.searchParams.get('thingtime'))), nextCursor: null });
	}
	if (unavailable) throw Error('Fixture is offline');
	const body = JSON.parse(String(init?.body));
	if (method === 'POST') {
		if (rows.some((r) => r.id === body.shareId)) return fixtureJson({ ok: false, error: 'Already exists' }, { status: 409 });
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
		if (!row || row.updatedAt !== body.expectedUpdatedAt) return fixtureJson({ ok: false, error: 'Stale revision' }, { status: 409 });
		row.crystal = body.crystal;
		row.updatedAt = new Date().toISOString();
	} else throw Error('Unsupported fixture method');
	persist();
	if (loseReply) {
		loseReply = false;
		throw Error('Fixture lost the accepted response');
	}
	return fixtureJson({ ok: true, thing: rows.at(-1) });
};
window.thingtimeNativeBridge = {
	version: '1.0.0',
	platform: 'android',
	isNativeWebView: true,
	devicePairingVersion: '1.0.0',
	fileAccessVersion: '1.1.0',
	postMessage(message) {
		const request = message.payload as any;
		if (request.action === 'suspend') return;
		if (request.action === 'scan' && holdNextScan) {
			holdNextScan = false;
			return;
		}
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
							payload: {
								...request,
								roots,
								...(request.action === 'scan' ? { complete: true, entries: localEntries } : {}),
								...(request.action === 'conditions' ? { conditions: { network: unavailable ? 'offline' : network, charging: true } } : {})
							}
						}
					})
				);
			}
		}, 30);
	}
};
if (desktop) {
	const pending = new Map<string, (value: unknown) => void>();
	window.thingtimeNativeBridge = undefined;
	window.thingtimeDesktop = {
		platform: 'darwin',
		folderSyncRequest: async (request: any) => {
			if (request.action === 'suspend') {
				pending.get(request.requestId)?.({});
				pending.delete(request.requestId);
				return {};
			}
			if (request.ownerId !== ownerId || request.deviceId !== deviceId || (request.action !== 'context' && request.origin !== canonicalOrigin))
				throw Error('Desktop fixture identity changed');
			if (request.action === 'scan' && holdNextScan) {
				holdNextScan = false;
				return await new Promise((resolve) => pending.set(request.requestId, resolve));
			}
			if (request.action === 'remove') roots = roots.filter((root) => root.id !== request.rootId);
			if (request.action === 'choose') roots = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Project documents' }];
			const manifest = request.action === 'context' ? await (await originalFetch('/.well-known/thingtime-capabilities.json')).json() : undefined;
			return {
				...request,
				origin: canonicalOrigin,
				roots,
				...(manifest ? { capabilities: { fileAccessVersion: '1.1.0' }, apiCapabilities: { ...manifest, origin: canonicalOrigin } } : {}),
				...(request.action === 'scan' ? { complete: true, entries: localEntries } : {}),
				...(request.action === 'conditions' ? { conditions: { network: unavailable ? 'offline' : network, charging: true } } : {})
			};
		}
	};
}
function Fixture() {
	return (
		<ChakraProvider>
			<Box maxWidth="760px" margin="auto" padding={4}>
				<Text as="h1" fontSize="20px" fontWeight="bold">
					{desktop ? 'Desktop sync editor regression' : 'Mobile sync editor regression'}
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
							loseTransferReply = true;
						}}
					>
						Lose next upload reply
					</Button>
					<Button
						size="sm"
						onClick={() => {
							network = 'cellular';
						}}
					>
						Use cellular
					</Button>
					<Button
						size="sm"
						onClick={() => {
							network = 'wifi';
						}}
					>
						Use Wi-Fi
					</Button>
					<Button
						size="sm"
						onClick={() => {
							holdNextScan = true;
						}}
					>
						Hold next scan
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
					{desktop ? (
						<DesktopFolderAccess ownerId={ownerId} pairedDeviceIds={[deviceId]} ownedDeviceIds={[deviceId]} />
					) : (
						<MobileFolderAccess ownerId={ownerId} deviceId={deviceId} />
					)}
				</Box>
			</Box>
		</ChakraProvider>
	);
}
const router = createMemoryRouter([
	{ id: 'root', path: '/', loader: () => ({ user: { id: ownerId, accountKind: 'user' }, dataPlane: 'home' }), element: <Fixture /> }
]);
createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>
);
