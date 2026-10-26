import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Box, ChakraProvider } from '@chakra-ui/react';
import { SyncFolderCard } from '../app/components/Devices/SyncFolderCard';
import { DeviceSyncPanel } from '../app/components/Devices/DeviceSyncBrowser';
import { thingtimeCapabilityManifest } from '../app/api/utils/capabilities/thingtimeCapabilities';
import type { RemoteSyncStatus } from '../app/fileSync/remoteSyncProtocol';

// This fixture has no native bridge, credentials, file access or real backend.
// Every application fetch is handled here; unknown requests fail closed.
const ownerId = 'remote-sync-owner', deviceId = 'remote-sync-mac';
const configuration = { configurationVersion: 1, name: 'Documents backup', deviceId, localRootId: 'local-documents',
 remoteFolderId: 'cloud-documents', mode: 'backup', paused: false, propagateDeletes: false, network: 'any', chargingOnly: false, excludedPaths: [] };
let rows: any[] = JSON.parse(localStorage.getItem('remote-sync-fixture-rows') || 'null') ?? [
 { id: 'cloud-documents', thingtime: ['folder'], author: { id: ownerId }, acl: ['tt:user'], crystal: { name: 'Cloud documents' } },
 { id: 'documents-sync', thingtime: ['file-sync'], author: { id: ownerId }, acl: ['tt:user'], updatedAt: '2026-10-23T00:00:00.000Z', crystal: configuration },
 { id: 'archive-sync', thingtime: ['file-sync'], author: { id: ownerId }, acl: ['tt:user'], updatedAt: '2026-10-23T00:00:00.000Z', crystal: { ...configuration, name: 'Archive backup' } },
 { id: 'other-device-sync', thingtime: ['file-sync'], author: { id: ownerId }, acl: ['tt:user'], updatedAt: '2026-10-23T00:00:00.000Z', crystal: { ...configuration, name: 'Other device private sync', deviceId: 'another-device' } },
 { id: 'other-owner-sync', thingtime: ['file-sync'], author: { id: 'another-owner' }, acl: ['tt:user'], updatedAt: '2026-10-23T00:00:00.000Z', crystal: { ...configuration, name: 'Other owner private sync' } }
];
const initialStatus = (): RemoteSyncStatus => ({ version: 1, deviceId, observedAt: new Date().toISOString(),
 roots: [{ id: 'local-documents', name: 'Documents on Mac', sourcePath: '/Users/example/Documents on Mac' }], rootsReady: true, capabilities: { platform: 'macos', fileAccessVersion: '1.15.0', fileTrashVersion: '1.2.0', fileVersionsVersion: '1.0.0', fileStagingVersion: '1.0.0', filePublicationVersion: '1.2.0' }, jobs: [], task: null });
