import test from 'node:test';
import assert from 'node:assert/strict';
import { newFileSyncConfiguration } from './configuration';
import { hasSavedDeviceRoot, assertRemoteDeviceRoot } from './remoteConfigurationRoot';

const configuration = newFileSyncConfiguration({ name: 'Documents', deviceId: 'device', localRootId: 'root', remoteFolderId: 'cloud' });
const saved = { id: 'connection', updatedAt: '2026-10-23T00:00:00.000Z', configuration };
test('offline edits preserve existing device authority without requiring a live host', () => {
	assert.equal(hasSavedDeviceRoot(saved, { ...configuration, name: 'New name', paused: true, network: 'any' }, 'device'), true);
	assert.equal(hasSavedDeviceRoot(saved, { ...configuration, localRootId: 'other' }, 'device'), false);
	assert.equal(hasSavedDeviceRoot(saved, { ...configuration, deviceId: 'foreign' }, 'device'), false);
	assert.equal(hasSavedDeviceRoot(saved, { ...configuration, sourceKind: 'photos' }, 'device'), false);
	assert.equal(hasSavedDeviceRoot(null, configuration, 'device'), false);
});
test('new bindings require the current folder and source kind from the exact device', () => {
	assert.doesNotThrow(() => assertRemoteDeviceRoot([{ id: 'root', name: 'Documents' }], configuration, 'device'));
	assert.throws(() => assertRemoteDeviceRoot([], configuration, 'device'), /Connect this device/);
	assert.throws(() => assertRemoteDeviceRoot([{ id: 'root', name: 'Photos', sourceKind: 'photos' }], configuration, 'device'));
	assert.throws(() => assertRemoteDeviceRoot([{ id: 'root', name: 'Documents' }], configuration, 'foreign'));
});
