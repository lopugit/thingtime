import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordAuthenticatorSetupBlocks, passwordManagerBlocks, passwordSignInBlocks, upgradePasswordManagerBlocks } from './passwordManagerBlocks';
import { passwordEntryDisplay } from './passwordEntryDisplay';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import type { WebpageBlock } from '../Builder/webpageBlocks';
const walk = (blocks: WebpageBlock[]): WebpageBlock[] => blocks.flatMap(block => [block, ...walk(block.children || [])]);
test('password layouts retain independently editable controls and repeated field/card templates', () => {
  for (const blocks of [passwordAuthenticatorSetupBlocks, passwordManagerBlocks, passwordSignInBlocks]) {
    const saved = settingsDocumentBlocks(blocks);
    assert.deepEqual(settingsDocumentBlocks(saved), saved);
    const nodes = walk(saved);
    assert.equal(new Set(nodes.map(node => node.id)).size, nodes.length);
    assert.ok(nodes.every(node => ['element', 'condition', 'collection'].includes(node.type)));
  }
  const nodes = walk(passwordManagerBlocks);
  for (const id of ['password-record-title', 'password-field-caption', 'password-field-input', 'password-field-reveal-label', 'password-native-connect-label', 'password-qr-upload', 'password-transfer-confirm-label']) assert.ok(nodes.some(node => node.id === id));
  assert.equal(nodes.find(node => node.id === 'password-fields')?.type, 'collection');
  assert.equal(nodes.find(node => node.id === 'password-records')?.type, 'collection');
});
test('display projection excludes decrypted fields, source archives and metadata not explicitly approved', () => {
  const entry = { title: 'PRIVATE_TITLE', passwordType: 'login' as const, tags: ['PRIVATE_TAG'], onePassword: 'PRIVATE_SOURCE', onePasswordContext: 'PRIVATE_CONTEXT', fields: [
    { id: 'password', label: 'Password', type: 'password' as const, value: 'PRIVATE_VALUE', sourcePath: ['PRIVATE_PATH'] },
    { id: 'note', label: 'Notes', type: 'notes' as const, value: 'PRIVATE_NOTE' },
    { id: 'otp', label: 'Code', type: 'totp' as const, value: 'PRIVATE_TOTP' }
  ] };
  const hidden = passwordEntryDisplay(entry), shown = passwordEntryDisplay(entry, { password: true });
  assert.ok(!JSON.stringify([hidden, shown]).includes('PRIVATE_'));
  assert.equal(hidden.fields[0].inputType, 'password');
  assert.equal(shown.fields[0].inputType, 'text');
  assert.equal(hidden.fields[1].multiline, true);
  assert.equal(hidden.fields[2].totp, true);
});
test('persisted layouts refuse values on opted-in controls including revealed text and source textareas', () => {
  for (const tag of ['input', 'textarea']) for (const patch of [{ value: 'secret' }, { defaultValue: 'secret' }, { checked: true }]) {
    assert.throws(() => settingsDocumentBlocks([{ id: 'private', type: 'element', tag, props: { name: 'secret', type: 'text', 'data-tt-private-control': '', ...patch } }]), /Private input/);
  }
  assert.throws(() => settingsDocumentBlocks([{ id: 'private', type: 'element', tag: 'textarea', text: 'secret', props: { name: 'source', 'data-tt-private-control': '' } }]), /Private input/);
});

test('Copy is an editable ordinary button with only a field id in its transient binding', () => {
  const nodes = walk(settingsDocumentBlocks(passwordManagerBlocks));
  const button = nodes.find(node => node.id === 'password-field-copy')!;
  assert.equal(button.type, 'element'); assert.equal(button.tag, 'button');
  assert.equal(button.props?.['data-tt-action'], '$transient');
  assert.deepEqual(button.props?.['data-tt-action-inputs'], { operation: 'field.copy', id: '{item.id}' });
  assert.equal(button.props?.['aria-label'], '{item.copyAccessibleLabel}');
  assert.ok(button.children?.some(node => node.id === 'password-field-copy-label'));
  assert.equal(nodes.find(node => node.id === 'password-field-copy-feedback')?.props?.role, 'status');
});
test('Copy projection distinguishes verification codes and excludes passkey signing fields', () => {
  const entry = { title: 'Synthetic', passwordType: 'login' as const, fields: [
    { id: 'password', label: 'Password', type: 'password' as const, value: 'PRIVATE_PASSWORD' },
    { id: 'totp', label: 'Authenticator seed', type: 'totp' as const, value: 'PRIVATE_SEED' }
  ] };
  const display = passwordEntryDisplay(entry, {}, { password: 'Copied.' });
  assert.ok(display.fields.every(field => field.copyable));
  assert.equal(display.fields[0].copyAccessibleLabel, 'Copy Password');
  assert.equal(display.fields[0].copyFeedback, 'Copied.');
  assert.equal(display.fields[0].inputType, 'password');
  assert.equal(display.fields[1].copyAccessibleLabel, 'Copy current verification code');
  assert.equal(display.fields[1].copyLabel, 'Copy verification code');
  assert.ok(!JSON.stringify(display).includes('PRIVATE_'));
  assert.ok(passwordEntryDisplay({ ...entry, passwordType: 'passkey' }).fields.every(field => !field.copyable));
});

