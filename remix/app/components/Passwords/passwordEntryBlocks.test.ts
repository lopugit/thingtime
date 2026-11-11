import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordEntryBlocks, passwordTransferBlocks } from './passwordEntryBlocks';
import { passwordAttachmentBlocks, passwordSourceBlocks } from './passwordPanelBlocks';
import { passwordWorkspaceBlocks } from './PasswordWorkspaceControls';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import { passwordEntryDisplay } from './passwordEntryDisplay';
import type { WebpageBlock } from '../Builder/webpageBlocks';
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
