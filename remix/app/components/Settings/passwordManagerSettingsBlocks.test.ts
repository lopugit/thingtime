import assert from 'node:assert/strict';
import test from 'node:test';
import { PASSWORD_MANAGER_SETTINGS_BLOCKS } from './passwordManagerSettingsBlocks';
import { settingsDocumentBlocks } from './settingsDocument';
import { drawerMenuItems } from '../Nav/Drawer/drawerMenu';

test('password manager settings remain editable safe presentation blocks', () => {
  const blocks = settingsDocumentBlocks(PASSWORD_MANAGER_SETTINGS_BLOCKS);
  assert.equal(blocks.length, PASSWORD_MANAGER_SETTINGS_BLOCKS.length);
  assert.equal(new Set(blocks.map(block => block.id)).size, blocks.length);
  assert.ok(blocks.every(block => block.type === 'element'));
  const actions = blocks.filter(block => block.tag === 'button');
  assert.equal(actions.length, 2);
  assert.deepEqual(actions.map(block => block.props?.['data-tt-action-inputs']), [{ operation: 'passwords.open' }, { operation: 'passwords.security' }]);
  assert.ok(actions.every(block => block.css?.['min-height'] === '44px'));
});

test('password manager has its own authenticated drawer entry with a canonical settings link', () => {
  const manager = drawerMenuItems.find(item => item.id === 'passwords');
  assert.ok(manager);
  assert.equal(manager.to, '/passwords');
  assert.equal(manager.authOnly, true);
  assert.equal(manager.children.find(item => item.id === 'passwords-settings')?.to, '/settings/passwords');
});
