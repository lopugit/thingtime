import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import { namedConnectionBlocks, migrateNamedServiceBlocks } from './namedConnectionBlocks';

test('service block upgrades remain valid authored JSON and idempotent', () => {
  const upgraded = migrateNamedServiceBlocks(namedConnectionBlocks);
  assert.ok(settingsDocumentBlocks(upgraded));
  assert.deepEqual(migrateNamedServiceBlocks(upgraded), upgraded);
  const legacy = [{ id: 'named-consumer-operations', type: 'collection' as const, children: [{ id: 'edited-run', type: 'element' as const, tag: 'button', text: 'Custom read' }] }];
  const migrated = migrateNamedServiceBlocks(legacy);
  assert.ok(settingsDocumentBlocks(migrated));
  assert.equal(migrated[0].children![1].text, 'Custom read');
  assert.deepEqual(migrateNamedServiceBlocks([]), []);
});
