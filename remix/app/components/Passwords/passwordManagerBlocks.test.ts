import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordManagerBlocks, passwordSignInBlocks } from './passwordManagerBlocks';
import { passwordEntryDisplay } from './passwordEntryDisplay';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import type { WebpageBlock } from '../Builder/webpageBlocks';
const walk = (blocks: WebpageBlock[]): WebpageBlock[] => blocks.flatMap(block => [block, ...walk(block.children || [])]);
test('password layouts retain independently editable controls and repeated field/card templates', () => {
  for (const blocks of [passwordManagerBlocks, passwordSignInBlocks]) {
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
