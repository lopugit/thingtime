import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceSyncResourceBlocks } from './deviceSyncResourceBlocks';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
test('resource dashboard is valid saved Builder data with individually editable static bars and target fields', () => {
 const blocks = settingsDocumentBlocks(deviceSyncResourceBlocks);
 const encoded = JSON.stringify(blocks);
 assert.ok(encoded.includes('Total Sync & Backup usage'));
 assert.equal((encoded.match(/data-resource-bar/g) ?? []).length, 4);
 assert.ok(!encoded.includes('"tag":"progress"') && !encoded.includes('"tag":"meter"'));
 assert.ok(encoded.includes('target-transfer') && encoded.includes('target-scan') && encoded.includes('target-cpu'));
});
