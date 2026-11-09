import { CurrentPageBuilderFixture } from './lib/CurrentPageBuilderFixture';
/** Task-owned browser entry. Default mode is explicitly synthetic; the real
 * HTTP mode uses production hooks, authenticated handlers and account-saved
 * Builder documents against the disposable fixture origin only. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ChakraProvider, Box } from '@chakra-ui/react';
import { ThingtimeProvider } from '../app/Providers/ThingtimeProvider';
import { BackupWorkspace } from '../app/components/Devices/BackupWorkspace';
import type { BackupWorkspaceAdapter, BackupJob, BackupRestoreReview } from '../app/components/Devices/backupWorkspaceModel';
import { RemoteDeviceSync } from '../app/components/Devices/RemoteDeviceSync';
import { useCurrentUser } from '../app/hooks/useCurrentUser';
import { rootIdentity } from '../app/utils/rootIdentity';
let workerState: 'available' | 'unverified' | 'unavailable' = 'unverified';
let failed = false, jobs: BackupJob[] = [];
const snapshot = { id: 'snapshot', name: 'Documents · synthetic snapshot', createdAt: '6 November 2026', integrity: 'verified' as const, coverage: 'partial' as const, description: 'Selected folder capture with unsupported account settings excluded.' };
let review = null as BackupRestoreReview | null;
const makeJob = (id: string, kind: BackupJob['kind'], status: BackupJob['status']): BackupJob => ({ id, kind, status, progress: { phase: kind === 'snapshot' ? 'capture' : kind, items: 1, bytes: '1024' }, createdAt: '2026-11-06T00:00:00Z', updatedAt: '2026-11-06T00:00:00Z', issue: null });
const adapter: BackupWorkspaceAdapter = {
 async catalog() { if (failed) { failed = false; throw Error('Storage temporarily unavailable. Refresh to retry.'); } return { snapshots: { items: [snapshot], nextCursor: null }, jobs: { items: jobs, nextCursor: null }, destinations: [{ id: 'storage', label: 'Independent backup storage', provider: 'aws-s3-oidc', state: 'configured-unverified' }], storage: { available: true }, worker: workerState === 'available' ? { available: true } : { available: false, reason: workerState === 'unverified' ? 'worker-unverified' : 'worker-unavailable' }, coverageNote: 'Selected content only. Account settings and security data are not covered.' }; },
 async browse() { return { items: [{ id: 'file', name: 'Saved file', path: 'Documents / Research / A long nested saved file name.txt', kind: 'file', bytes: 1024, versions: 3, selectable: true, reason: null }, { id: 'folder', name: 'Projects', path: 'Documents / Projects', kind: 'folder', bytes: null, versions: null, selectable: true, reason: null }, { id: 'settings', name: 'Security', path: 'Account / Security settings', kind: 'unsupported', bytes: null, versions: null, selectable: false, reason: 'Account security restoration is not supported.' }], nextCursor: null }; },
 async destination() { return { id: 'destination', revision: 'timeline-head-1', name: 'Recovered', path: 'Things / Recovered' }; },
 async job(id) { const saved = jobs.find(item => item.id === id); if (!saved) throw Error('Job absent'); return saved; },
 async review() { if (!review) throw Error('Review not ready'); return review; },
 async command(command) {
  let job: BackupJob;
  if (command.action === 'review') {
   review = { ...command.selection, destination: { ...command.selection.destination, name: 'Recovered', path: 'Things / Recovered' }, id: 'review', hash: 'synthetic-review-hash', summary: 'One selected graph', coverage: 'Selected ordinary folders and file versions only.', history: '3 exact saved versions retained.', limitations: ['Whole-account restore is unsupported.', 'Skipped source observations are not saved.'], executable: true };
   job = makeJob('review-job', 'review', 'completed');
  } else if (command.action === 'restore') job = makeJob('restore-job', 'restore', 'running');
  else if (command.action === 'snapshot') { workerState = 'available'; job = makeJob('snapshot-job', 'snapshot', 'completed'); }
  else { const found = jobs.find(item => item.id === command.jobId); if (!found) throw Error('Job absent'); job = { ...found, status: command.action === 'pause' ? 'paused' : command.action === 'cancel' ? 'cancelled' : 'running' }; }
  jobs = [job, ...jobs.filter(item => item.id !== job.id)]; return job;
 }
};
const transport = { origin: location.origin, currentOrigin: () => location.origin, fetch: (async (input: RequestInfo | URL) => {
 const url = new URL(String(input));
 if (url.pathname === '/.well-known/thingtime-capabilities.json') return Response.json({ schemaVersion: 1, origin: location.origin, features: { 'api.webpages-resolve': { version: '1.6.0' }, 'api.actions-run': { version: '1.7.0' }, 'api.mongodb-endpoint': { version: '1.1.0' } } });
 return Response.json({ ok: false }, { status: 404 });
}) as typeof fetch };
Object.assign(window, { backupFixture: { workerUnavailable() { workerState = 'unavailable'; }, workerUnverified() { workerState = 'unverified'; }, workerAvailable() { workerState = 'available'; }, failNext() { failed = true; }, changeIdentity() { rootIdentity.changed(); } } });
const realMode = new URL(location.href).searchParams.get('acceptance') === 'real';
function RealWorkspace() {
 const user = useCurrentUser();
 const ownerId = user?.id || 'unavailable';
 const deviceId = new URL(location.href).searchParams.get('device');
 if (!deviceId) throw Error('The isolated paired device is missing.');
 return <ThingtimeProvider key={ownerId} accountId={ownerId} storageKey={`thingtime:account:${ownerId}`}><RemoteDeviceSync ownerId={ownerId} deviceId={deviceId} active={false} showResourceSummary={false} /></ThingtimeProvider>;
}
const router = createMemoryRouter([{ id: 'root', path: '*', loader: realMode ? async () => {
 const response = await fetch('/api/v1/auth/me', { credentials: 'include', cache: 'no-store' });
 const result = await response.json();
 if (!response.ok || !result.user?.id || result.user.accountKind !== 'user') throw Error('The isolated test account is not authenticated.');
 return { user: result.user, dataPlane: 'home' };
} : () => ({ user: { id: 'synthetic-owner', accountKind: 'user' }, dataPlane: 'home' }), element: <CurrentPageBuilderFixture><ChakraProvider><Box maxW="880px" mx="auto" p={4}>{realMode ? <RealWorkspace /> : <BackupWorkspace scope={{ ownerId: 'synthetic-owner', apiOrigin: location.origin, dataPlane: 'home', identity: 'fixture' }} adapter={adapter} renderDestinationPicker={({ onLocationChange }) => <button type="button" onClick={() => onLocationChange('destination', 'Recovered')}>Recovered</button>} accountTransport={transport} />}</Box></ChakraProvider></CurrentPageBuilderFixture> }], { initialEntries: [location.pathname + location.search] });
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
