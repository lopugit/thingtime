import assert from 'node:assert/strict';
import test from 'node:test';
import { findBlock } from '../Builder/webpageBlocks';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import { thingStorageBlocks } from './thingStorageBlocks';
import { parseStoragePolicyResponse, selectedStoragePlacement, storagePlacementCommand } from './thingStorageClient';
import { thingStorageHref } from './thingStorageNavigation';
import type { ThingStoragePolicyResponse } from '../../utils/thingStoragePolicy';

const initial: ThingStoragePolicyResponse = {
  ok: true, canEdit: true,
  source: { id: 'example', revision: 'current', sourceHash: 'a'.repeat(64) },
  policy: { revision: 'policy', cloudSync: true, defaultLocalAvailability: 'keep', automaticDownloadDeviceId: 'other' },
  device: { id: 'this', kind: 'browser', revision: 'device', localAvailability: 'inherit' },
};

test('Cloud only protects the selected device revision without clearing another device’s pin', () => {
  assert.deepEqual(storagePlacementCommand(initial, 'cloud'), {
    id: 'example', expectedSourceRevision: 'current', expectedPolicyRevision: 'policy',
    deviceId: 'this', expectedDeviceRevision: 'device',
    policy: { cloudSync: true }, localAvailability: 'cloud-only',
  });
  const pinnedHere = { ...initial, policy: { ...initial.policy, automaticDownloadDeviceId: 'this' } };
  assert.deepEqual(storagePlacementCommand(pinnedHere, 'cloud').policy, { cloudSync: true, automaticDownloadDeviceId: null });
});

test('Cloud plus this device sets the automatic target and local keep in the same revision-guarded command', () => {
  const command = storagePlacementCommand(initial, 'pin');
  assert.deepEqual(command.policy, { cloudSync: true, defaultLocalAvailability: 'on-demand', automaticDownloadDeviceId: 'this' });
  assert.equal(command.localAvailability, 'keep');
  assert.equal(selectedStoragePlacement(initial), null);
  assert.equal(selectedStoragePlacement({ ...initial, policy: { ...initial.policy, ...command.policy },
    device: { ...initial.device!, localAvailability: 'keep' } }), 'pin');
});

test('policy readback cannot attach another Thing or device to this control', () => {
  assert.deepEqual(parseStoragePolicyResponse(initial, 'example', 'this'), initial);
  assert.throws(() => parseStoragePolicyResponse(initial, 'other'), /did not match/);
  assert.throws(() => parseStoragePolicyResponse(initial, 'example', 'other'), /did not match/);
  assert.throws(() => storagePlacementCommand({ ...initial, canEdit: false }, 'cloud'), /authorized/);
});

test('storage menus deep link to exact Things and saved block editing preserves each control', () => {
  assert.equal(thingStorageHref('a#b', { dataPlane: 'home', archive: true }), '/thing/a%23b?archive=true&dataPlane=home#thing-storage');
  const blocks = settingsDocumentBlocks(thingStorageBlocks);
  assert.equal(findBlock(blocks, 'storage-choice-cloud-label')?.text, 'Cloud only');
  assert.equal(findBlock(blocks, 'storage-status-device-value')?.text, '{replicaLabel}');
  assert.deepEqual(findBlock(blocks, 'storage-choice-cloud')?.props?.['data-tt-action-inputs'], { operation: 'choose', choice: 'cloud' });
  assert.deepEqual(findBlock(blocks, 'storage-save')?.props?.['data-tt-action-inputs'], { operation: 'save' });
});
