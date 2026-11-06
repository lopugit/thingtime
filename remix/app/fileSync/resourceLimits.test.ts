import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { newFileSyncConfiguration, parseFileSyncConfiguration, parseFileSyncResourceLimits, FILE_SYNC_RESOURCE_REQUIREMENTS } from './configuration';
import { uploadBatchCanonicalBytes } from './uploadBatch';
import { folderBatchCanonicalBytes } from './folderBatch';
import { validateThingtimeCrystal } from '../schemas/registry';
import { createApiCapabilitiesManifest } from '../docs/apiDocs';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';
const require = createRequire(import.meta.url);
const limits = { uploadBytesPerSecond: 125000, downloadBytesPerSecond: 250000, transferConcurrency: 2, indexingConcurrency: 3, cpuPercent: 25 };
const base = () => newFileSyncConfiguration({ name: 'Limits', deviceId: 'device', localRootId: 'local', remoteFolderId: 'remote' });
test('resource policy is closed, finite, version fenced and preserves legacy defaults', () => {
 assert.equal(parseFileSyncResourceLimits({}), undefined);
 assert.deepEqual(parseFileSyncConfiguration({ ...base(), resourceLimits: {} }), base());
 for (const invalid of [null, [], { unknown: 1 }, { cpuPercent: 101 }, { cpuPercent: .9 }, { cpuPercent: 25.5 }, { transferConcurrency: 1.2 }, { indexingConcurrency: Number.MAX_SAFE_INTEGER + 1 }, { uploadBytesPerSecond: Infinity }, { downloadBytesPerSecond: 0 }, { cpuPercent: '20' }]) assert.throws(() => parseFileSyncResourceLimits(invalid));
 assert.throws(() => parseFileSyncConfiguration({ ...base(), resourceLimits: limits }));
 assert.throws(() => parseFileSyncConfiguration({ ...base(), configurationVersion: 3 }));
 const expected = parseFileSyncConfiguration({ ...base(), configurationVersion: 3, resourceLimits: limits, ignoreRules: '*.tmp' });
 assert.deepEqual(expected.resourceLimits, limits);
 const validated = validateThingtimeCrystal(['file-sync'], expected);
 assert.equal(validated.ok, true); if (validated.ok) assert.deepEqual(validated.crystal, expected);
 const manifest = createApiCapabilitiesManifest('https://sync.test').features;
 for (const [feature, minimum] of Object.entries(FILE_SYNC_RESOURCE_REQUIREMENTS)) assert.equal(capabilitySatisfies(manifest[feature], minimum), true);
 assert.equal(capabilitySatisfies('1.38.0', FILE_SYNC_RESOURCE_REQUIREMENTS['api.things']), false);
 assert.equal(capabilitySatisfies('1.1.0', FILE_SYNC_RESOURCE_REQUIREMENTS['api.file-sync-batches']), false);
});
for (const [kind, ts, cjs] of [
 ['upload', uploadBatchCanonicalBytes, require('../../../electron/lib/folder-upload-batch.cjs').batchCanonicalBytes],
 ['folder', folderBatchCanonicalBytes, require('../../../electron/lib/folder-validate-batch.cjs').folderBatchCanonicalBytes]
] as const) test(`${kind}: configuration3 canonical fields match CJS, bind every ceiling, preserve legacy bytes`, () => {
 const vectors = JSON.parse(readFileSync(new URL(`./fixtures/${kind}BatchDigest.v1.json`, import.meta.url), 'utf8')).vectors;
 for (const vector of vectors) assert.deepEqual(Buffer.from(ts(vector.descriptor)), cjs(vector.descriptor));
 const descriptor = structuredClone(vectors[0].descriptor);
 descriptor.configuration.configuration.configurationVersion = 3;
 descriptor.configuration.configuration.resourceLimits = limits;
 const bytes = Buffer.from(ts(descriptor));
 assert.deepEqual(bytes, cjs(descriptor));
 assert.match(bytes.toString(), new RegExp(`thingtime-${kind}-batch-v2`));
 for (const key of Object.keys(limits)) {
  const changed = structuredClone(descriptor); changed.configuration.configuration.resourceLimits[key]++;
  assert.notDeepEqual(Buffer.from(ts(changed)), bytes);
  assert.deepEqual(Buffer.from(ts(changed)), cjs(changed));
  delete changed.configuration.configuration.resourceLimits[key];
  assert.notDeepEqual(Buffer.from(ts(changed)), bytes);
  assert.deepEqual(Buffer.from(ts(changed)), cjs(changed));
 }
 for (const rate of [312.5, 1e-7, 1e21, Number.MIN_VALUE, Number.MAX_VALUE]) {
  const changed = structuredClone(descriptor); changed.configuration.configuration.resourceLimits.uploadBytesPerSecond = rate;
  assert.deepEqual(Buffer.from(ts(changed)), cjs(changed));
  const ieee = Buffer.alloc(8); ieee.writeDoubleBE(rate); assert.ok(Buffer.from(ts(changed)).includes(Buffer.from(ieee.toString('hex'))));
 }
 const invalid = structuredClone(descriptor); invalid.configuration.configuration.configurationVersion = 2;
 assert.throws(() => ts(invalid)); assert.throws(() => cjs(invalid));
 const unknown = structuredClone(descriptor); unknown.configuration.configuration.resourceLimits.unknown = 1;
 assert.throws(() => ts(unknown)); assert.throws(() => cjs(unknown));
});

test('portable resource3 vectors remain stable for native implementations', () => {
 const vectors = JSON.parse(readFileSync(new URL('./fixtures/resourceLimits.v3.json', import.meta.url), 'utf8')).vectors;
 for (const vector of vectors) {
  const codec = vector.kind === 'upload' ? uploadBatchCanonicalBytes : folderBatchCanonicalBytes;
  assert.equal(Buffer.from(codec(vector.descriptor)).toString('base64'), vector.canonicalBase64);
 }
});
