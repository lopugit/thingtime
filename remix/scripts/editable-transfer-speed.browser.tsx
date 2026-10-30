// Synthetic metadata only; the checker enforces an OS-level loopback boundary.
import { readStampedCache, writeStampedCache } from '../app/hooks/localCache';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ChakraProvider, Box, Button, Text } from '@chakra-ui/react';
import { TransferSpeedSeries } from '../app/fileSync/transferSpeed';
import { SyncProgressViewer } from '../app/components/Devices/SyncProgressViewer';
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
const layoutKey = 'speed-fixture-layout', originalFetch = window.fetch.bind(window);
window.fetch = async function(input, init) {
	const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
	if (url.pathname.includes('thingtime-capabilities')) return Response.json(thingtimeCapabilityManifest(location.origin));
	if (url.pathname === '/api/v1/webpages/resolve') {
		const page = JSON.parse(localStorage.getItem(layoutKey + ':' + (url.searchParams.get('id') || '')) || 'null');
		return Response.json(page ? { ok: true, page, source: 'user' } : { ok: false }, { status: page ? 200 : 404 });
	}
	if (url.pathname === '/api/v1/things' && ['POST', 'PATCH'].includes(init?.method || '')) {
        await new Promise(resolve => setTimeout(resolve, 300));
		const input = JSON.parse(String(init?.body)), key = layoutKey + ':' + input.crystal.pageKey, old = JSON.parse(localStorage.getItem(key) || 'null');
		if (old && input.expectedUpdatedAt !== old.updatedAt) return Response.json({ ok: false }, { status: 409 });
		const page = { id: old?.id || input.shareId, crystal: input.crystal, acl: input.acl || old.acl, author: { id: scope.ownerId }, updatedAt: new Date().toISOString() };
		localStorage.setItem(key, JSON.stringify(page)); return Response.json({ ok: true, thing: page });
	}
	if (url.pathname.startsWith('/api/')) return Response.json({ ok: true, things: [], items: [], components: [] });
	return originalFetch(input, init);
};
let clock = 0;
const series = new TransferSpeedSeries({ now: () => clock });
series.observe({ upload: { bytes: 0, files: 0, folders: 0 }, download: { bytes: 0, files: 0, folders: 0 } });
for (let second = 1; second <= 10; second++) { clock = second * 1000; series.observe({ upload: { bytes: second * 125_000, files: second * 2, folders: second }, download: { bytes: second * 250_000, files: second * 4, folders: second * 2 } }); }
function Fixture() {
	const restored = readStampedCache<{ status: SyncProgressState; progress: ForegroundSyncProgress }>('synthetic-priority-progress');
	const [status, setStatus] = useState<SyncProgressState>(restored?.status || 'running');
	const [progress, setProgress] = useState<ForegroundSyncProgress>(restored?.progress || { stage: 'transferring', total: rows.length, confirmed: 4,
		path: rows.find(r => r.entry.size === 990)!.entry.path, bytes: 495, size: 990,
        priorityReadiness: { gate: 'enabled', preferencesCount: 5, preferencesRevision: 3, proofCursor: 0, proofCutoff: 100000, candidateOrdinal: 1, candidateSequence: 80000, blocker: 'proof-pending', measured: true, reserved: false } });
	React.useEffect(() => writeStampedCache('synthetic-priority-progress', { status, progress }), [status, progress]);
	return <ChakraProvider><Box maxW="760px" mx="auto" p={4}>
		<Text as="h1">Editable progress acceptance</Text>
        {(['partial', 'ready', 'reserved', 'unsupported', 'unmeasured', 'not-indexed'] as const).map(state => <Button key={state} onClick={() => setProgress(value => ({ ...value,
            priorityReadiness: { gate: state === 'unsupported' ? 'unsupported' : 'enabled', preferencesCount: 5, preferencesRevision: 3,
                proofCursor: state === 'unsupported' ? null : state === 'partial' ? 4096 : 100000, proofCutoff: state === 'unsupported' ? null : 100000,
                candidateOrdinal: state === 'unsupported' || state === 'unmeasured' ? null : 1,
                candidateSequence: state === 'unsupported' || state === 'unmeasured' || state === 'not-indexed' ? null : 80000,
                blocker: state === 'partial' ? 'proof-pending' : state === 'reserved' ? 'reserved-or-in-flight' : state === 'not-indexed' ? 'not-indexed' : state === 'ready' ? 'ready' : 'none',
                measured: state !== 'unmeasured', reserved: state === 'reserved' }
        }))}>Priority {state}</Button>)}
		<Button onClick={() => {
            const entries = { files: 20, folders: 10 }, download = { bytes: 2_500_000, files: 40, folders: 20 };
            clock = 11000; series.observe({ upload: { bytes: null, ...entries }, download });
            clock = 20000; series.observe({ upload: { bytes: 0, ...entries }, download });
            clock = 21000; series.observe({ upload: { bytes: 125000, ...entries }, download });
            setProgress(value => ({ ...value }));
        }}>Recover byte coverage</Button>
        <Button onClick={() => { series.pause(); setStatus('paused'); }}>Pause fixture</Button>
		<Button onClick={() => setStatus('error')}>Fail fixture</Button>
		<Button onClick={() => setProgress({ stage: 'scanning', total: 0, confirmed: 0, indexed: 128 })}>Index fixture</Button>
		<Button onClick={() => setProgress({ stage: 'transferring', total: rows.length, confirmed: 4, path: rows.find(r => r.entry.size === 990)!.entry.path, bytes: 495, size: 990 })}>Transfer fixture</Button>
		<Button onClick={() => { for (const row of rows) row.operation!.confirmed = true; series.pause(); setStatus('complete'); setProgress({ stage: 'complete', total: rows.length, confirmed: rows.length }); }}>Complete fixture</Button>
		<SyncProgressViewer scopeKey="synthetic-progress" series={series} source={progress.stage === 'scanning' ? undefined : source} currentScope={() => scope} progress={progress} status={status} />
	</Box></ChakraProvider>;
}
const router = createMemoryRouter([{ id: 'root', path: '*', element: <Fixture /> }], { hydrationData: { loaderData: { root: { user: { id: scope.ownerId, username: 'synthetic-progress' }, dataPlane: 'home' } } } });
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
Object.assign(window, { progressFixture: { total: rows.length, layout: (document = 'file-sync-speed-trackers') => JSON.parse(localStorage.getItem(layoutKey + ':settings-' + document) || 'null') } });
