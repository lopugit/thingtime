import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrateNamedConnectionForm, namedConnectionBlocks } from './namedConnectionBlocks';
import type { WebpageBlock } from '../Builder/webpageBlocks';

test('old saved reconnect form preserves authored labels, styles and nesting while upgrading its initial name and feedback', () => {
  const saved: WebpageBlock[] = [{ id: 'named-form-group', type: 'element', tag: 'fieldset', children: [
    { id: 'named-name-label', type: 'element', tag: 'label', text: 'Purpose name' },
    { id: 'named-name-field', type: 'element', tag: 'input', props: { defaultValue: '{named.name}', name: 'connection-name' }, css: { color: 'purple' } },
    { id: 'named-form-submit', type: 'element', tag: 'button', text: 'Sign in again' }
  ] }];
  const before = structuredClone(saved);
  const migrated = migrateNamedConnectionForm(saved);
  assert.deepEqual(saved, before, 'Migration must never mutate the saved definition');
  assert.deepEqual(migrated[0].children?.[0], before[0].children?.[0]);
  assert.deepEqual(migrated[0].children?.[1].css, { color: 'purple' });
  assert.equal(migrated[0].children?.[1].props?.value, '{named.name}');
  assert.equal(migrated[0].children?.[1].props?.defaultValue, undefined);
  assert.equal(migrated[0].children?.[2].id, 'named-form-error');
  assert.equal(migrated[0].children?.[3].text, 'Sign in again');
  assert.deepEqual(migrateNamedConnectionForm(migrated), migrated, 'Repeated loads must not duplicate feedback');
});

test('supported custom field bindings and current defaults survive repeated layout loads', () => {
  const custom: WebpageBlock[] = [{ id: 'named-name-field', type: 'element', tag: 'input', props: { value: '{custom.name}', placeholder: 'Custom name' } }];
  assert.equal(migrateNamedConnectionForm(custom)[0].props?.value, '{custom.name}');
  assert.equal(migrateNamedConnectionForm(custom)[0].props?.placeholder, 'Custom name');
  assert.deepEqual(migrateNamedConnectionForm(namedConnectionBlocks), namedConnectionBlocks);
});
