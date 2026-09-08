import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import { MAX_BLOCKS, type WebpageBlock } from '../../../components/Builder/webpageBlocks.ts';
// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import { applyPageOps, MAX_PAGE_OPS, summarizeBlocks, validatePageOps, validatePatchTarget, type PageOp } from './pageOps.ts';

const page = (): WebpageBlock[] => [
  { id: 'title', type: 'text', text: 'Hello', style: 'heading' },
  {
    id: 'hero',
    type: 'container',
    direction: 'column',
    gap: 4,
    children: [
      { id: 'hero-copy', type: 'text', text: 'Welcome' },
      { id: 'hero-cta', type: 'component', component: 'thingtime-button-solid', args: { label: 'Go' } }
    ]
  },
  { id: 'empty-box', type: 'container', direction: 'row' }
];

const ids = (blocks: WebpageBlock[]): string[] => blocks.flatMap((block) => [block.id, ...(block.children ? ids(block.children) : [])]);

test('validatePageOps accepts every op shape and rejects malformed ones with model-readable errors', () => {
  const ok = validatePageOps([
    { op: 'insert', containerId: null, index: 'end', block: { id: 'a', type: 'text', text: 'x' } },
    { op: 'insert', containerId: 'hero', index: 0, block: { id: 'b', type: 'container', direction: 'row', children: [] } },
    { op: 'update', id: 'title', patch: { text: 'Hi' } },
    { op: 'replace', id: 'hero-copy', block: { id: 'whatever', type: 'text', text: 'Replaced' } },
    { op: 'remove', id: 'empty-box' },
    { op: 'move', id: 'hero-cta', containerId: null, index: 0 },
    { op: 'setBlocks', blocks: [{ id: 'only', type: 'text', text: 'solo' }] }
  ]);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.ops.length, 7);
    assert.deepEqual(ok.ops[0], { op: 'insert', containerId: null, index: 'end', block: { id: 'a', type: 'text', text: 'x' } });
  }

  const cases: Array<[unknown, RegExp]> = [
    [null, /list of patch operations/],
    [[], /empty/],
    [[{ op: 'teleport' }], /ops\[0\]\.op must be one of/],
    [[{ op: 'insert', containerId: 12, index: 0, block: { id: 'a', type: 'text' } }], /containerId/],
    [[{ op: 'insert', containerId: null, index: -1, block: { id: 'a', type: 'text' } }], /index/],
    [[{ op: 'insert', containerId: null, index: 0, block: { id: 'a', type: 'sparkle' } }], /type must be one of/],
    [[{ op: 'insert', containerId: null, index: 0, block: { id: 'a', type: 'text', children: [] } }], /only containers hold children/],
    [[{ op: 'update', id: 'title', patch: { children: [] } }], /cannot rewrite children/],
    [[{ op: 'update', id: 'title', patch: 'nope' }], /patch must be an object/],
    [[{ op: 'remove' }], /id must be a block id/],
    [[{ op: 'move', id: 'x', containerId: null, index: 'end' }], /index must be a non-negative integer/],
    [[{ op: 'setBlocks', blocks: {} }], /blocks must be a list/],
    [Array.from({ length: MAX_PAGE_OPS + 1 }, () => ({ op: 'remove', id: 'x' })), /at most/]
  ];
  for (const [input, pattern] of cases) {
    const result = validatePageOps(input);
    assert.equal(result.ok, false, JSON.stringify(input).slice(0, 80));
    if (result.ok === false) assert.match(result.error, pattern);
  }
});

test('validatePatchTarget accepts active, an id object and a bare id', () => {
  assert.deepEqual(validatePatchTarget(undefined), { ok: true, target: 'active' });
  assert.deepEqual(validatePatchTarget('active'), { ok: true, target: 'active' });
  assert.deepEqual(validatePatchTarget({ id: ' page-1 ' }), { ok: true, target: { id: 'page-1' } });
  assert.deepEqual(validatePatchTarget('page-1'), { ok: true, target: { id: 'page-1' } });
  assert.equal(validatePatchTarget({ id: 'has space' }).ok, false);
  assert.equal(validatePatchTarget(42).ok, false);
});

