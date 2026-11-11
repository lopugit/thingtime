import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordEntryBlocks, passwordTransferBlocks } from './passwordEntryBlocks';
import { passwordAttachmentBlocks, passwordAttachmentItems, passwordSourceBlocks } from './passwordPanelBlocks';
import { passwordWorkspaceBlocks } from './PasswordWorkspaceControls';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import { passwordEntryDisplay } from './passwordEntryDisplay';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import type { SavedPasswordFile } from '~/passwords/storage';
const flatten = (blocks: WebpageBlock[]): WebpageBlock[] => blocks.flatMap(block => [block, ...flatten(block.children || [])]);
test('password surfaces contain independently editable intrinsic blocks and survive canonical persistence', () => {
  for (const blocks of [passwordEntryBlocks, passwordTransferBlocks, passwordAttachmentBlocks, passwordSourceBlocks, ...Object.values(passwordWorkspaceBlocks)]) {
    const saved = settingsDocumentBlocks(blocks);
    assert.deepEqual(settingsDocumentBlocks(saved), saved);
    const nodes = flatten(saved);
    assert.ok(nodes.length > 1);
    assert.ok(nodes.every(block => !block.html && !block.source));
    assert.ok(nodes.every(block => ['element', 'condition', 'collection'].includes(block.type)));
    for (const block of nodes) if (block.props?.['data-tt-private-control'] !== undefined) {
      for (const key of ['value', 'defaultValue', 'default-value']) assert.equal(block.props?.[key], undefined);
    }
  }
});
test('display projection contains control identities and property types without decrypted values, names, or source archives', () => {
  const entry = { title: 'private title', passwordType: 'identity' as const, onePassword: '{"source":"private archive"}', fields: [{ id: 'address', label: 'Address', type: 'address' as const, structured: true, value: '{"city":"private city","privateMemberName":"private value"}', sourcePath: ['private', 'source'] }] };
  const display = JSON.stringify(passwordEntryDisplay(entry));
  for (const secret of ['private title', 'private archive', 'private city', 'privateMemberName', 'private value', 'sourcePath']) assert.ok(!display.includes(secret));
  assert.ok(display.includes('property-address-0'));
});
test('device attachment availability disables downloads without projecting encrypted keys', () => {
  const files: SavedPasswordFile[] = [{ id: 'file', available: false, metadata: {
    version: 1, token: 'private-token', name: 'Document', size: 2, key: 'private-key', nonce: 'private-nonce'
  } }];
  const projected = passwordAttachmentItems(files);
  assert.equal(projected[0].downloadDisabled, true);
  assert.equal(projected[0].availabilityLabel, 'Not available offline yet');
  for (const value of ['private-token', 'private-key', 'private-nonce']) assert.ok(!JSON.stringify(projected).includes(value));
  assert.equal(passwordAttachmentItems([{ ...files[0], available: true }])[0].downloadDisabled, false);
  assert.equal(passwordAttachmentItems([{ ...files[0], available: true }], true)[0].downloadDisabled, true);
  const blocks = flatten(passwordAttachmentBlocks);
  assert.equal(blocks.find(block => block.id === 'attachment-download')?.props?.disabled, '{item.downloadDisabled}');
  assert.ok(blocks.some(block => block.id === 'attachment-list-status' && block.props?.role === 'status'));
});
test('editable workspace preserves local status and an explicit vault lock action', () => {
  const toolbar = flatten(passwordWorkspaceBlocks.toolbar);
  assert.equal(toolbar.find(block => block.id === 'pw-session')?.text, '{workspace.sessionLabel}');
  const lock = toolbar.find(block => block.id === 'pw-lock');
  assert.deepEqual(lock?.props?.['data-tt-action-inputs'], { operation: 'password.lock' });
  assert.equal(lock?.props?.disabled, false);
});
