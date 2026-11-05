// Non-shipping adapters around the same host factories used by the Mac worker.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createDesktopFolderHost } from '../app/fileSync/desktopFolders.client';
import { supportsNativeAuthorizationContext, supportsNativePartUploads, supportsNativeCloudStaging } from '../app/fileSync/mobileFolders.client';
const require = createRequire(import.meta.url);
// Observe the canonical worker call; retain its implementation, real clock,
// byte governor, cancellation and global fetch identity unchanged.
const transfer = require('../../electron/lib/folder-transfer-process.cjs');
const digestObservers = new Set<(row: Record<string, unknown>) => void>();
const canonicalHash = transfer.governedHash;
transfer.governedHash = async (...args: unknown[]) => {
 const at = performance.now();
 try { return await canonicalHash(...args); }
 finally {
  const row = { phase: 'digest-worker', at, elapsedMs: performance.now() - at };
  for (const observe of digestObservers) { try { observe(row); } catch { /* Observation cannot change the hash result. */ } }
 }
};
const { DesktopFolderSync } = require('../../electron/lib/folder-sync.cjs');

export async function createMacFixtureHost(input: {
 origin: string; ownerId: string; deviceId: string; signal: AbortSignal; fetch: typeof fetch;
 sendNative(payload: any, signal?: AbortSignal): Promise<any>; cancelNative(id: string): void;
 resourcePolicy: NonNullable<Parameters<typeof createDesktopFolderHost>[0]['resourcePolicy']>;
 diagnostic(row: Record<string, unknown>): void;
}) {
 const removeDigestObserver = () => { digestObservers.delete(input.diagnostic); };
 digestObservers.add(input.diagnostic);
 input.signal.addEventListener('abort', removeDigestObserver, { once: true });
 try {
 const mainFrame = { url: input.origin };
 // Only renderer/IPC surfaces are synthetic. Account/capability/consent checks,
 // native operations, transfer workers and HTTP use their canonical paths.
 const window = { isDestroyed: () => false, webContents: { mainFrame, session: { fetch: input.fetch } } };
 const event = { sender: window.webContents, senderFrame: mainFrame };
 const wireIds = new Map<string, string>();
 const manager = new DesktopFolderSync({
  context: () => ({ enabled: true, window, appOrigin: input.origin, apiOrigin: input.origin }),
  fetchUpload: globalThis.fetch, diagnostic: input.diagnostic,
  requestNative: async (method: string, payload: any, options: any = {}) => {
   if (method !== 'folder-sync.request') throw Error('Unexpected native fixture method');
   if (payload.action === 'suspend') { const id = wireIds.get(payload.requestId); if (id) input.cancelNative(id); return; }
   // One host operation may issue several native requests under its outer ID.
   const id = randomUUID(); wireIds.set(payload.requestId, id);
   try {
    const result = await input.sendNative({ ...payload, requestId: id, ...(options.bytes ? { bytes: options.bytes } : {}) }, options.signal);
    if (payload.action === 'context' && JSON.stringify(Object.keys(result.capabilities ?? {})) !== JSON.stringify(Object.keys(result.capabilities ?? {}).sort()))
     throw Error('Fixture context framing must match sorted canonical NodeWireCodec output');
    return { ...result, requestId: payload.requestId };
   } finally { if (wireIds.get(payload.requestId) === id) wireIds.delete(payload.requestId); }
  }
 });
 const bridge = { folderSyncRequest: (payload: any) => manager.request(event, payload) };
 const host = await createDesktopFolderHost({ ownerId: input.ownerId, deviceId: input.deviceId, bridge,
  signal: input.signal, rendererOrigin: () => input.origin, assertCurrent: () => input.signal.throwIfAborted(),
  fetch: input.fetch, resourcePolicy: input.resourcePolicy });
 if (!supportsNativeAuthorizationContext(host.capabilities) || !host.authorizeContext ||
     !supportsNativePartUploads(host.capabilities) || !supportsNativeCloudStaging(host.capabilities))
  throw Error('The real fixture host is missing native context, upload or download support');
 return host;
 } catch (error) {
  removeDigestObserver(); input.signal.removeEventListener('abort', removeDigestObserver); throw error;
 }
}

export function macFixtureWorkerOptions(host: Awaited<ReturnType<typeof createMacFixtureHost>>, ownerId: string, deviceId: string, signal: AbortSignal) {
 if (!supportsNativeAuthorizationContext(host.capabilities) || !host.authorizeContext) throw Error('Missing authenticated native context');
 return {
  nativeOperationGuards: true as const,
  authorizeContext: async () => (await host.authorizeContext!(ownerId, deviceId, signal)).conditions,
  ...(host.uploadBatch ? { uploadBatch: host.uploadBatch } : {}),
  ...(host.folderBatch ? { folderBatch: host.folderBatch } : {})
 };
}
export function macFixtureRuntime(host: Awaited<ReturnType<typeof createMacFixtureHost>>, scope: any) {
 // Deliberately no custom mutation callback: the canonical context composes it.
 return { currentScope: () => scope, origin: host.origin, fetch: host.fetch, requireCapability: host.requireCapability };
}