test('insert lands at the root, at "end", and inside containers that have no children key yet', () => {
  const result = applyPageOps(page(), [
    { op: 'insert', containerId: null, index: 0, block: { id: 'eyebrow', type: 'text', text: 'New', style: 'eyebrow' } },
    { op: 'insert', containerId: 'hero', index: 'end', block: { id: 'hero-note', type: 'text', text: 'note' } },
    { op: 'insert', containerId: 'empty-box', index: 'end', block: { id: 'boxed', type: 'text', text: 'in the box' } }
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.applied, 3);
  assert.equal(result.blocks[0].id, 'eyebrow');
  const hero = result.blocks.find((block) => block.id === 'hero')!;
  assert.deepEqual(hero.children!.map((block) => block.id), ['hero-copy', 'hero-cta', 'hero-note']);
  const box = result.blocks.find((block) => block.id === 'empty-box')!;
  assert.deepEqual(box.children!.map((block) => block.id), ['boxed']);
  // the broadcast ops carry the resolved numeric index
  assert.deepEqual(result.ops[1], { op: 'insert', containerId: 'hero', index: 2, block: { id: 'hero-note', type: 'text', text: 'note' } });
});

test('a failing op is skipped and reported while the rest still apply', () => {
  const result = applyPageOps(page(), [
    { op: 'insert', containerId: 'nope', index: 0, block: { id: 'x', type: 'text', text: 'x' } },
    { op: 'insert', containerId: 'title', index: 0, block: { id: 'y', type: 'text', text: 'y' } },
    { op: 'update', id: 'ghost', patch: { text: 'boo' } },
    { op: 'remove', id: 'title' }
  ]);
  assert.equal(result.applied, 1);
  assert.equal(result.errors.length, 3);
  assert.match(result.errors[0], /container "nope" is not on the page/);
  assert.match(result.errors[1], /"title" is a text block/);
  assert.match(result.errors[2], /"ghost" is not on the page/);
  assert.deepEqual(result.ops, [{ op: 'remove', id: 'title' }]);
  assert.equal(result.blocks.some((block) => block.id === 'title'), false);
});

test('update keeps id and type, replace keeps the id, remove/move restructure', () => {
  const result = applyPageOps(page(), [
    { op: 'update', id: 'title', patch: { text: 'Changed', id: 'hacked', type: 'container' } as Partial<WebpageBlock> },
    { op: 'replace', id: 'hero-copy', block: { id: 'renamed', type: 'text', text: 'Replaced', style: 'eyebrow' } },
    { op: 'move', id: 'hero-cta', containerId: null, index: 0 },
    { op: 'remove', id: 'empty-box' }
  ]);
  assert.deepEqual(result.errors, []);
  assert.equal(result.applied, 4);
  assert.deepEqual(result.blocks[0], { id: 'hero-cta', type: 'component', component: 'thingtime-button-solid', args: { label: 'Go' } });
  assert.deepEqual(result.blocks[1], { id: 'title', type: 'text', text: 'Changed', style: 'heading' });
  const hero = result.blocks[2];
  assert.equal(hero.id, 'hero');
  assert.deepEqual(hero.children, [{ id: 'hero-copy', type: 'text', text: 'Replaced', style: 'eyebrow' }]);
  assert.equal(result.blocks.length, 3);
  // the update op broadcast never carries the id/type it was asked to smuggle
  assert.deepEqual(result.ops[0], { op: 'update', id: 'title', patch: { text: 'Changed' } });
});

test('move refuses its own subtree and unknown/non-container targets', () => {
  const result = applyPageOps(page(), [
    { op: 'move', id: 'hero', containerId: 'hero', index: 0 },
    { op: 'move', id: 'title', containerId: 'hero-copy', index: 0 },
    { op: 'move', id: 'title', containerId: 'missing', index: 0 },
    { op: 'move', id: 'title', containerId: 'empty-box', index: 0 }
  ]);
  assert.equal(result.applied, 1);
  assert.equal(result.errors.length, 3);
  const box = result.blocks.find((block) => block.id === 'empty-box')!;
  assert.deepEqual(box.children!.map((block) => block.id), ['title']);
});

test('duplicate and invalid ids are rewritten to unique lowercase slugs — and the broadcast ops carry the rewrite', () => {
  const result = applyPageOps(page(), [
    { op: 'insert', containerId: null, index: 'end', block: { id: 'title', type: 'text', text: 'dup' } },
    { op: 'insert', containerId: null, index: 'end', block: { id: 'Hero Title!', type: 'text', text: 'bad slug' } },
    {
      op: 'insert',
      containerId: null,
      index: 'end',
      block: { id: 'twins', type: 'container', direction: 'row', children: [{ id: 'twin', type: 'text', text: 'a' }, { id: 'twin', type: 'text', text: 'b' }] }
    }
  ]);
  assert.deepEqual(result.errors, []);
  const all = ids(result.blocks);
  assert.equal(new Set(all).size, all.length, 'ids are unique');
  for (const id of all) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/, id);
  const inserted = result.ops.map((op) => (op.op === 'insert' ? op.block.id : ''));
  assert.notEqual(inserted[0], 'title');
  assert.match(inserted[0], /^title-/);
  assert.match(inserted[1], /^hero-title-/);
  const twins = result.blocks.find((block) => block.id === 'twins')!;
  assert.equal(twins.children![0].id, 'twin');
  assert.match(twins.children![1].id, /^twin-/);
});

