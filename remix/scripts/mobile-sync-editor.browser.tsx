import { thingtimeCapabilityManifest } from '../app/api/utils/capabilities/thingtimeCapabilities';
import type { MobileFolder } from '../app/fileSync/mobileFolders.client';
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
import { DesktopSyncBootstrap } from '../app/fileSync/DesktopSyncBootstrap';
import { MobileFolderAccess } from '../app/components/Devices/MobileFolderAccess';
import { nativeBridgeMessageEvent } from '../app/utils/nativeBridge';
const inspectionQA = new URLSearchParams(location.search).has('inspect');
const inventoryQA = new URLSearchParams(location.search).has('inventory');
const observations = { scans: 0, inspections: 0, captures: 0, pages: 0, discarded: 0 };
const nativeCaptures = new Map<string, { capture: { id: string; generation: string; totalEntries: number }; entries: typeof localEntries }>();
const inventoryReply = (request: any) => {
	if (request.action === 'scan-capture') {
		const capture = { id: request.captureId, generation: crypto.randomUUID(), totalEntries: localEntries.length };
		nativeCaptures.set(capture.id, { capture, entries: structuredClone(localEntries) });
		return { complete: true, capture };
	}
	if (request.action === 'scan-page' || request.action === 'scan-discard') {
		const item = nativeCaptures.get(request.capture.id);
		if (!item || JSON.stringify(item.capture) !== JSON.stringify(request.capture)) throw Error('Native fixture capture changed');
		if (request.action === 'scan-discard') { nativeCaptures.delete(item.capture.id); return { complete: true, discarded: true }; }
		const entries = item.entries.slice(request.offset, request.offset + 1), end = request.offset + entries.length;
		return { complete: true, inventoryPage: { capture: item.capture, offset: request.offset, entries, nextOffset: end === item.capture.totalEntries ? null : end } };
	}
	return {};
};
const observe = (request: any) => {
	if (request.action === 'scan') observations.scans++;
	if (request.action === 'inspect') observations.inspections++;
	if (request.action === 'scan-capture') observations.captures++;
	if (request.action === 'scan-page') observations.pages++;
	if (request.action === 'scan-discard') observations.discarded++;
};
Object.assign(window, { syncInspectionFixture: { observations } });
const photoQA = new URLSearchParams(location.search).has('photos');
const desktop = new URLSearchParams(location.search).get('platform') === 'desktop';
const taskQA = desktop && new URLSearchParams(location.search).has('tasks');
let taskHeld = false;
const heldScans = new Map<string, () => void>();
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
const canonicalOrigin = new URLSearchParams(location.search).has('other-origin') ? 'https://other-sync.invalid' : 'https://desktop-sync.invalid';
const ownerId = new URLSearchParams(location.search).has('other-account') ? 'other-sync-ui-fixture' : photoQA ? 'sync-ui-photo-fixture' : 'sync-ui-fixture',
	deviceId = 'sync-ui-device',
	databaseKey = 'tt:fixture:sync-editor-database' + (photoQA ? ':photos' : captureQA ? ':capture' : conflictQA ? ':conflicts' : '');
