// Synthetic metadata only; the checker enforces an OS-level loopback boundary.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ChakraProvider, Box, Button, Text } from '@chakra-ui/react';
import { SyncProgressViewer } from '../app/components/Devices/SyncProgressViewer';
import { useMountedRef } from '../app/hooks/useMountedRef';
import type { SyncProgressRow, SyncProgressSource, SyncProgressState } from '../app/fileSync/progressProjection';
import type { ForegroundSyncProgress } from '../app/fileSync/foregroundSync';
import { thingtimeCapabilityManifest } from '../app/api/utils/capabilities/thingtimeCapabilities';
const scope = { origin: location.origin, ownerId: 'progress-fixture', dataPlane: 'home', deviceId: 'synthetic-device', rootId: 'synthetic-root' };
const rows: SyncProgressRow[] = [];
const add = (path: string, size: number, kind: 'file' | 'folder' = 'file', confirmed = false) => {
	const entry = { path, size, kind, id: path, version: 'one', sha256: kind === 'file' ? 'a'.repeat(64) : null };
	rows.push({ entry, operation: { id: path, confirmed, mutation: { kind: 'copy', path, from: 'local', source: entry, expectedTarget: null } } });
};
add('Documents', 0, 'folder', true); add('Documents/Nested', 0, 'folder', true);
add('Documents/Nested/large-file-with-a-very-long-name-that-must-wrap-on-mobile.bin', 990);
add('Documents/small.txt', 10, 'file', true); add('Empty folder', 0, 'folder', true);
for (let i = 0; i < 40; i++) add(`file-${String(i).padStart(2, '0')}.txt`, 1);
let deep = 'Deep'; add(deep, 0, 'folder');
for (let i = 1; i <= 12; i++) { deep += `/level-${String(i).padStart(2, '0')}`; add(deep, 0, 'folder'); }
add(`${deep}/deepest.txt`, 1);
rows.sort((a, b) => a.entry.path.toLowerCase() < b.entry.path.toLowerCase() ? -1 : 1);
const source: SyncProgressSource = { async *rows() { for (const row of rows) yield structuredClone(row); } };
const layoutKey = 'progress-fixture-layout', originalFetch = window.fetch.bind(window);
window.fetch = async function(input, init) {
	const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
	if (url.pathname.includes('thingtime-capabilities')) return Response.json(thingtimeCapabilityManifest(location.origin));
	if (url.pathname === '/api/v1/webpages/resolve') {
		const page = JSON.parse(localStorage.getItem(layoutKey) || 'null');
		const selected = page?.crystal?.pageKey === url.searchParams.get('id') ? page : null;
        return Response.json(selected ? { ok: true, page: selected, source: 'user' } : { ok: false }, { status: selected ? 200 : 404 });
	}
	if (url.pathname === '/api/v1/things' && ['POST', 'PATCH'].includes(init?.method || '')) {
		const input = JSON.parse(String(init?.body)), pages = JSON.parse(localStorage.getItem(layoutKey) || '{}'), old = pages[input.crystal.pageKey];
		if (old && input.expectedUpdatedAt !== old.updatedAt) return Response.json({ ok: false }, { status: 409 });
		const page = { id: old?.id || input.shareId, crystal: input.crystal, acl: input.acl || old.acl, author: { id: scope.ownerId }, updatedAt: new Date().toISOString() };
		localStorage.setItem(layoutKey, JSON.stringify({ ...pages, [page.crystal.pageKey]: page })); return Response.json({ ok: true, thing: page });
	}
	if (url.pathname.startsWith('/api/')) return Response.json({ ok: true, things: [], items: [], components: [] });
	return originalFetch(input, init);
};
function Fixture() {
	const mounted = useMountedRef();
	const [status, setStatus] = useState<SyncProgressState>('running');
	const [progress, setProgress] = useState<ForegroundSyncProgress>({ stage: 'transferring', total: rows.length, confirmed: 4,
		path: rows.find(r => r.entry.size === 990)!.entry.path, bytes: 495, size: 990 });
	return <ChakraProvider><Box maxW="760px" mx="auto" p={4}>
		<Text as="h1">Editable progress acceptance</Text>

        {([true,false] as const).map(known => <Button key={String(known)} onClick={() => { setStatus('running'); setProgress({stage:'transferring',total:512,confirmed:0,priorityReadiness:{gate:'enabled',preferencesCount:5,preferencesRevision:1,proofCursor:3629575,proofCutoff:3629575,candidateOrdinal:1,candidateSequence:2296559,blocker:'reserved-or-in-flight',measured:true,reserved:true,...(known?{folderBatchGate:'enabled',reservationKind:'file-recovery',reservationRemaining:89}:{})}}); }}>{known?'Recovery diagnostics fixture':'Legacy diagnostics fixture'}</Button>)}
		<Button onClick={() => setStatus('paused')}>Pause fixture</Button>
		<Button onClick={() => setStatus('error')}>Fail fixture</Button>
		<Button onClick={() => setProgress({ stage: 'scanning', total: 0, confirmed: 0, indexed: 128 })}>Index fixture</Button>
		<Button onClick={() => { setStatus('running'); setProgress({ stage: 'scanning', total: 0, confirmed: 0, indexed: 3653988, indexTotal: 3653988,
			preparation: { phase: 'cloud', completed: 1000000, total: 3653988 } }); }}>Prepare fixture</Button>
		<Button onClick={() => setProgress({ stage: 'transferring', total: rows.length, confirmed: 4, path: rows.find(r => r.entry.size === 990)!.entry.path, bytes: 495, size: 990 })}>Transfer fixture</Button>
		{(['upload', 'download'] as const).map(direction => <Button key={direction} onClick={() => { setStatus('running'); setProgress({ stage: 'transferring', direction, indexState: 'indexing', indexed: rows.length,
			total: rows.length, confirmed: 4, path: rows.find(r => r.entry.size === 990)!.entry.path, bytes: 495, size: 990 }); }}>Stream {direction} fixture</Button>)}
		<Button onClick={() => { setStatus('running'); setProgress({ stage: 'transferring', direction: 'upload', indexState: 'watching', indexed: rows.length, total: rows.length, confirmed: rows.length }); }}>Watch fixture</Button>
		<Button onClick={() => { setStatus('running'); setProgress({ stage: 'transferring', direction: 'download', indexState: 'complete', totalFinal: false, indexed: rows.length, total: 4, confirmed: 3 }); }}>Indexed backlog fixture</Button>
		<Button onClick={() => { for (const row of rows) row.operation!.confirmed = true; setStatus('complete'); setProgress({ stage: 'complete', total: rows.length, confirmed: rows.length }); }}>Complete fixture</Button>
		<SyncProgressViewer scopeKey="synthetic-progress" source={progress.stage === 'scanning' ? undefined : source} currentScope={() => {
			if (!mounted.current) throw Error('The account or storage destination changed.');
			return scope;
		}} uploadPriorities={{ scope, excludedPaths: ['Private'], ignoreRules: 'node_modules/' }} progress={progress} status={status} />
	</Box></ChakraProvider>;
}
const router = createMemoryRouter([{ id: 'root', path: '*', element: <Fixture /> }], { hydrationData: { loaderData: { root: { user: { id: scope.ownerId, username: 'synthetic-progress' }, dataPlane: 'home' } } } });
createRoot(document.getElementById('root')!).render(<React.StrictMode><RouterProvider router={router} /></React.StrictMode>);
Object.assign(window, { progressFixture: { total: rows.length, layout: () => Object.values(JSON.parse(localStorage.getItem(layoutKey) || '{}')).find((page: any) => JSON.stringify(page.crystal.blocks).includes('sync-progress-title')) } });
