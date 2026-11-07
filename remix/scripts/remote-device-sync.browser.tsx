import { rootIdentity } from '../app/utils/rootIdentity';
import { deviceFolderIdentity, resolveDeviceFolders } from '../app/fileSync/deviceFolders';
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Box, ChakraProvider } from '@chakra-ui/react';
import { SyncFolderCard } from '../app/components/Devices/SyncFolderCard';
import { MobileSyncConnections } from '../app/components/Devices/MobileSyncConnections';
import { requireThingtimeCapability } from '../app/api/utils/capabilities/requireCapability.client';
import { DeviceSyncPanel } from '../app/components/Devices/DeviceSyncBrowser';
import { apiEndpointDocs } from '../app/docs/apiDocs';
import type { RemoteSyncStatus } from '../app/fileSync/remoteSyncProtocol';

// Browser fixture uses the canonical registry, without importing server gateway runtime.
const fixtureCapabilities = (origin: string) => ({ schemaVersion: 1, origin, features: Object.fromEntries(apiEndpointDocs.map(doc => [`api.${doc.id}`, { version: doc.featureVersion ?? '1.0.0' }])) });

// This fixture has no native bridge, credentials, file access or real backend.
// Every application fetch is handled here; unknown requests fail closed.
const params = new URLSearchParams(location.search);
const ownerId = params.get('owner') || 'remote-sync-owner', deviceId = params.get('device') || 'remote-sync-mac';
const databaseKey = 'remote-sync-fixture-rows' + (params.size ? ':' + JSON.stringify([ownerId, deviceId]) : '');
const configuration = { configurationVersion: 1, name: 'Documents backup', deviceId, localRootId: 'local-documents',
 remoteFolderId: 'cloud-documents', mode: 'backup', paused: params.has('paused'), propagateDeletes: false, network: 'any', chargingOnly: false, excludedPaths: [] };
let rows: any[] = JSON.parse(localStorage.getItem(databaseKey) || 'null') ?? [
 { id: 'cloud-documents', thingtime: ['folder'], author: { id: ownerId }, acl: ['tt:user'], crystal: { name: 'Cloud documents' } },
 ...Array.from({ length: 15 }, (_, index) => ({ id: `fixture-folder-${index}`, thingtime: ['folder'], author: { id: ownerId }, acl: ['tt:user'], crystal: { name: `Folder ${String(index).padStart(2, '0')}` } })),
 { id: 'documents-sync', thingtime: ['file-sync'], author: { id: ownerId }, acl: ['tt:user'], updatedAt: '2026-10-23T00:00:00.000Z', crystal: configuration },
 { id: 'archive-sync', thingtime: ['file-sync'], author: { id: ownerId }, acl: ['tt:user'], updatedAt: '2026-10-23T00:00:00.000Z', crystal: { ...configuration, name: 'Archive backup' } },
 ...(params.has('paused') ? [{ id: 'home-sync', thingtime: ['file-sync'], author: { id: ownerId }, acl: ['tt:user'], updatedAt: '2026-10-23T00:00:00.000Z', crystal: { ...configuration, name: 'Home backup', paused: true } }] : []),
 { id: 'other-device-sync', thingtime: ['file-sync'], author: { id: ownerId }, acl: ['tt:user'], updatedAt: '2026-10-23T00:00:00.000Z', crystal: { ...configuration, name: 'Other device private sync', deviceId: 'another-device' } },
 { id: 'other-owner-sync', thingtime: ['file-sync'], author: { id: 'another-owner' }, acl: ['tt:user'], updatedAt: '2026-10-23T00:00:00.000Z', crystal: { ...configuration, name: 'Other owner private sync' } }
];
const initialStatus = (): RemoteSyncStatus => ({ version: 1, deviceId, observedAt: new Date().toISOString(),
 roots: [{ id: 'local-documents', name: 'Documents on Mac', sourcePath: '/Users/example/Documents on Mac' }], rootsReady: true, capabilities: { platform: 'macos', fileAccessVersion: '1.16.0', fileResourceLimitsVersion: '1.1.0', fileTrashVersion: '1.2.0', fileVersionsVersion: '1.0.0', fileStagingVersion: '1.0.0', filePublicationVersion: '1.2.0' }, jobs: [], task: null, resourceUsage: { deviceResourceLimits: { transferBytesPerSecond: 625000, scanBytesPerSecond: 625000, cpuPercent: 15 }, resources: { version: 1, cpuPercent: 3, cpuStatus: 'measured', effectiveTransferConcurrency: 1, effectiveIndexingConcurrency: 1, currentUploadBytesPerSecond: 1000, currentDownloadBytesPerSecond: 2000, scanBytesPerSecond: 3000, memoryBytes: 1048576, measuredAt: Date.now() } } });
