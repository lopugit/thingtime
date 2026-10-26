import assert from 'node:assert/strict';
import test from 'node:test';
import { PASSWORD_PASSKEY_BLOCKS } from '../components/Passwords/passwordPasskeyBlocks';
import { settingsDocumentBlocks } from '../components/Settings/settingsDocument';
import { parseTransientBinding } from '../components/Builder/transientBlockActions';

test('passkey setup survives normal saved-layout validation with scoped transient operations', () => {
  const blocks = settingsDocumentBlocks(JSON.parse(JSON.stringify(PASSWORD_PASSKEY_BLOCKS)));
  const nodes: any[] = [];
  const visit = (items: any[]) => { for (const item of items) { nodes.push(item); if (item.children) visit(item.children); } };
  visit(blocks);
  const connect = nodes.find(item => item.id === 'password-passkey-connect');
  assert.equal(connect.props['data-tt-action'], '$transient');
  assert.equal(parseTransientBinding(JSON.stringify(connect.props['data-tt-action-inputs']))?.operation, 'passkey.connect');
  assert.equal(connect.props.disabled, '{result.busy}');
  assert.equal(nodes.find(item => item.id === 'password-passkey-native').condition.arg, 'result.nativeAvailable');
  assert.equal(nodes.find(item => item.id === 'password-passkey-web').condition.arg, 'result.webOnly');
  assert.equal(nodes.find(item => item.id === 'password-passkey-open').props['aria-controls'], 'password-passkey-instructions');
  assert.equal(nodes.find(item => item.id === 'password-passkey-instructions').props.id, 'password-passkey-instructions');
  assert.equal(new Set(nodes.map(item => item.id)).size, nodes.length);
  // The saved editable document contains public guidance, never a key-creation
  // Action, vault entry payload, remote source, or credential input.
  assert.ok(nodes.every(item => !item.source && item.type !== 'component' && item.tag !== 'input'));
  assert.ok(nodes.filter(item => item.props?.['data-tt-action-inputs']).every(item =>
    ['passkey.open', 'passkey.close', 'passkey.connect'].includes(item.props['data-tt-action-inputs'].operation)));
});