let rows: any[] = JSON.parse(localStorage.getItem(databaseKey) || 'null') ?? [
	{ id: 'cloud-documents', thingtime: ['folder'], author: { id: ownerId }, acl: ['tt:user'], crystal: { name: 'Cloud documents' } }
];
let transferFolders: any[] = JSON.parse(localStorage.getItem('tt:fixture:sync-transfer-folders') || '[]');
let holdNextScan = false, holdTransferReply = false;
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
if ((conflictQA || taskQA) && !rows.some((row) => row.thingtime.includes('file-sync')))
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
const initialRoots: MobileFolder[] = [
	{
		id: '11111111-1111-4111-8111-111111111111',
		name: photoQA ? 'Photo library' : 'Project documents',
		...(photoQA ? { sourceKind: 'photos' as const, photoAccess: 'limited' as const } : {})
	}
];
let roots = new URLSearchParams(location.search).has('revoked-root') ? [] : structuredClone(initialRoots),
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
	if (url.pathname === '/.well-known/thingtime-capabilities.json') return fixtureJson(thingtimeCapabilityManifest(url.origin));
	if (taskQA && url.pathname === '/api/v1/webpages/resolve') {
		const headers = new Headers(init?.headers);
		if (url.origin !== location.origin || headers.get('X-Thingtime-Expected-Api-Origin') !== canonicalOrigin ||
			headers.get('X-Thingtime-Expected-Actor') !== ownerId || headers.get('X-Thingtime-Expected-Data-Plane') !== 'home')
			return fixtureJson({ ok: false }, { status: 409 });
		const page = rows.find(row => row.thingtime.includes('webpage') && row.crystal.pageKey === url.searchParams.get('id'));
		return page ? fixtureJson({ ok: true, page, source: 'user' }) : fixtureJson({ ok: false }, { status: 404 });
	}
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
				parts: [{ partNumber: 1, url: (desktop ? canonicalOrigin : location.origin) + '/fixture-capture-part', headers: { 'x-amz-checksum-sha256': body.parts[0].checksumSha256 } }]
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
			if (holdTransferReply) await new Promise(() => {});
			if (loseTransferReply) {
				loseTransferReply = false;
				throw Error('Fixture lost accepted folder creation');
			}
			return fixtureJson({ ok: true, folder, replayed: false });
		}
		if (url.searchParams.has('rootId')) {
			const inventory = {
				version: 1, complete: true, rootId: url.searchParams.get('rootId'), rootRevision: 'fixture-root-v1',
				nodes: conflictQA ? conflictFiles().map(file => ({ kind: 'file', path: file.name, file }))
					: transferFolders.map(row => ({ kind: 'folder', path: row.name, id: row.id, folderId: row.folderId, revision: row.revision }))
			};
			if (url.searchParams.get('pages') === '1') return new Response(JSON.stringify({ ...inventory,
				generation: crypto.randomUUID(), ordinal: 0, totalEntries: inventory.nodes.length }) + '\n',
				{ headers: { 'Content-Type': 'application/x-ndjson', ...(desktop ? { 'x-thingtime-api-fallback': canonicalOrigin } : {}) } });
			return fixtureJson({ ok: true, inventory });
		}
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
	platform: new URLSearchParams(location.search).get('platform') === 'ios' ? 'ios' : 'android',
	isNativeWebView: true,
	devicePairingVersion: '1.0.0',
	fileAccessVersion: inspectionQA && new URLSearchParams(location.search).get('platform') === 'ios' ? (inventoryQA ? '1.3.1' : '1.2.0') : '1.1.0',
	postMessage(message) {
		const request = message.payload as any;
		observe(request);
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
				if (request.action === 'choose') roots = structuredClone(initialRoots);
				window.dispatchEvent(
					new CustomEvent(nativeBridgeMessageEvent, {
						detail: {
							type: 'mobile-files-result',
							payload: {
								...request,
								roots,
								...inventoryReply(request),
				...(request.action === 'scan' ? { complete: true, entries: localEntries } : {}),
								...(request.action === 'inspect' ? { complete: true, entry: localEntries.find(entry => entry.path === request.path) ?? null } : {}),
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
		...(taskQA ? { folderSyncTaskVersion: '1.0.0', setFolderSyncActive: async ({ active }: { active: boolean }) => {
			taskHeld = active; captureRedraw(); return { ok: true as const, version: '1.0.0' as const };
		} } : {}),
		folderSyncRequest: async (request: any) => {
			observe(request);
			if (request.action === 'suspend') {
				pending.get(request.requestId)?.({});
				pending.delete(request.requestId);
				return {};
			}
			if (request.ownerId !== ownerId || request.deviceId !== deviceId || (request.action !== 'context' && request.origin !== canonicalOrigin))
				throw Error('Desktop fixture identity changed');
			if (request.action === 'scan' && holdNextScan) {
				holdNextScan = false;
				if (taskQA) {
					await new Promise<void>(resolve => { heldScans.set(request.requestId, resolve); pending.set(request.requestId, resolve as any); });
					heldScans.delete(request.requestId); pending.delete(request.requestId);
				} else
				return await new Promise((resolve) => pending.set(request.requestId, resolve));
			}
			if (request.action === 'remove') roots = roots.filter((root) => root.id !== request.rootId);
			if (request.action === 'choose') roots = structuredClone(initialRoots);
			const manifest = request.action === 'context' ? thingtimeCapabilityManifest(canonicalOrigin) : undefined;
			return {
				...request,
				origin: canonicalOrigin,
				roots,
				...(manifest ? { capabilities: { fileAccessVersion: inspectionQA ? (inventoryQA ? '1.5.1' : '1.4.0') : '1.1.0' }, apiCapabilities: { ...manifest, origin: canonicalOrigin } } : {}),
				...inventoryReply(request),
				...(request.action === 'scan' ? { complete: true, entries: localEntries } : {}),
				...(request.action === 'inspect' ? { complete: true, entry: localEntries.find(entry => entry.path === request.path) ?? null } : {}),
				...(captureQA && request.action === 'read' ? captureChunk(request) : {}),
				...(captureQA && request.action === 'read-range'
					? { chunk: { version: request.version, size: captureBytes.length, offset: request.offset, length: request.length, bytes: captureBytes.slice(request.offset, request.offset + request.length) } }
					: {}),
				...(request.action === 'conditions' ? { conditions: { network: unavailable ? 'offline' : network, charging: true } } : {})
			};
		}
	};
}
function Fixture() {
	const [, redraw] = useState(0);
	const [showFolders, setShowFolders] = useState(!new URLSearchParams(location.search).has('away'));
	captureRedraw = () => redraw((n) => n + 1);
	return (
		<ChakraProvider>
			{taskQA && <DesktopSyncBootstrap ownerId={ownerId} generation={0} />}
			<Box maxWidth="760px" margin="auto" padding={4}>
				<Text as="h1" fontSize="20px" fontWeight="bold">
					{desktop ? 'Desktop sync editor regression' : 'Mobile sync editor regression'}
				</Text>
				<Text fontSize="12px">Synthetic API and native grants. No real files are accessed or uploaded.</Text>
				{taskQA && <><Text role="status">App transfer lease: {taskHeld ? 'active' : 'idle'}</Text>
					<Button onClick={() => setShowFolders(value => !value)}>{showFolders ? 'Leave Files screen' : 'Reopen Files screen'}</Button>
					<Button onClick={() => { for (const release of heldScans.values()) release(); }}>Release scan</Button>
					<Button onClick={() => { holdTransferReply = true; }}>Hold accepted upload reply</Button></>}
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
				{showFolders && <Box border="1px solid #ddd" borderRadius="12px" padding={4}>
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
				</Box>}
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
