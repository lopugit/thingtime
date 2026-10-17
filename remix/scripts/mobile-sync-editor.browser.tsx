import { fingerprintSource } from '../app/fileSync/contentFingerprint';
import { fileRetentionEventId } from '../app/fileSync/fileVersions';
// Render the production editor and useApi under StrictMode. Only the Things API
// and native grants are synthetic. Never loads credentials or real user files.
import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Box, Button, ChakraProvider, Flex, Text } from '@chakra-ui/react';
import { SyncConflictReview } from '../app/components/Devices/SyncConflictReview';
import { DesktopFolderAccess } from '../app/components/Devices/DesktopFolderAccess';
import { MobileFolderAccess } from '../app/components/Devices/MobileFolderAccess';
import { nativeBridgeMessageEvent } from '../app/utils/nativeBridge';
const desktop = new URLSearchParams(location.search).get('platform') === 'desktop';
const captureQA = new URLSearchParams(location.search).has('capture');
const conflictQA = captureQA || new URLSearchParams(location.search).has('conflicts');
const captureBytes = new Uint8Array([1, 2, 3]);
const captureFingerprint = await fingerprintSource({
	size: 3,
	check: () => {},
	read: async (offset, length) => captureBytes.slice(offset, offset + length)
});
const captureKey = 'tt:fixture:conflict-captures:' + (desktop ? 'desktop' : 'mobile');
const captureReceipts = new Map<string, any>(JSON.parse(localStorage.getItem(captureKey) ?? '[]'));
let capturePuts = 0,
	captureRedraw = () => {};
const captureReady = new Set<string>();
const canonicalOrigin = 'https://desktop-sync.invalid';
const ownerId = 'sync-ui-fixture',
	deviceId = 'sync-ui-device',
	databaseKey = 'tt:fixture:sync-editor-database' + (captureQA ? ':capture' : conflictQA ? ':conflicts' : '');
let rows: any[] = JSON.parse(localStorage.getItem(databaseKey) || 'null') ?? [
	{ id: 'cloud-documents', thingtime: ['folder'], author: { id: ownerId }, acl: ['tt:user'], crystal: { name: 'Cloud documents' } }
];
let transferFolders: any[] = JSON.parse(localStorage.getItem('tt:fixture:sync-transfer-folders') || '[]');
let holdNextScan = false;
let loseTransferReply = false,
	network = 'wifi';
const localEntries = conflictQA
	? Array.from({ length: captureQA ? 2 : 22 }, (_, i) => ({
			path: `Report-${String(i + 1).padStart(2, '0')}${i === 0 ? '-a-long-filename-for-review-on-a-small-phone-screen' : ''}.txt`,
			id: `native-${i}`,
			version: 'local-1',
			kind: 'file',
			size: 3,
			sha256: null,
			fingerprint: captureQA ? captureFingerprint : { algorithm: 'sha256-parts-v1', partSizeBytes: 8388608, partCount: 1, sha256: 'a'.repeat(64) }
	  }))
	: [{ path: 'Upload sample', id: 'native-sample-folder', version: 'native-v1', kind: 'folder', size: 0, sha256: null }];
let conflictRevision = 'cloud-1';
if (conflictQA && !rows.some((row) => row.thingtime.includes('file-sync')))
	rows.push({
		id: captureQA ? 'capture-connection' : 'conflict-connection',
		updatedAt: '2026-10-17T00:00:00.000Z',
		thingtime: ['file-sync'],
		author: { id: ownerId },
		acl: ['tt:user'],
		crystal: {
			configurationVersion: 1,
			name: 'Conflicting documents',
			deviceId,
			localRootId: '11111111-1111-4111-8111-111111111111',
			remoteFolderId: 'cloud-documents',
			mode: 'backup',
			paused: false,
			propagateDeletes: false,
			network: 'any',
			chargingOnly: false,
			excludedPaths: []
		}
	});
const conflictFiles = () =>
	localEntries.map((entry, i) => ({
		id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
		revision: conflictRevision,
		name: entry.path,
		folderId: 'cloud-documents',
		trashed: false,
		content: {
			attachmentId: `attachment-${i}`,
			version: 'b'.repeat(64),
			size: 4,
			fingerprint: { algorithm: 'sha256-parts-v1', partSizeBytes: 8388608, partCount: 1, sha256: 'b'.repeat(64) }
		}
	}));
const captureChunk = (request: any) => ({
	chunk: {
		version: request.version,
		size: 3,
		offset: request.offset,
		data: btoa(String.fromCharCode(...captureBytes.slice(request.offset, request.offset + request.length)))
	}
});
let roots = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Project documents' }],
	loseReply = false,
	unavailable = false;
const persist = () => localStorage.setItem(databaseKey, JSON.stringify(rows));
const originalFetch = window.fetch.bind(window);
const fixtureJson = (data: any, init?: ResponseInit) =>
	Response.json(data, { ...init, headers: { ...init?.headers, ...(desktop ? { 'x-thingtime-api-fallback': canonicalOrigin } : {}) } });
