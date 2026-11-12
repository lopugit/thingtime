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
  const prior = [{ id: 'named-consumer', type: 'element' as const, tag: 'section', children: [...legacy, { id: 'named-result', type: 'element' as const, tag: 'p', props: { role: 'status' } }] }];
  const priorUpgrade = migrateNamedServiceBlocks(prior);
  assert.ok(settingsDocumentBlocks(priorUpgrade));
  assert.equal(priorUpgrade[0].children!.filter(child => child.id === 'named-operation-busy').length, 1);
  assert.deepEqual(migrateNamedServiceBlocks(priorUpgrade), priorUpgrade);
  assert.deepEqual(migrateNamedServiceBlocks([]), []);
});
