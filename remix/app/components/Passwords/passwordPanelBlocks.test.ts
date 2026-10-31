import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordAttachmentBlocks, passwordAttachmentItems, passwordSourceBlocks } from './passwordPanelBlocks';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import type { SavedPasswordFile } from '~/passwords/files.client';

test('attachment display projection excludes encryption material and future private fields', () => {
  const file = { id: 'synthetic-file', entryId: 'private-entry', metadata: {
    name: 'document.txt', size: 17, archivePath: 'files/document.txt', key: 'SYNTHETIC-PRIVATE-FILE-KEY',
    noncePrefix: 'SYNTHETIC-PRIVATE-NONCE', futurePrivateField: 'SYNTHETIC-PRIVATE-FIELD'
  }, futurePrivateEnvelope: 'SYNTHETIC-PRIVATE-ENVELOPE' } as unknown as SavedPasswordFile;
  assert.deepEqual(passwordAttachmentItems([file]), [{ id: 'synthetic-file', name: 'files/document.txt', size: '17' }]);
});

test('password panels use valid editable templates with no persisted live field values', () => {
  const walk = (blocks: WebpageBlock[]): WebpageBlock[] => blocks.flatMap(block => [block, ...walk(block.children || [])]);
  for (const document of [passwordAttachmentBlocks, passwordSourceBlocks]) {
    const safe = settingsDocumentBlocks(document);
    const nodes = walk(safe);
    assert.equal(new Set(nodes.map(node => node.id)).size, nodes.length, 'nested labels and controls need distinct Builder identities');
    assert.ok(nodes.some(node => node.type === 'collection' && node.children?.length));
    assert.ok(nodes.some(node => node.type === 'element' && node.tag === 'button'));
    for (const node of nodes.filter(node => ['input', 'textarea'].includes(node.tag || ''))) {
      assert.equal('value' in (node.props || {}), false);
      assert.equal('defaultValue' in (node.props || {}), false);
      assert.equal(node.text, '');
    }
  }
  const sourceNodes = walk(settingsDocumentBlocks(passwordSourceBlocks));
  assert.ok(sourceNodes.some(node => node.id === 'source-history-value' && node.props?.['data-tt-private-control'] === ''));
  assert.ok(sourceNodes.some(node => node.id === 'source-item-visible' && node.condition?.arg === 'source.showItem'));
});
