import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverAutomaticPhotos } from './photoAutomationScheduler';
import { FILE_SYNC_PHOTO_AUTOMATION_REQUIREMENTS, newFileSyncConfiguration } from './configuration';
import { getNativeSyncAdapter } from './nativeSyncHost.client';
import { nativeBridgeMessageEvent } from '../utils/nativeBridge';

test('foreground Photos discovery accounts for revoked grants, including a zero-grant library, without prompting', async t => {
 const origin = 'https://startup.test', ownerId = 'owner', deviceId = 'phone';
 const firstRoot = '11111111-1111-4111-8111-111111111111', secondRoot = '22222222-2222-4222-8222-222222222222';
 let grants: string[] = [firstRoot];
 const rows = [['valid', firstRoot], ['revoked', secondRoot], ['paused', secondRoot], ['other-device', secondRoot]].map(([id, root]) => ({
  id, updatedAt: '2026-11-12T00:00:00Z', author: { id: ownerId }, acl: ['tt:user'], thingtime: ['file-sync'], crystal: {
   ...newFileSyncConfiguration({ name: id, deviceId: id === 'other-device' ? 'remote' : deviceId, localRootId: root, remoteFolderId: 'cloud' }),
   sourceKind: 'photos', mode: 'backup', propagateDeletes: false, paused: id === 'paused'
  }
 }));
 const actions: string[] = [];
 const page = Object.assign(new EventTarget(), { location: { origin }, fetch: async (target: string | URL) => {
  const url = new URL(String(target), origin);
  if (url.pathname === '/.well-known/thingtime-capabilities.json') return Response.json({ schemaVersion: 1, origin,
   features: Object.fromEntries(Object.entries(FILE_SYNC_PHOTO_AUTOMATION_REQUIREMENTS).map(([feature, version]) => [feature, { version }])) });
  assert.equal(url.pathname, '/api/v1/things');
  return Response.json({ things: rows, nextCursor: null });
 }, thingtimeNativeBridge: {
  version: '1.0.0', platform: 'ios', isNativeWebView: true, devicePairingVersion: '1.0.0',
  fileAccessVersion: '1.8.0', fileStagingVersion: '1.2.0', filePublicationVersion: '1.2.0', filePhotoAutomationVersion: '1.8.0',
  postMessage(message: { type: string; payload: Record<string, unknown> }) {
   const payload = message.payload; actions.push(String(payload.action));
   queueMicrotask(() => page.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, { detail: {
    type: message.type === 'mobile-device' ? 'mobile-device-result' : 'mobile-files-result', payload: { ...payload,
     ...(message.type === 'mobile-device' ? { state: 'paired', deviceId } : { roots: grants.map(id => ({ id, name: 'Photos', sourceKind: 'photos', photoAccess: 'full', readOnly: true })) })
    }
   } })));
  }
 } });
 const globals = { window: page, document: Object.assign(new EventTarget(), { visibilityState: 'visible' }), fetch: page.fetch };
 for (const [key, value] of Object.entries(globals)) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else Reflect.deleteProperty(globalThis, key); });
 }
 for (const zeroGrants of [false, true]) {
  grants = zeroGrants ? [] : [firstRoot];
  const outcomes: [string, string][] = [], runs: string[] = [];
  await discoverAutomaticPhotos({ ownerId, adapter: getNativeSyncAdapter()!, signal: new AbortController().signal,
   assertCurrent() {}, jobs: [], wakeConditions: true, foregroundStart: true, nativeOnly: true, paused: () => false,
   observe: (scope, outcome) => outcomes.push([scope.rootId, outcome]), run: async saved => {
    runs.push(saved.id); return { configurationRevision: saved.updatedAt, wake: { status: 'running' },
     photoRunProgress: { stage: 'ready', confirmed: { photos: 0, videos: 0, other: 0, wifiBytes: 0, mobileBytes: 0, unknownBytes: 0 } } };
   }
  });
  assert.deepEqual(runs, zeroGrants ? [] : ['valid']);
  assert.ok(outcomes.some(([id, outcome]) => id === 'revoked' && outcome === 'error'));
  assert.equal(outcomes.some(([id]) => ['paused', 'other-device'].includes(id)), false);
  if (zeroGrants) assert.ok(outcomes.some(([id, outcome]) => id === 'valid' && outcome === 'error'));
 }
 assert.ok(actions.every(action => ['status', 'list'].includes(action)), 'discovery never opens permission prompts or arms a revoked source');
});
