import assert from 'node:assert/strict';
import test from 'node:test';
import { PASSWORD_PASSKEY_BLOCKS, migratePasswordPasskeyBlocks } from '../components/Passwords/passwordPasskeyBlocks';
import { settingsDocumentBlocks } from '../components/Settings/settingsDocument';
import { parseTransientBinding } from '../components/Builder/transientBlockActions';
import { NATIVE_PASSWORD_CONNECTION_BLOCKS } from '../components/Passwords/nativePasswordConnectionBlocks';

test('passkey setup survives normal saved-layout validation with scoped transient operations', () => {
  const blocks = settingsDocumentBlocks(JSON.parse(JSON.stringify(PASSWORD_PASSKEY_BLOCKS)));
  const nodes: any[] = [];
  const visit = (items: any[]) => { for (const item of items) { nodes.push(item); if (item.children) visit(item.children); } };
  visit(blocks);
  assert.equal(nodes.find(item => item.id === 'password-passkey-connect'), undefined);
  const connection = settingsDocumentBlocks(JSON.parse(JSON.stringify(NATIVE_PASSWORD_CONNECTION_BLOCKS)));
  const connectionNodes: any[] = []; const collect = (items: any[]) => { for (const item of items) { connectionNodes.push(item); if (item.children) collect(item.children); } }; collect(connection);
  const connect = connectionNodes.find(item => item.id === 'password-native-action');
  assert.equal(connect.props['data-tt-action'], '$transient');
  assert.equal(parseTransientBinding(JSON.stringify(connect.props['data-tt-action-inputs']))?.operation, 'autofill.activate');
  assert.equal(connect.props.disabled, '{result.disabled}');
  assert.equal(connect.text, '{result.label}');
  assert.equal(connectionNodes.filter(item => item.tag === 'button').length, 1);
  assert.equal(nodes.find(item => item.id === 'password-passkey-native').condition.arg, 'result.nativeAvailable');
  assert.equal(nodes.find(item => item.id === 'password-passkey-web').condition.arg, 'result.webOnly');
  assert.equal(nodes.find(item => item.id === 'password-passkey-open').props['aria-controls'], 'password-passkey-instructions');
  assert.equal(nodes.find(item => item.id === 'password-passkey-instructions').props.id, 'password-passkey-instructions');
  assert.equal(new Set(nodes.map(item => item.id)).size, nodes.length);
  // The saved editable document contains public guidance, never a key-creation
  // Action, vault entry payload, remote source, or credential input.
  assert.ok(nodes.every(item => !item.source && item.type !== 'component' && item.tag !== 'input'));
  assert.ok(nodes.filter(item => item.props?.['data-tt-action-inputs']).every(item =>
    ['passkey.open', 'passkey.close', 'passkey.extension'].includes(item.props['data-tt-action-inputs'].operation)));
});

test('saved guide retires the old connection action without removing authored siblings', () => {
  const blocks = structuredClone(PASSWORD_PASSKEY_BLOCKS);
  const native = flatten(blocks).find(item => item.id === 'password-passkey-native');
  native.children.push({ id: 'relocated-old-action', type: 'element', tag: 'button', text: 'My connection', props: { 'data-tt-action-inputs': { operation: 'passkey.connect' } } });
  native.children.push({ id: 'authored-message', type: 'element', tag: 'p', text: 'Keep this guidance' });
  const migrated = migratePasswordPasskeyBlocks(blocks);
  assert.equal(flatten(migrated).some(item => item.id === 'relocated-old-action'), false);
  assert.equal(flatten(migrated).find(item => item.id === 'authored-message').text, 'Keep this guidance');
  assert.equal(flatten(blocks).some(item => item.id === 'relocated-old-action'), true);
});


const flatten = (items: any[]): any[] => items.flatMap(item => [item, ...flatten(item.children || []), ...flatten(item.else || []), ...flatten(item.empty || [])]);
const find = (items: any[], id: string) => flatten(items).find(item => item.id === `password-passkey-${id}`);
const oldText: Record<string, string> = {
  open: 'Create a passkey',
  ceremony: 'Passkeys are created for a specific account during the website’s registration request. Opening this guide does not create a passkey.',
  'web-instructions': 'To save passkeys in Thingtime, open Passwords in the native Thingtime app, connect Password AutoFill, and enable the Thingtime provider in your device settings. This browser page cannot register Thingtime as your system provider.',
  'step-create': 'Choose its Create passkey or Add passkey option, then select Thingtime as the credential provider when offered.',
  'step-verify': 'Verify with your device and finish the website’s registration. Return to Passwords and refresh to see the saved entry.',
  availability: 'If Thingtime is not offered, check that the signed native provider is installed, connected and enabled. Provider availability depends on your device and browser.',
};
const legacy = () => {
  const blocks = structuredClone(PASSWORD_PASSKEY_BLOCKS);
  const guide = find(blocks, 'instructions');
  guide.children = guide.children.filter((item: any) => !['password-passkey-extension', 'password-passkey-extension-install'].includes(item.id));
  for (const [id, text] of Object.entries(oldText)) find(blocks, id).text = text;
  return blocks;
};

