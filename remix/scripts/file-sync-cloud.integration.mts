// Opt-in real byte transport + durable executor acceptance; loopback fixtures only.
import assert from 'node:assert/strict';
import { readFile, stat, open, rename, rm } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { createSyncRun, executeSyncRun, type SyncRun } from '../app/fileSync/execute';
import { cloudFileSyncEntry, type CloudFile } from '../app/fileSync/cloudFile';
import { prepareCloudSyncRun, prepareCloudInventoryRun, parseCloudSyncRun } from '../app/fileSync/cloudWrite';
import { createCloudSyncPort } from '../app/fileSync/cloudSyncPort.client';
import { fingerprintSource, type FingerprintSource } from '../app/fileSync/contentFingerprint';
import { capabilitySatisfies } from '../app/api/utils/capabilities/capabilityContract';
import type { CloudTransportRuntime } from '../app/fileSync/cloudTransport';
import { parseCloudInventory } from '../app/fileSync/cloudInventory';
import type { SyncEntry, SyncScope } from '../app/fileSync/reconcile';
const path = process.argv[2];
if (!path || ((await stat(path)).mode & 0o077)) throw Error('Pass a private mode-0600 fixture');
const fixture = JSON.parse(await readFile(path, 'utf8')), base = new URL(fixture.base);
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname) || base.origin !== fixture.base || base.username || base.password) throw Error('Use a canonical loopback origin');
const cookies = new Map<string, string>();
const sessionFetch: typeof fetch = async (url, init = {}) => {
 const target = new URL(String(url), base), headers = new Headers(init.headers);
 if (target.origin === base.origin && init.credentials !== 'omit') { headers.set('Cookie', [...cookies].map(([k,v]) => `${k}=${v}`).join('; ')); headers.set('Origin', base.origin); }
 const response = await fetch(target, { ...init, headers, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(30_000) });
 if (target.origin === base.origin && init.credentials !== 'omit') for (const header of response.headers.getSetCookie()) { const pair = header.split(';')[0], i = pair.indexOf('='); cookies.set(pair.slice(0,i), pair.slice(i+1)); }
 return response;
};
async function api(route: string, body?: unknown) {
 const response = await sessionFetch(new URL(route, base), { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) });
 assert.equal(response.status, 200, `${route.split('?')[0]} HTTP status`); const value = await response.json(); assert.notEqual(value.ok, false); return value;
}
const journalPath = `/tmp/thingtime-sync-run-${randomUUID()}.json`;
const scope: SyncScope = { origin: base.origin, ownerId: fixture.userId, dataPlane: 'home', rootId: randomUUID(), deviceId: 'local-cloud-acceptance' };
let dropPart = true, dropCommit = true, dropFolder = true, rootId: string | null = null, nestedIds: string[] = [], puts = 0, opens = 0, succeeded = false, fileId: string | null = null, current: CloudFile | null = null;
const runtime: CloudTransportRuntime = { currentScope: () => scope, origin: () => base.origin,
 requireCapability: async (feature, version) => { const manifest = await api('/.well-known/thingtime-capabilities.json'); assert.equal(manifest.origin, base.origin); assert.ok(capabilitySatisfies(manifest.features[feature]?.version, version), feature); },
 fetch: async (url: any, init: any) => {
  if (init.method === 'PUT') { puts++; if (dropPart && puts === 2) { dropPart = false; throw Error('Simulated interruption before second part'); } }
  const response = await sessionFetch(url, init);
  if (new URL(String(url)).pathname === '/api/v1/files' && init.method === 'POST' && response.ok) {
   const body=JSON.parse(init.body);
   if(body.kind === 'folder' && dropFolder) { dropFolder=false;await response.body?.cancel();throw Error('Simulated lost accepted folder create'); }
   if(body.kind !== 'folder' && dropCommit) { dropCommit=false;await response.body?.cancel();throw Error('Simulated lost accepted file commit'); }
  }
  return response;
 } };
const persist = async (run: SyncRun) => {
 // Sync the file and directory around rename; unit tests also exercise IDB.
 const file = await open(journalPath + '.tmp', 'w', 0o600);
 try { await file.writeFile(JSON.stringify(parseCloudSyncRun(run))); await file.sync(); } finally { await file.close(); }
 await rename(journalPath + '.tmp', journalPath);
 const directory = await open('/tmp', 'r'); try { await directory.sync(); } finally { await directory.close(); }
};
const reload = async () => parseCloudSyncRun(JSON.parse(await readFile(journalPath, 'utf8')));
const source = (bytes: Uint8Array<ArrayBuffer>): FingerprintSource => ({ size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length), check: () => {} });
const makeEntry = async (bytes: Uint8Array<ArrayBuffer>, version: string): Promise<SyncEntry> => ({ path: 'Documents/Nested/cloud-transport-fixture.bin', id: 'local-fixture', version, kind: 'file', size: bytes.length, sha256: null, fingerprint: await fingerprintSource(source(bytes)) });
const localFolders: SyncEntry[] = ['Documents','Documents/Nested'].map(path=>({path,id:'local-'+path,version:'v1',kind:'folder',size:0,sha256:null}));
const port = (run: SyncRun, entry: SyncEntry | null, bytes?: Uint8Array<ArrayBuffer>) => createCloudSyncPort(run, { currentScope: () => scope, persist, readLocal: async path => localFolders.find(folder=>folder.path===path) ?? entry,
 openSource: async expected => { assert.deepEqual(expected, entry); assert.ok(bytes); opens++; return source(bytes); } }, runtime);
