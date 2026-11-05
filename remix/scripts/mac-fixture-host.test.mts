import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMacFixtureHost, macFixtureWorkerOptions, macFixtureRuntime } from './mac-fixture-host.mts';
const origin = 'http://127.0.0.1:28311', ownerId = 'synthetic-owner', deviceId = randomUUID();
const caps = { fileAccessVersion: '1.19.0', fileResourceLimitsVersion: '1.1.0', fileStagingVersion: '1.1.0', filePublicationVersion: '1.2.0', fileUploadBatchVersion: '1.0.0', fileFolderBatchVersion: '1.0.0' };
const features = { 'api.devices-node-identity': { version: '1.0.0' }, 'api.attachment-content': { version: '1.17.0' }, 'api.attachment-upload-parts': { version: '1.0.0' } };
function setup(capabilities = caps, sorted = true) {
 const calls: any[] = []; let accounts = 0;
 const fetcher: typeof fetch = async (url) => {
  if (new URL(String(url)).pathname === '/api/v1/auth/me') { accounts++; return Response.json({ user: { id: ownerId, accountKind: 'user' } }); }
  return Response.json({ schemaVersion: 1, origin, features });
 };
 return { calls, accounts: () => accounts, input: { origin, ownerId, deviceId, signal: new AbortController().signal, fetch: fetcher,
  resourcePolicy: { resourceScope: 'synthetic-connection', deviceResourceLimits: () => ({ scanBytesPerSecond: 5_000_000, transferBytesPerSecond: 5_000_000, cpuPercent: 15 }), observe() {} },
  sendNative: async (payload: any) => { calls.push(payload); return { ...payload, capabilities: sorted ? Object.fromEntries(Object.entries(capabilities).sort(([a],[b])=>a.localeCompare(b))) : capabilities, roots: [], conditions: { network: 'wifi', charging: true } }; },
  cancelNative() {}, diagnostic() {} } };
}
test('fixture composes real manager negotiation and fresh composite authorization without custom policy', async () => {
 const f = setup(), host = await createMacFixtureHost(f.input);
 assert.equal(host.capabilities!.fileAccessVersion, caps.fileAccessVersion);
 assert.equal(host.capabilities!.fileUploadVersion, '1.1.0');
 assert.equal(host.capabilities!.fileDownloadVersion, '1.0.1');
 const options = macFixtureWorkerOptions(host, ownerId, deviceId, f.input.signal);
 assert.equal(options.nativeOperationGuards, true);
 const contexts = f.calls.length, accounts = f.accounts();
 await options.authorizeContext();
 assert.equal(f.calls.length, contexts + 1); assert.ok(f.accounts() > accounts);
 assert.ok(f.calls.every(call => call.action === 'context'));
 const runtime = macFixtureRuntime(host, { origin, ownerId, deviceId });
 assert.equal('authorizeMutation' in runtime, false);
});
test('fixture refuses missing real native context/resource capability instead of advertising guards', async () => {
 const f = setup({ ...caps, fileAccessVersion: '1.1.0', fileResourceLimitsVersion: undefined } as any);
 await assert.rejects(createMacFixtureHost(f.input));
});

test('digest timing observes the canonical hash without changing its result on diagnostic failure', async () => {
 const f = setup(); f.input.diagnostic = () => { throw Error('diagnostic failed'); };
 await createMacFixtureHost(f.input);
 const { createRequire } = await import('node:module');
 const { governedHash } = createRequire(import.meta.url)('../../electron/lib/folder-transfer-process.cjs');
 const { createHash } = await import('node:crypto');
 const bytes = Buffer.from('synthetic-digest');
 assert.equal(await governedHash(undefined, bytes, f.input.signal), createHash('sha256').update(bytes).digest('hex'));
});

test('fixture refuses noncanonical context framing before a benchmark', async () => {
 const f = setup(caps, false);
 await assert.rejects(createMacFixtureHost(f.input));
});