let status = initialStatus(), offline = true, failure: string | null = null, writes = 0, holdNextStart = false;
let priorities = { revision: 0, paths: [] as string[] };
const commands: any[] = [], replies = new Map<string, any>();
const heldStarts = new Set<string>();
const snapshot = () => ({ ...structuredClone(status), observedAt: new Date().toISOString() });
const json = (data: unknown, status = 200) => Response.json(data, { status });
Object.assign(window, { remoteSyncFixture: {
 setOnline(value: boolean) { offline = !value; },
 failNext(value: string) { failure = value; },
 holdStartAcknowledgement() { holdNextStart = true; },
 releaseStartAcknowledgements() { for (const requestId of heldStarts) replies.set(requestId, { ok: true, status: 'complete', result: { accepted: true } }); heldStarts.clear(); },
 changeElsewhere() { const row = rows.find(r => r.id === 'documents-sync'); row.updatedAt = new Date().toISOString(); row.crystal.name = 'Changed on another browser'; },
 state: () => structuredClone({ rows, status, commands, writes, priorities, pendingStartRequests: [...heldStarts].filter(requestId => replies.get(requestId)?.status === 'processing') }),
 reset() { localStorage.clear(); },
} });
window.fetch = async (input, init) => {
 init?.signal?.throwIfAborted();
 const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
 if (url.origin !== location.origin) throw Error('Fixture rejected external network');
 if (url.pathname === '/.well-known/thingtime-capabilities.json') return json(thingtimeCapabilityManifest(url.origin));
 if (url.pathname === '/api/v1/webpages/resolve') return json({ ok: false }, 404);
 if (url.pathname === '/api/v1/devices') return json({ ok: true, devices: [{ id: deviceId, name: 'My Mac', platform: 'macos', pairingStatus: 'paired' }] });
 const headers = new Headers(init?.headers);
 if (headers.get('X-Thingtime-Expected-Actor') !== ownerId || headers.get('X-Thingtime-Expected-Data-Plane') !== 'home')
  return json({ ok: false, error: 'Fixture scope headers missing' }, 409);
 if (url.pathname === '/api/v1/devices/sync-control') {
  if ((init?.method || 'GET') === 'GET') return json(replies.get(url.searchParams.get('requestId')!) || { ok: false, error: 'Request missing' }, replies.has(url.searchParams.get('requestId')!) ? 200 : 404);
  const body = JSON.parse(String(init?.body));
  if (body.deviceId !== deviceId || body.action !== 'enqueue') return json({ ok: false, error: 'Wrong device or operation' }, 403);
  const { command, requestId } = body;
  commands.push(structuredClone(command));
  let reply: any;
  if (offline) reply = { ok: true, status: 'error', error: 'This device is offline. Saved settings remain available.' };
  else if (failure) { reply = { ok: true, status: 'error', error: failure }; failure = null; }
  else {
   if (command.action === 'start') {
    const saved = rows.find(r => r.id === command.connectionId);
    if (!saved || saved.crystal.deviceId !== deviceId || saved.updatedAt !== command.expectedUpdatedAt)
     return json({ ok: false, error: 'Saved connection changed. Refresh settings.' }, 409);
    status.jobs = [{ connectionId: saved.id, state: 'runnable', ...(command.intervalMs ? { intervalMs: command.intervalMs } : {}) }];
    status.task = { connectionId: saved.id, active: true, status: 'running', progress: { stage: 'transferring', confirmed: 2, total: 7, bytes: 1024, size: 4096 } };
   } else if (command.action === 'pause') {
    status.jobs = [{ connectionId: command.connectionId, state: 'paused' }];
    if (status.task) status.task = { ...status.task, active: false, status: 'paused' };
   } else if (command.action === 'priorities' && command.operation === 'save') {
    if (command.expectedRevision !== priorities.revision) return json({ ok: false, error: 'Priority revision changed' }, 409);
    priorities = { revision: priorities.revision + 1, paths: command.paths };
   }
   reply = { ok: true, status: 'complete', result: command.action === 'folders' ? { roots: status.roots } : command.action === 'status' ? snapshot() :
    command.action === 'details' ? {} : command.action === 'priorities' ? structuredClone(priorities) : { accepted: true } };
   if (command.action === 'start' && holdNextStart) {
    holdNextStart = false; heldStarts.add(requestId); reply = { ok: true, status: 'processing' };
   }
  }
  replies.set(requestId, reply);
  return json(reply);
 }
 if (url.pathname !== '/api/v1/things') throw Error('Unexpected fixture request: ' + url.pathname);
 const method = init?.method || 'GET';
 if (method === 'GET') {
  const id = url.searchParams.get('id');
  if (id) { const thing = rows.find(row => row.id === id); return json(thing ? { ok: true, thing } : { ok: false, error: 'Not found' }, thing ? 200 : 404); }
  return json({ ok: true, things: rows.filter(row => row.thingtime.includes(url.searchParams.get('thingtime'))), nextCursor: null });
 }
 const body = JSON.parse(String(init?.body));
 if (method === 'PATCH') {
  const row = rows.find(row => row.id === body.id);
  if (!row || row.updatedAt !== body.expectedUpdatedAt) return json({ ok: false, error: 'Stale revision' }, 409);
  row.crystal = body.crystal; row.updatedAt = new Date().toISOString(); writes++;
 } else if (method === 'POST') {
  rows.push({ id: body.shareId, thingtime: body.thingtime, crystal: body.crystal, ...(body.folderId !== undefined ? { folderId: body.folderId } : {}), author: { id: ownerId }, acl: body.acl, updatedAt: new Date().toISOString() }); writes++;
 } else throw Error('Unexpected fixture write');
 localStorage.setItem('remote-sync-fixture-rows', JSON.stringify(rows));
 return json({ ok: true, thing: rows.find(row => row.id === (body.id || body.shareId)) });
};
const router = createMemoryRouter([{ id: 'root', path: '/', loader: () => ({ user: { id: ownerId, accountKind: 'user' }, dataPlane: 'home' }),
 element: <ChakraProvider><Box maxW="1000px" mx="auto" p={4}><DeviceSyncPanel ownerId={ownerId} deviceId={deviceId} pairedDeviceIds={[]} ownedDeviceIds={[deviceId]} /><SyncFolderCard title="Editable folder preview" path="/Sample/Folder" description="Synthetic shared card" stats="No transfer started" scopeKey="fixture-shared-card"><p>Folder details preview</p></SyncFolderCard></Box></ChakraProvider> }]);
createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