await api('/api/v1/login', { username: fixture.username, password: fixture.password });
try {
 assert.equal((await api('/api/v1/auth/me')).user.id, fixture.userId);
 const firstBytes = new Uint8Array(8 * 1024 * 1024 + 17).fill(13), first = await makeEntry(firstBytes, 'first');
 rootId=(await api('/api/v1/things',{thingtime:['folder'],crystal:{name:'Sync acceptance '+randomUUID()}})).thing.id;
 const inventory=parseCloudInventory((await api(`/api/v1/files?rootId=${rootId}`)).inventory,rootId!);
 let run=prepareCloudInventoryRun(createSyncRun({scope,decisions:[...localFolders,first].map(source=>({kind:'copy',from:'local',path:source.path,source,expectedTarget:null}))}),inventory);
 fileId=run.operations.find(op=>op.mutation.kind==='copy'&&op.mutation.source.kind==='file')!.id;
 nestedIds=run.operations.filter(op=>op.mutation.kind==='copy'&&op.mutation.source.kind==='folder').map(op=>op.id);
 await assert.rejects(executeSyncRun(run,port(run,first,firstBytes)),/lost accepted folder create/);
 run=await reload();assert.equal((await api(`/api/v1/files?rootId=${rootId}`)).inventory.nodes.length,1);
 await assert.rejects(executeSyncRun(run, port(run, first, firstBytes)), /before second part/);
 run = await reload(); await assert.rejects(executeSyncRun(run, port(run, first, firstBytes)), /lost accepted file commit/);
 run = await reload(); const counts = { puts, opens };
 const recovered = await executeSyncRun(run, port(run, first, firstBytes)); assert.ok(recovered.operations.every(op => op.confirmed)); assert.deepEqual({ puts, opens }, counts);
 current = (await api(`/api/v1/files?id=${fileId}`)).file; const firstContent = current!.content;
 const secondBytes = new Uint8Array(257).fill(29), second = await makeEntry(secondBytes, 'second');
 run = prepareCloudSyncRun(createSyncRun({ scope, decisions: [{ kind: 'copy', from: 'local', path: second.path, source: second, expectedTarget: cloudFileSyncEntry(current, second.path) }] }), [{ folderId: current!.folderId, before: current }]);
 await executeSyncRun(run, port(run, second, secondBytes)); current = (await api(`/api/v1/files?id=${fileId}`)).file;
 assert.equal(current!.id, fileId); assert.notEqual(current!.content.attachmentId, firstContent.attachmentId);
 for (const [content, expected] of [[firstContent, firstBytes], [current!.content, secondBytes]] as const) {
  const response = await sessionFetch(new URL(`/api/v1/attachments/content?id=${content.attachmentId}&cache=bytes`, base)); assert.equal(response.status, 200);
  assert.equal(createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex'), createHash('sha256').update(expected).digest('hex'));
 }
 const mismatch = await sessionFetch(new URL(`/api/v1/files?id=${fileId}`, base), { headers: { 'X-Thingtime-Expected-Actor': 'another-account' } }); assert.equal(mismatch.status,409); await mismatch.body?.cancel();
 const wrongPlane = await sessionFetch(new URL(`/api/v1/files?id=${fileId}`, base), { headers: { 'X-Thingtime-Expected-Data-Plane': 'custom-'+'0'.repeat(64) } }); assert.equal(wrongPlane.status,409); await wrongPlane.body?.cancel();
 const complete=parseCloudInventory((await api(`/api/v1/files?rootId=${rootId}`)).inventory,rootId!);
 assert.deepEqual(complete.nodes.map(node=>node.path).sort(),['Documents','Documents/Nested',second.path]);
 assert.deepEqual(complete.nodes.filter(node=>node.kind==='folder').map(node=>node.id).sort(),[...nestedIds].sort());
 for(const id of nestedIds) {
  const created=await api(`/api/v1/files?folderId=${id}&operationId=${id}`);assert.equal(created.receipt.id,id);
 }
 succeeded = true;
 console.log('PASS: complete inventory prepares nested parent identities; real folder creation reply loss and disk reload preserve one tree; nested byte publication; real multipart interruption/resume; disk-restored executor; lost accepted commit recovered without source access or uploads; stable replacement; independent hashes of both retained versions; server account/database fences.');
} finally {
 try {
  if (succeeded && fileId) {
   current = (await api(`/api/v1/files?id=${fileId}`)).file;
   if (!current!.trashed) {
    const expected = cloudFileSyncEntry(current, current!.name);
    const cleanup = prepareCloudSyncRun(createSyncRun({ scope, decisions: [{ kind: 'trash', path: expected.path, side: 'remote', expected }] }), [{ folderId: current!.folderId, before: current }]);
    dropCommit = false; await executeSyncRun(cleanup, port(cleanup, null));
   }
   // Normal folder deletion reparents the retained Trash file; it does not
   // discard byte versions or bypass accounting/history.
   for(const id of [...nestedIds].reverse().concat(rootId ? [rootId] : [])) {
    const deleted=await sessionFetch(new URL('/api/v1/things?id='+id,base),{method:'DELETE'});assert.equal(deleted.status,200);await deleted.body?.cancel();
    if(nestedIds.includes(id)) assert.equal((await api(`/api/v1/files?folderId=${id}&operationId=${id}`)).receipt.id,id);
   }
   console.log('Fixture retained privately in Trash; created folders removed through normal API and original receipts still readable:', fileId);
  } else console.log('Interrupted fixture run retained for inspection:', journalPath);
 } finally { await api('/api/v1/auth/accounts/remove', { userId: fixture.userId }); }
}
await rm(journalPath, { force: true });