test('legacy setup receives browser instructions while preserving authored layout and sibling order', () => {
  const blocks = legacy(), guide = find(blocks, 'instructions');
  find(blocks, 'open').css = { color: 'var(--custom-accent)', padding: '24px' };
  find(blocks, 'ceremony').props = { 'data-authored': 'keep' };
  guide.children.splice(1, 0, { id: 'authored-help', type: 'element', tag: 'p', text: 'My custom help', css: { color: 'blue' } });
  const original = structuredClone(blocks);
  const migrated = migratePasswordPasskeyBlocks(blocks);
  assert.deepEqual(blocks, original, 'Migration must not mutate the saved source');
  assert.equal(find(migrated, 'open').text, 'Set up passkeys');
  assert.deepEqual(find(migrated, 'open').css, find(original, 'open').css);
  assert.deepEqual(find(migrated, 'ceremony').props, { 'data-authored': 'keep' });
  assert.ok(find(migrated, 'extension'));
  assert.ok(find(migrated, 'extension-install'));
  assert.deepEqual(find(migrated, 'instructions').children.filter((item: any) => !['password-passkey-extension', 'password-passkey-extension-install'].includes(item.id)).map((item: any) => item.id), guide.children.map((item: any) => item.id));
  assert.deepEqual(flatten(migrated).find(item => item.id === 'authored-help'), flatten(original).find(item => item.id === 'authored-help'));
  settingsDocumentBlocks(migrated);
  assert.equal(migratePasswordPasskeyBlocks(migrated), migrated, 'Already migrated documents are left alone');
});

test('migration preserves authored text, changed element roles, children and existing extension blocks', () => {
  const blocks = legacy();
  find(blocks, 'open').text = 'My credential guide';
  find(blocks, 'web-instructions').text = 'My browser instructions';
  find(blocks, 'availability').tag = 'aside';
  const extension = structuredClone(find(PASSWORD_PASSKEY_BLOCKS, 'extension'));
  extension.children[0].text = 'My extension status';
  find(blocks, 'instructions').children.unshift(extension);
  const migrated = migratePasswordPasskeyBlocks(blocks);
  assert.equal(find(migrated, 'open').text, 'My credential guide');
  assert.equal(find(migrated, 'web-instructions').text, 'My browser instructions');
  assert.equal(find(migrated, 'availability').text, oldText.availability);
  assert.equal(find(migrated, 'extension-status').text, 'My extension status');
  assert.equal(flatten(migrated).filter(item => item.id === 'password-passkey-extension').length, 1);
  assert.equal(new Set(flatten(migrated).map(item => item.id)).size, flatten(migrated).length);
});

test('fully authored documents and deliberate post-upgrade deletion remain untouched', () => {
  const authored = legacy();
  for (const id of Object.keys(oldText)) find(authored, id).text = `Authored ${id}`;
  assert.equal(migratePasswordPasskeyBlocks(authored), authored);
  const migrated = migratePasswordPasskeyBlocks(legacy());
  find(migrated, 'instructions').children = find(migrated, 'instructions').children.filter((item: any) => item.id !== 'password-passkey-extension-install');
  assert.equal(migratePasswordPasskeyBlocks(migrated), migrated);
  assert.equal(find(migrated, 'extension-install'), undefined);
});

test('a relocated extension descendant is not duplicated by legacy migration', () => {
  const blocks = legacy();
  const relocated = structuredClone(find(PASSWORD_PASSKEY_BLOCKS, 'browser-setup'));
  find(blocks, 'instructions').children.push(relocated);
  const migrated = migratePasswordPasskeyBlocks(blocks);
  assert.equal(flatten(migrated).filter(item => item.id === relocated.id).length, 1);
  assert.equal(find(migrated, 'extension-install'), undefined);
});
