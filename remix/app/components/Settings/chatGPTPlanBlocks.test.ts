import assert from 'node:assert/strict';
import test from 'node:test';
import { chatGPTPlanBlocks } from './chatGPTPlanBlocks';
import { settingsDocumentBlocks, localSettingsDocumentAdapter } from './settingsDocument';
import { collectBlockIds, duplicateBlock, findBlock, moveBlock, removeBlock, updateBlock, type WebpageBlock } from '../Builder/webpageBlocks';
import { resolveTemplate } from '../ComponentsLibrary/componentTemplate';

const walk = (blocks: WebpageBlock[]): WebpageBlock[] => blocks.flatMap(block => [block, ...walk(block.children || [])]);

test('plan settings are individually editable intrinsic controls, conditional branches and repeated fields', () => {
 const blocks = settingsDocumentBlocks(chatGPTPlanBlocks), all = walk(blocks);
 assert.equal(collectBlockIds(blocks).size, all.length);
 assert.ok(all.length > 80);
 for (const block of all) {
  assert.ok(['element', 'condition', 'collection'].includes(block.type));
  assert.equal(block.source, undefined);
  assert.equal(block.component, undefined);
  assert.equal(block.html, undefined);
 }
 for (const id of ['plan-model-select', 'plan-model-option', 'plan-account-label', 'plan-disconnect-label', 'transfer-file', 'transfer-confirm-origin', 'transfer-confirm-owner'])
  assert.ok(findBlock(blocks, id));
 assert.equal(findBlock(blocks, 'plan-model-options')?.props?.transparent, true);
 assert.ok(findBlock(blocks, 'transfer-confirm-dialog')?.children?.length);
 assert.equal(findBlock(blocks, 'transfer-confirm-dialog')?.props?.open, undefined);
 assert.ok(!JSON.stringify(blocks).includes('authorizationUrl'));
});

test('model option action inputs preserve quoted account identity without string interpolation', () => {
 const node = findBlock(chatGPTPlanBlocks, 'plan-model-select')!;
 const resolved = resolveTemplate({ tag: 'select', props: node.props }, { item: { id: 'a"quoted\\identity', model: 'first', cannotChooseModel: false } });
 assert.equal((resolved as any).props['data-tt-action-inputs'].id, 'a"quoted\\identity');
});

test('normal Builder tree edits persist nested labels, modal contents and repeated fields without live values', async () => {
 let blocks = settingsDocumentBlocks(chatGPTPlanBlocks);
 blocks = updateBlock(blocks, 'plan-disconnect-label', { text: 'Disconnect this connection', css: { color: '#444' } });
 blocks = duplicateBlock(blocks, 'plan-model-option');
 blocks = moveBlock(blocks, 'transfer-confirm-origin', 'transfer-confirm-content', 0);
 blocks = removeBlock(blocks, 'plan-guidance');
 const storage = new Map<string, string>();
 const locks = { request: async (_key: string, _options: unknown, work: () => unknown) => work() } as Pick<LockManager, 'request'>;
 const adapter = localSettingsDocumentAdapter({ origin: 'https://fixture.invalid', ownerId: 'fixture-owner', dataPlane: 'fixture-db', documentKey: 'chatgpt-plan' },
  { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); } }, locks, () => '00000000-0000-4000-8000-000000000001');
 const signal = new AbortController().signal;
 await adapter.save({ blocks, name: 'Custom settings', revision: null }, signal);
 const loaded = await adapter.load(signal);
 assert.equal(findBlock(loaded!.blocks, 'plan-disconnect-label')?.text, 'Disconnect this connection');
 assert.equal(findBlock(loaded!.blocks, 'plan-model-options')?.children?.length, 2);
 assert.equal(findBlock(loaded!.blocks, 'transfer-confirm-content')?.children?.[0].id, 'transfer-confirm-origin');
 assert.equal(findBlock(loaded!.blocks, 'plan-guidance'), null);
 assert.ok(![...storage.values()].join('').includes('synthetic-private-transfer-code'));
});