test('the block cap holds for insert, replace and setBlocks', () => {
  const many = Array.from({ length: MAX_BLOCKS }, (_, index) => ({ id: `b-${index}`, type: 'text' as const, text: 'x' }));
  const full = applyPageOps([], [{ op: 'setBlocks', blocks: many }]);
  assert.equal(full.applied, 1);
  const over = applyPageOps(full.blocks, [{ op: 'insert', containerId: null, index: 'end', block: { id: 'one-more', type: 'text', text: 'x' } }]);
  assert.equal(over.applied, 0);
  assert.match(over.errors[0], /exceed/);
  const tooMany = applyPageOps([], [{ op: 'setBlocks', blocks: [...many, { id: 'extra', type: 'text', text: 'x' }] }]);
  assert.equal(tooMany.applied, 0);
});

test('replaying the broadcast ops on the original tree reproduces the server result (client parity)', () => {
  const ops: PageOp[] = [
    { op: 'insert', containerId: null, index: 'end', block: { id: 'title', type: 'text', text: 'dup' } },
    { op: 'insert', containerId: 'hero', index: 'end', block: { id: 'hero-copy', type: 'text', text: 'dup child' } },
    { op: 'update', id: 'title', patch: { text: 'Updated' } },
    { op: 'move', id: 'hero-cta', containerId: 'empty-box', index: 0 },
    { op: 'replace', id: 'hero-copy', block: { id: 'x', type: 'text', text: 'new copy' } }
  ];
  const server = applyPageOps(page(), ops);
  assert.deepEqual(server.errors, []);
  const client = applyPageOps(page(), server.ops);
  assert.deepEqual(client.errors, []);
  assert.deepEqual(client.blocks, server.blocks);
});

test('summarizeBlocks lists every block with depth, type and a short hint', () => {
  const summary = summarizeBlocks(page());
  assert.match(summary, /^- title \(text\/heading\) "Hello"/m);
  assert.match(summary, /^- hero \(container\/column\)/m);
  assert.match(summary, /^ {2}- hero-cta \(component\) component=thingtime-button-solid/m);
  assert.match(summary, /^- empty-box \(container\/row\)/m);
  assert.equal(summarizeBlocks([]), '(empty page — no blocks yet)');
  const capped = summarizeBlocks(page(), 2);
  assert.match(capped, /3 more block\(s\)/);
});