window.fetch = async function (this: unknown, input, init) {
	// Match WebKit: a copied fetch must not receive a transport object as `this`.
	if (this !== undefined && this !== window) throw new TypeError('Can only call Window.fetch on instances of Window');
	const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
	init?.signal?.throwIfAborted();
	if (
		desktop &&
		['/api/v1/files', '/api/v1/things'].includes(url.pathname) &&
		(url.origin !== location.origin || new Headers(init?.headers).get('X-Thingtime-Expected-Api-Origin') !== canonicalOrigin)
	)
		throw Error('Desktop proxy destination was not pinned');
	if (captureQA && url.pathname === '/fixture-capture-part') {
		capturePuts++;
		captureRedraw();
		return new Response(null);
	}
	if (captureQA && url.pathname.startsWith('/api/v1/attachments/')) {
		const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
		if (url.pathname.endsWith('/uploads'))
			return fixtureJson({
				ok: true,
				upload: {
					id: 'capture-' + body.requestId,
					partSizeBytes: captureFingerprint.partSizeBytes,
					partCount: 1,
					...(captureReady.has('capture-' + body.requestId) ? { state: 'ready' } : {})
				}
			});
		if (url.pathname.endsWith('/parts'))
			return fixtureJson({
				ok: true,
				parts: [{ partNumber: 1, url: location.origin + '/fixture-capture-part', headers: { 'x-amz-checksum-sha256': body.parts[0].checksumSha256 } }]
			});
		if (url.pathname.endsWith('/complete')) {
			captureReady.add(body.uploadId);
			return fixtureJson({ ok: true });
		}
		if (url.pathname.endsWith('/content'))
			return fixtureJson({ ok: true, id: url.searchParams.get('id'), version: 'c'.repeat(64), size: 3, fingerprint: captureFingerprint });
		throw Error('Unexpected synthetic attachment request');
	}
	if (url.pathname === '/api/v1/files') {
		if (unavailable) throw Error('Fixture is offline');
		const headers = new Headers(init?.headers);
		if (headers.get('X-Thingtime-Expected-Actor') !== ownerId || headers.get('X-Thingtime-Expected-Data-Plane') !== 'home')
			return fixtureJson({ ok: false }, { status: 409 });
		if (init?.method === 'POST') {
			const body = JSON.parse(String(init.body));
			if (captureQA && body.kind === 'retained-version') {
				const prior = captureReceipts.get(body.operationId);
				if (prior) {
					if (prior.body !== JSON.stringify(body)) return fixtureJson({ ok: false }, { status: 409 });
					return fixtureJson({ ok: true, file: prior.file, retained: true, replayed: true });
				}
				const before = conflictFiles().find((file) => file.id === body.id);
				if (!before || before.revision !== body.expectedRevision) return fixtureJson({ ok: false }, { status: 409 });
				const file = {
					...before,
					revision: await fileRetentionEventId(ownerId, body.id, body.operationId),
					content: { attachmentId: body.attachmentId, version: body.contentVersion, size: 3, fingerprint: captureFingerprint }
				};
				captureReceipts.set(body.operationId, { body: JSON.stringify(body), file });
				localStorage.setItem(captureKey, JSON.stringify([...captureReceipts]));
				captureRedraw();
				if (loseTransferReply) {
					loseTransferReply = false;
					throw Error('Fixture lost accepted retention reply');
				}
				return fixtureJson({ ok: true, file, retained: true, replayed: false });
			}
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
					nodes: conflictQA
						? conflictFiles().map((file) => ({ kind: 'file', path: file.name, file }))
						: transferFolders.map((row) => ({ kind: 'folder', path: row.name, id: row.id, folderId: row.folderId, revision: row.revision }))
				}
			});
		if (captureQA && url.searchParams.has('id')) {
			if (url.searchParams.has('operationId'))
				return fixtureJson({
					ok: true,
					receipt:
						url.searchParams.get('kind') === 'retained-version'
							? captureReceipts.get(url.searchParams.get('operationId')!)
								? { file: captureReceipts.get(url.searchParams.get('operationId')!)!.file }
								: null
							: null
				});
			return fixtureJson({ ok: true, file: conflictFiles().find((file) => file.id === url.searchParams.get('id')) });
		}
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
								...(captureQA && request.action === 'read' ? captureChunk(request) : {}),
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
				...(captureQA && request.action === 'read' ? captureChunk(request) : {}),
				...(request.action === 'conditions' ? { conditions: { network: unavailable ? 'offline' : network, charging: true } } : {})
			};
		}
	};
}
function Fixture() {
	const [, redraw] = useState(0);
	captureRedraw = () => redraw((n) => n + 1);
	return (
		<ChakraProvider>
			<Box maxWidth="760px" margin="auto" padding={4}>
				<Text as="h1" fontSize="20px" fontWeight="bold">
					{desktop ? 'Desktop sync editor regression' : 'Mobile sync editor regression'}
				</Text>
				<Text fontSize="12px">Synthetic API and native grants. No real files are accessed or uploaded.</Text>
				{captureQA && (
					<Text role="status">
						Captured versions: {captureReceipts.size}. Upload parts this page: {capturePuts}. Cloud revision: {conflictRevision}.
					</Text>
				)}
				<Flex gap={2} wrap="wrap" marginY={3}>
					{conflictQA && (
						<Button
							size="sm"
							onClick={() => {
								conflictRevision += '-edited';
							}}
						>
							Change conflicted cloud file
						</Button>
					)}
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
					{captureQA && new URLSearchParams(location.search).get('view') === 'review' ? (
						<SyncConflictReview
							mode="backup"
							conflicts={localEntries.map((entry, i) => ({
								kind: 'conflict' as const,
								path: entry.path,
								reason: 'both-changed' as const,
								local: entry,
								remote: { ...entry, id: conflictFiles()[i].id, version: conflictRevision, size: 4 }
							}))}
							onApply={() => {}}
							onRetain={() => {}}
							onCancel={() => {}}
						/>
					) : desktop ? (
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
