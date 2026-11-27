import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import { deviceSyncResourceBlocks, migrateDeviceSyncResourceBlocks } from './deviceSyncResourceBlocks';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
test('resource dashboard is valid saved Builder data with individually editable static bars and target fields', () => {
 const blocks = settingsDocumentBlocks(deviceSyncResourceBlocks);
 const encoded = JSON.stringify(blocks);
 assert.ok(encoded.includes('Total Sync & Backup usage'));
 assert.equal((encoded.match(/data-resource-bar/g) ?? []).length, 4);
 assert.ok(!encoded.includes('"tag":"progress"') && !encoded.includes('"tag":"meter"'));
 assert.ok(encoded.includes('target-transfer') && encoded.includes('target-scan') && encoded.includes('target-cpu'));
});

test('an authored live-only dashboard gains history without changing user text or duplicating controls', () => {
 const previous: WebpageBlock[] = [{
  id: 'device-sync-resource-dashboard', type: 'element', tag: 'section', children: [
   { id: 'device-resource-title', type: 'element', tag: 'h2', text: 'My sync history' },
   { id: 'device-resource-status', type: 'element', tag: 'p', text: 'My status: {deviceResources.status}' },
   { id: 'user-note', type: 'element', tag: 'p', text: 'Keep this note' }
  ]
 }];
 const upgraded = settingsDocumentBlocks(migrateDeviceSyncResourceBlocks(previous));
 const encoded = JSON.stringify(upgraded);
 assert.match(encoded, /My sync history/);
 assert.match(encoded, /My status:/);
 assert.match(encoded, /Keep this note/);
 assert.equal((encoded.match(/select-history-window/g) ?? []).length, 6);
 assert.equal(migrateDeviceSyncResourceBlocks(upgraded), upgraded);
});
