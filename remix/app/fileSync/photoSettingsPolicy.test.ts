import assert from 'node:assert/strict';
import { test } from 'node:test';

test('active Photos settings edits preserve every non-policy field and exact saved revision', async () => {
 const { isPhotoAutomationOnlyEdit } = await import('./photoSettingsPolicy');
 const configuration = { configurationVersion: 4 as const, name: 'Photos', deviceId: 'device', localRootId: 'photos', sourceKind: 'photos' as const,
  remoteFolderId: 'destination', mode: 'backup' as const, paused: false, propagateDeletes: false, network: 'wifi' as const, chargingOnly: false,
  excludedPaths: [], photoAutomation: { notificationIntervalMs: 1800000, uploadBytesPerSecond:625000 } };
 const saved = {id:'config',updatedAt:'revision',configuration};
 const draft = { id:'config',baseUpdatedAt:'revision',exclusions:'', configuration: {...configuration,photoAutomation:{...configuration.photoAutomation,uploadBytesPerSecond:1000000}} };
 assert.equal(isPhotoAutomationOnlyEdit(saved,draft),true);
 for (const patch of [{remoteFolderId:'other'},{localRootId:'other'},{paused:true},{network:'any'},{excludedPaths:['private']}])
  assert.equal(isPhotoAutomationOnlyEdit(saved,{...draft,configuration:{...draft.configuration,...patch} as typeof configuration}),false);
 assert.equal(isPhotoAutomationOnlyEdit(saved,{...draft,baseUpdatedAt:'stale'}),false);
});
