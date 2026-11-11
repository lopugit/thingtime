import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFileSyncConfiguration, FILE_SYNC_UPLOAD_POLICY_REQUIREMENTS } from './configuration';
import { sameFolderUploadPolicySource } from './photoSettingsPolicy';
import { supportsNativeUploadPolicy } from './photoTransferPolicy';
import { parseMobileFolderResult } from './mobileFolders.client';
import { readConfigurationDraft, canonicalDraftConfiguration } from './configurationEditor';
import { saved, scope } from './foregroundSync.fixture';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';
import { createApiCapabilitiesManifest } from '../docs/apiDocs';
import { thingtimeCapabilityManifest } from '../api/utils/capabilities/thingtimeCapabilities';
const before = { ...saved.configuration, sourceKind: 'folder' as const, mode: 'backup' as const, paused: false, propagateDeletes: false };
const policy = { uploadBytesPerSecond: 2_000_000, uploadBytesPerHour: 1_000_000_000 };
const after = { ...before, configurationVersion: 5 as const, uploadPolicy: policy };
test('v5 folder settings roundtrip canonical saved data and draft reload while preserving v1/v4', () => {
 const parsed = parseFileSyncConfiguration(after); assert.deepEqual(parsed, after);
 const draft = { version: 1 as const, id: saved.id, baseUpdatedAt: saved.updatedAt, configuration: after, exclusions: after.excludedPaths.join('\n'), pending: false };
 assert.deepEqual(canonicalDraftConfiguration(readConfigurationDraft(JSON.stringify(draft), after.deviceId)!), parsed);
 assert.deepEqual(parseFileSyncConfiguration(before), before);
 const photos = { ...before, sourceKind: 'photos', configurationVersion: 4, photoAutomation: { notificationIntervalMs: 1_800_000, uploadBytesPerSecond: 625_000 } };
 assert.deepEqual(parseFileSyncConfiguration(photos), photos);
 for (const patch of [{ configurationVersion: 1 }, { sourceKind: 'photos' }, { mode: 'two-way' }, { propagateDeletes: true }, { resourceLimits: { cpuPercent: 50 } }, { ignoreRules: '*.tmp' }, { uploadPolicy: { cpuPercent: 50 } }, { uploadPolicy: { uploadBytesPerHour: 0 } }]) assert.throws(() => parseFileSyncConfiguration({ ...after, ...patch }));
});
test('policy replacement preserves exact backup identity, pause, destination and other conditions', () => {
 assert.equal(sameFolderUploadPolicySource(before, after), true);
 for (const patch of [{ paused: true }, { localRootId: 'other' }, { remoteFolderId: 'other' }, { deviceId: 'other' }, { network: 'any' }, { chargingOnly: !after.chargingOnly }, { mode: 'two-way' }, { sourceKind: 'photos' }, { excludedPaths: ['new'] }]) assert.equal(sameFolderUploadPolicySource(before, { ...after, ...patch } as any), false);
 assert.equal(sameFolderUploadPolicySource({ ...before, paused: true }, after), false);
});
test('independent native upload and origin manifests negotiate without claiming Photos/full resources', () => {
 assert.equal(supportsNativeUploadPolicy({ platform: 'ios', filePhotoAutomationVersion: '1.6.0' }), false);
 assert.equal(supportsNativeUploadPolicy({ platform: 'ios', fileResourceLimitsVersion: '1.0.0' }), false);
 assert.equal(supportsNativeUploadPolicy({ platform: 'ios', fileUploadPolicyVersion: '1.0.0' }), true);
 assert.equal(supportsNativeUploadPolicy({ platform: 'ios', fileUploadPolicyVersion: '2.0.0' }), false);
 const source = createApiCapabilitiesManifest(), runtime = thingtimeCapabilityManifest(scope.origin);
 for (const [key, minimum] of Object.entries(FILE_SYNC_UPLOAD_POLICY_REQUIREMENTS)) {
  assert.equal(capabilitySatisfies(source.features[key], minimum), true);
  assert.equal(capabilitySatisfies(runtime.features[key].version, minimum), true);
 }
});
test('folder hourly waits retain exact native deadline on part and whole-file paths', () => {
 const expected = { requestId: 'request', ownerId: 'owner', origin: scope.origin }, retryAt = '2026-11-12T04:00:00.000Z';
 for (const action of ['upload-file', 'upload-part', 'defer-upload']) assert.throws(() => parseMobileFolderResult({ type: 'mobile-files-result', payload: { ...expected, rootId: 'root', syncWait: 'data-budget', retryAt } }, expected, { action, rootId: 'root' } as any), (error: any) => error.reason === 'data-budget' && error.retryAt === Date.parse(retryAt));
});