let status = initialStatus(), offline = true, failure: string | null = null, writes = 0, holdNextStart = false;
let priorities = { revision: 0, paths: [] as string[] };
let resumeFault: string | null = null; const resumeWrites: any[] = [];
const commands: any[] = [], replies = new Map<string, any>();
const heldStarts = new Set<string>();
const snapshot = () => ({ ...structuredClone(status), observedAt: new Date().toISOString() });
const json = (data: unknown, status = 200) => Response.json(data, { status });
Object.assign(window, { remoteSyncFixture: {
 failResume(value: string) { resumeFault = value; },
 setOnline(value: boolean) { offline = !value; },
 failNext(value: string) { failure = value; },
 holdStartAcknowledgement() { holdNextStart = true; },
 releaseStartAcknowledgements() { for (const requestId of heldStarts) replies.set(requestId, { ok: true, status: 'complete', result: { accepted: true } }); heldStarts.clear(); },
 changeElsewhere() { const row = rows.find(r => r.id === 'documents-sync'); row.updatedAt = new Date().toISOString(); row.crystal.name = 'Changed on another browser'; },
 state: () => structuredClone({ rows, status, commands, writes, priorities, resumeWrites, identityPending: rootIdentity.read().pending, pendingStartRequests: [...heldStarts].filter(requestId => replies.get(requestId)?.status === 'processing') }),
 reset() { localStorage.clear(); },
} });
window.fetch = async (input, init) => {
 init?.signal?.throwIfAborted();
 const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.origin);
 if (url.origin !== location.origin) throw Error('Fixture rejected external network');
 if (url.pathname === '/.well-known/thingtime-capabilities.json') return json(fixtureCapabilities(url.origin));
 if (url.pathname === '/api/v1/webpages/resolve') return json({ ok: false }, 404);
 if (url.pathname === '/api/v1/devices') return json({ ok: true, devices: [{ id: deviceId, name: 'My Mac', platform: 'macos', pairingStatus: 'paired' }] });
 const headers = new Headers(init?.headers);
 if (headers.get('X-Thingtime-Expected-Actor') !== ownerId || headers.get('X-Thingtime-Expected-Data-Plane') !== 'home')
  return json({ ok: false, error: 'Fixture scope headers missing' }, 409);
 if (url.pathname === '/api/v1/devices/folders') {
  const scope = { origin: location.origin, ownerId, dataPlane: 'home', deviceId };
  const rootFolderId = await deviceFolderIdentity(scope, 'root');
  if ((init?.method || 'GET') === 'GET') {
   if (!url.searchParams.get('deviceId')) return json(url.searchParams.get('cursor') ? { ok: true, devices: [{ deviceId: 'other-owned-device', rootFolderId: 'other-owned-root', name: 'Travel tablet' }], nextCursor: null } : { ok: true, devices: [{ deviceId, rootFolderId, name: 'My Mac' }], nextCursor: 'fixture-device-page-2' });
   return json({ ok: true, rootFolderId, deviceName: 'My Mac', folder: rows.find(row => row.id === rootFolderId) || null });
  }
  const body = JSON.parse(String(init?.body));
  const resolved = await resolveDeviceFolders(scope, 'My Mac', body, {
   assertCurrent() { init?.signal?.throwIfAborted(); },
   async get(id) { const row = rows.find(row => row.id === id); if (!row) throw Object.assign(Error('Not found'), { status: 404 }); return row; },
   async create(input) { if (rows.some(row => row.id === input.shareId)) throw Object.assign(Error('Conflict'), { status: 409 }); rows.push({ ...input, id: input.shareId, author: { id: ownerId } }); writes++; localStorage.setItem(databaseKey, JSON.stringify(rows)); }
  });
  return json({ ok: true, ...resolved });
 }
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
   if (command.action === 'resources') {
    if (command.operation === 'save') status.resourceUsage = { ...status.resourceUsage!, deviceResourceLimits: command.deviceResourceLimits };
   } else if (command.action === 'start') {
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
   reply = { ok: true, status: 'complete', result: command.action === 'resources' ? status.resourceUsage : command.action === 'folders' ? { roots: status.roots } : command.action === 'status' ? snapshot() :
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
  if (id) { if (resumeFault === 'identity' && id === 'documents-sync') { resumeFault = null; rootIdentity.changed(); } const thing = rows.find(row => row.id === id); return json(thing ? { ok: true, thing } : { ok: false, error: 'Not found' }, thing ? 200 : 404); }
  return json({ ok: true, things: rows.filter(row => row.thingtime.includes(url.searchParams.get('thingtime'))), nextCursor: null });
 }
 const body = JSON.parse(String(init?.body));
 if (method === 'PATCH') {
  const row = rows.find(row => row.id === body.id);
  if (!row || row.updatedAt !== body.expectedUpdatedAt) return json({ ok: false, error: 'Stale revision' }, 409);
  const resuming = row.crystal.paused === true && body.crystal.paused === false;
  if (resuming) { resumeWrites.push({ id: row.id, expectedUpdatedAt: body.expectedUpdatedAt }); if (resumeFault === 'cas') { resumeFault = null; return json({ ok: false, error: 'Stale resume revision' }, 409); } }
  row.crystal = body.replaceCrystal ? body.crystal : { ...row.crystal, ...body.crystal }; row.updatedAt = new Date().toISOString(); writes++;
  if (resuming && resumeFault === 'uncertain') { resumeFault = null; localStorage.setItem(databaseKey, JSON.stringify(rows)); return json({ ok: false, error: 'Resume reply interrupted' }, 503); }
 } else if (method === 'POST') {
  rows.push({ id: body.shareId, thingtime: body.thingtime, crystal: body.crystal, ...(body.folderId !== undefined ? { folderId: body.folderId } : {}), author: { id: ownerId }, acl: body.acl, updatedAt: new Date().toISOString() }); writes++;
 } else throw Error('Unexpected fixture write');
 localStorage.setItem(databaseKey, JSON.stringify(rows));
 return json({ ok: true, thing: rows.find(row => row.id === (body.id || body.shareId)) });
};
const nativeFixtureHost = {
 origin: () => location.origin, capabilities: initialStatus().capabilities,
 request: async (_owner: string, request: any) => { if (request.action !== 'list') throw Error('Unexpected native fixture action'); return { roots: initialStatus().roots }; },
 authorizeDevice: async (owner: string, device: string, signal: AbortSignal) => { signal.throwIfAborted(); if (owner !== ownerId || device !== deviceId) throw Error('Wrong native fixture identity'); },
 fetch: window.fetch.bind(window), requireCapability: requireThingtimeCapability, assertCurrent() {}
};
const router = createMemoryRouter([{ id: 'root', path: '/', loader: () => ({ user: { id: ownerId, accountKind: 'user' }, dataPlane: 'home' }),
 element: <ChakraProvider><Box maxW="1000px" mx="auto" p={4}>{params.has('native') ? <MobileSyncConnections ownerId={ownerId} deviceId={deviceId} roots={initialStatus().roots} host={nativeFixtureHost} /> : <DeviceSyncPanel ownerId={ownerId} deviceId={deviceId} pairedDeviceIds={[]} ownedDeviceIds={[deviceId]} />}<SyncFolderCard title="Editable folder preview" path="/Sample/Folder" description="Synthetic shared card" stats="No transfer started" scopeKey="fixture-shared-card"><p>Folder details preview</p></SyncFolderCard></Box></ChakraProvider> }]);
createRoot(document.getElementById('root')!).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
