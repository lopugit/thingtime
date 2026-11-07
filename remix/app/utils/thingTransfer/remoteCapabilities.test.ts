import assert from 'node:assert/strict';
import test from 'node:test';
import { createThingtimeCapabilityChecker } from '../../api/utils/capabilities/requireCapability.client';
import { requireRemoteTransferImport, transferImportMinimumVersion } from './remoteCapabilities';
import { TRANSFER_LIMITS, type ThingTransfer } from './format';

const bundle = (): ThingTransfer => ({ format: 'thingtime.transfer', version: 1, roots: ['note'],
  things: [{ id: 'note', thingtime: ['data'], crystal: { name: 'Keep on device' } }],
  files: ['first', 'second'].map((id, i) => ({ id, targetId: 'note', path: `files/${String(i).padStart(6, '0')}`, name: `${id}.bin`,
    mime: 'application/octet-stream', bytes: 300 * 1024 * 1024, sha256: 'a'.repeat(64) })) });

test('large transfer imports negotiate the actual origin before upload or mutation and preserve the local manifest on refusal', async t => {
  const origin = 'https://capacity.test', original = bundle(), before = JSON.stringify(original);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); });
  let deployed = '1.14.0', calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++; assert.equal(url, '/.well-known/thingtime-capabilities.json'); assert.equal(options?.cache, 'no-store');
    return Response.json({ schemaVersion: 1, origin, features: { 'api.things-import': { version: deployed } } });
  });
  const check = createThingtimeCapabilityChecker();
  await assert.rejects(requireRemoteTransferImport(original, check), /incompatible/);
  assert.equal(calls, 1); assert.equal(JSON.stringify(original), before);
  deployed = '1.15.0'; await requireRemoteTransferImport(original, check); assert.equal(calls, 2);
});

test('small imports retain legacy compatible requirements and malformed bytes fail before negotiation', async () => {
  const manifest = bundle(); manifest.files = [];
  assert.equal(transferImportMinimumVersion(manifest), '1.13.0');
  manifest.things[0].thingtime = ['theme']; assert.equal(transferImportMinimumVersion(manifest), '1.14.0');
  assert.equal(transferImportMinimumVersion(bundle()), '1.15.0');
  for (const size of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER]) {
    const invalid = bundle(); invalid.files[0].bytes = size;
    await assert.rejects(requireRemoteTransferImport(invalid, async () => assert.fail('Invalid metadata must not reach an origin')));
  }
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(requireRemoteTransferImport(bundle(), async () => assert.fail('Cancelled negotiation'), cancelled.signal), { name: 'AbortError' });
  const equal = bundle(); equal.files = [equal.files[0]]; equal.files[0].bytes = TRANSFER_LIMITS.fileBytes;
  assert.equal(transferImportMinimumVersion(equal), '1.13.0');
});


test('cancellation after negotiation returns no admission even when a capability fetch ignores the signal', async () => {
  const controller = new AbortController();
  await assert.rejects(requireRemoteTransferImport(bundle(), async () => { controller.abort(); }, controller.signal), { name: 'AbortError' });
});