test('incoming native setup controls are individually editable and bind no secret payload', () => {
  const saved = settingsDocumentBlocks(passwordAuthenticatorSetupBlocks), nodes = walk(saved);
  for (const id of ['password-setup-heading', 'password-setup-help', 'password-setup-account', 'password-setup-create', 'password-setup-attach', 'password-setup-cancel', 'password-setup-message']) assert.ok(nodes.some(node => node.id === id));
  for (const operation of ['setup.create', 'setup.attach', 'setup.cancel']) {
    const button = nodes.find(node => (node.props?.['data-tt-action-inputs'] as any)?.operation === operation)!;
    assert.equal(button.tag, 'button'); assert.deepEqual(button.props?.['data-tt-action-inputs'], { operation, id: '{item.id}' });
    assert.ok(button.children?.some(child => child.tag === 'span'));
  }
  assert.ok(!JSON.stringify(saved).includes('otpauth://'));
});

test('structured fields expose separate editable templates with private labels and typed values', () => {
  const nodes = walk(settingsDocumentBlocks(passwordManagerBlocks));
  for (const id of ['password-property-caption', 'password-property-label', 'password-property-input', 'password-property-textarea', 'password-property-checkbox', 'password-property-type', 'password-field-mode']) assert.ok(nodes.some(node => node.id === id));
  const input = nodes.find(node => node.id === 'password-property-input')!;
  assert.deepEqual(input.props?.['data-tt-action-inputs'], { operation: 'field.property', id: '{item.id}', path: '{item.path}', epoch: '{item.epoch}' });
  assert.equal(input.props?.['data-tt-private-control'], '');
  assert.equal(nodes.find(node => node.id === 'password-property-label')?.props?.['data-tt-private-text'], '{item.labelName}');
  const entry = { title: 'Synthetic', passwordType: 'identity' as const, fields: [{ id: 'address', label: 'Address', type: 'address' as const, structured: true, value: JSON.stringify({ city: 'PRIVATE_CITY', PRIVATE_KEY: ['PRIVATE_VALUE', false, 12, null] }) }] };
  const hidden = passwordEntryDisplay(entry), shown = passwordEntryDisplay(entry, { address: true });
  assert.ok(!JSON.stringify([hidden, shown]).includes('PRIVATE_'));
  assert.equal(hidden.fields[0].structured, true);
  assert.equal(hidden.fields[0].properties[0].inputType, 'text');
  assert.equal(hidden.fields[0].properties[1].inputType, 'password');
  assert.equal(shown.fields[0].properties[1].inputType, 'text');
  assert.equal(hidden.fields[0].properties[3].required, true);
  assert.equal(hidden.fields[0].properties[4].readOnly, true);
  const raw = passwordEntryDisplay(entry, {}, {}, { address: true });
  assert.equal(raw.fields[0].structured, false);
  assert.equal(raw.fields[0].inputType, 'password');
});
test('private text slots cannot persist hydrated contents, markup or child blocks', () => {
  const slot = { id: 'label', type: 'element', tag: 'span', props: { 'data-tt-private-text': 'property-label' } };
  assert.doesNotThrow(() => settingsDocumentBlocks([slot]));
  for (const patch of [{ text: 'secret' }, { html: '<b>secret</b>' }, { children: [{ id: 'child', type: 'element', tag: 'span', text: 'secret' }] }, { tag: 'div' }]) assert.throws(() => settingsDocumentBlocks([{ ...slot, ...patch }]), /Private text/);
});
test('older customised password layouts gain property controls once without overwriting authored blocks', () => {
  const original = [{ id: 'password-field', type: 'element' as const, tag: 'div', children: [{ id: 'custom-label', type: 'element' as const, tag: 'p', text: 'My layout' }] }];
  const upgraded = upgradePasswordManagerBlocks(original);
  assert.deepEqual(upgradePasswordManagerBlocks(upgraded), upgraded);
  assert.deepEqual(upgraded[0].children![0], original[0].children[0]);
  assert.equal(upgraded[0].children!.filter(block => block.id === 'password-field-structured').length, 1);
  assert.equal(original[0].children.length, 1);
  assert.doesNotThrow(() => settingsDocumentBlocks(upgraded));
});
