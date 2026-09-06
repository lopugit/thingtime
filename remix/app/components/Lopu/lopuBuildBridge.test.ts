import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { isReadOnlyWebpageViewerRoute, isStaleWebpageLanding, mergeSavedWebpage, type ResolvedWebpage, type WebpageTarget } from '../Builder/useWebpage';
import type { ComponentThingLike, ComponentsByRef } from '../Builder/WebpageBlocksRenderer';
import { MAX_BLOCKS, collectBlockIds, countBlocks, findBlock, type WebpageBlock } from '../Builder/webpageBlocks';
import {
  applyLopuPartialComponent,
  applyLopuPartialPageOps,
  applyLopuPatchEvent,
  applyLopuThingEvent,
  applyPageOps,
  describeActiveWebpageDraft,
  discardLopuPartialComponent,
  discardLopuPartialPageOps,
  focusWebpageDraft,
  getActiveWebpageDraft,
  getWebpageDraftsVersion,
  listWebpageDrafts,
  registerWebpageDraft,
  resetLopuBuildBridge,
  resolveLopuDraft,
  subscribeWebpageDrafts,
  type LopuDraftHandle,
  type LopuSavedThingLike
} from './lopuBuildBridge';

// ——— fake drafts: the live-handle contract useWebpageDraft registers ————

type FakeDraft = LopuDraftHandle & {
  state: {
    id: string | null;
    source: 'user' | 'system' | null;
    updatedAt: string | null;
    blocks: WebpageBlock[];
    dirty: boolean;
    componentsByRef: ComponentsByRef;
  };
  calls: {
    setBlocks: WebpageBlock[][];
    addComponent: Array<[string, ComponentThingLike | null]>;
    markSaved: LopuSavedThingLike[];
  };
};

const fakeDraft = (init: {
  id?: string | null;
  editable?: boolean;
  target?: WebpageTarget | null;
  blocks?: WebpageBlock[];
  pageKey?: string | null;
  siteRoute?: string | null;
  source?: 'user' | 'system' | null;
  updatedAt?: string | null;
  name?: string | null;
  componentsByRef?: ComponentsByRef;
} = {}): FakeDraft => {
  const state: FakeDraft['state'] = {
    id: init.id ?? null,
    source: init.source ?? (init.id ? 'user' : null),
    updatedAt: init.updatedAt ?? null,
    blocks: init.blocks || [],
    dirty: false,
    componentsByRef: { ...(init.componentsByRef || {}) }
  };
  const calls: FakeDraft['calls'] = { setBlocks: [], addComponent: [], markSaved: [] };
  const handle = {
    get id() {
      return state.id;
    },
    get source() {
      return state.source;
    },
    get pageKey() {
      return init.pageKey ?? (init.target?.kind === 'global' ? 'site-global' : null);
    },
    get siteRoute() {
      return init.siteRoute ?? (init.target?.kind === 'path' ? init.target.path : null);
    },
    get updatedAt() {
      return state.updatedAt;
    },
    get name() {
      return init.name ?? null;
    },
    get blocks() {
      return state.blocks;
    },
    get dirty() {
      return state.dirty;
    },
    get editable() {
      return init.editable ?? true;
    },
    get target() {
      return init.target ?? (init.id ? { kind: 'id' as const, id: init.id } : null);
    },
    get componentsByRef() {
      return state.componentsByRef;
    },
    setBlocks(next: WebpageBlock[]) {
      state.blocks = next;
      state.dirty = true;
      calls.setBlocks.push(next);
      focusWebpageDraft(handle as unknown as LopuDraftHandle);
    },
    addComponent(ref: string, component: ComponentThingLike | null) {
      state.componentsByRef = { ...state.componentsByRef, [ref]: component };
      calls.addComponent.push([ref, component]);
    },
    markSaved(thing: LopuSavedThingLike) {
      state.dirty = false;
      if (typeof thing.updatedAt === 'string') state.updatedAt = thing.updatedAt;
      if (typeof thing.id === 'string') state.id = thing.id;
      calls.markSaved.push(thing);
    },
    state,
    calls
  };
  return handle as unknown as FakeDraft;
};

const page = (): WebpageBlock[] => [
  {
    id: 'hero',
    type: 'container',
    direction: 'column',
    children: [
      { id: 'hero-title', type: 'text', text: 'Hi', style: 'heading' },
      { id: 'hero-body', type: 'text', text: 'Welcome' }
    ]
  },
  { id: 'cta', type: 'component', component: 'pricing-table' }
];

const textBlock = (id: string, text = id): WebpageBlock => ({ id, type: 'text', text });
const insertOp = (block: WebpageBlock, containerId: string | null = null, index: number | 'end' = 'end') => ({ op: 'insert', containerId, index, block });

const ids = (blocks: WebpageBlock[]) => Array.from(collectBlockIds(blocks));

beforeEach(() => resetLopuBuildBridge());
afterEach(() => resetLopuBuildBridge());

// ——— registry ————————————————————————————————————————————————————————————

test('the most recently registered editable draft is active; unregistering falls back in order', () => {
  assert.equal(getActiveWebpageDraft(), null);
  const a = fakeDraft({ id: 'page-a' });
  const b = fakeDraft({ id: 'page-b' });
  const offA = registerWebpageDraft(a);
  assert.equal(getActiveWebpageDraft(), a);
  const offB = registerWebpageDraft(b);
  assert.equal(getActiveWebpageDraft(), b);
  assert.deepEqual(
    listWebpageDrafts().map((draft) => draft.id),
    ['page-b', 'page-a']
  );
  offB();
  assert.equal(getActiveWebpageDraft(), a);
  // unregistering twice is harmless
  offB();
  assert.equal(getActiveWebpageDraft(), a);
  offA();
  assert.equal(getActiveWebpageDraft(), null);
});

test('read-only drafts (the /p/ viewer) never count as the active draft', () => {
  const editable = fakeDraft({ id: 'page-a' });
  const viewer = fakeDraft({ id: 'page-v', editable: false });
  registerWebpageDraft(editable);
  registerWebpageDraft(viewer);
  assert.equal(getActiveWebpageDraft(), editable);
  assert.equal(resolveLopuDraft({ id: 'page-v' }).draft, null);
  resetLopuBuildBridge();
  registerWebpageDraft(viewer);
  assert.equal(getActiveWebpageDraft(), null);
  assert.equal(describeActiveWebpageDraft(), null);
  assert.deepEqual(resolveLopuDraft('active'), { draft: null, reason: 'no-draft' });
});

test('the site-global draft yields to the page draft until it is the one being edited', () => {
  // SiteBlocksEditor mounts the page draft first, then the global draft
  const pageDraft = fakeDraft({ id: 'route-home', target: { kind: 'path', path: '/' } });
  const globalDraft = fakeDraft({ id: 'site-global', target: { kind: 'global' } });
  registerWebpageDraft(pageDraft);
  registerWebpageDraft(globalDraft);
  assert.equal(getActiveWebpageDraft(), pageDraft, 'untouched: the page draft wins over the global doc');
  globalDraft.setBlocks([textBlock('nav')]);
  assert.equal(getActiveWebpageDraft(), globalDraft, 'editing the global doc makes it the target');
  pageDraft.setBlocks([textBlock('hero')]);
  assert.equal(getActiveWebpageDraft(), pageDraft, 'the most recently edited draft wins');
  // a lone global draft (BuilderCanvas on __global__) is still a target
  resetLopuBuildBridge();
  registerWebpageDraft(globalDraft);
  assert.equal(getActiveWebpageDraft(), globalDraft);
});

test('subscribers are told about registrations, focus and change notices', () => {
  let notified = 0;
  const off = subscribeWebpageDrafts(() => {
    notified += 1;
  });
  const before = getWebpageDraftsVersion();
  const draft = fakeDraft({ id: 'page-a' });
  const unregister = registerWebpageDraft(draft);
  focusWebpageDraft(draft);
  unregister();
  assert.equal(notified, 3);
  assert.ok(getWebpageDraftsVersion() > before);
  off();
  registerWebpageDraft(draft);
  assert.equal(notified, 3, 'an unsubscribed listener stays quiet');
});

test('describeActiveWebpageDraft carries exactly the context.page fields the reply request sends', () => {
  const draft = fakeDraft({
    id: 'page-a',
    source: 'user',
    updatedAt: '2026-09-03T10:00:00.000Z',
    pageKey: 'home',
    siteRoute: '/',
    name: 'Home',
    blocks: page()
  });
  registerWebpageDraft(draft);
  assert.deepEqual(describeActiveWebpageDraft(), {
    id: 'page-a',
    source: 'user',
    pageKey: 'home',
    siteRoute: '/',
    updatedAt: '2026-09-03T10:00:00.000Z',
    blocks: page()
  });
  // an unseeded site draft still describes its binding so the server can
  // apply ops (unpersisted) to the empty draft
  resetLopuBuildBridge();
  registerWebpageDraft(fakeDraft({ target: { kind: 'path', path: '/about' } }));
  assert.deepEqual(describeActiveWebpageDraft(), { siteRoute: '/about', blocks: [] });
});

// ——— applyPageOps (§2.5 grammar) ————————————————————————————————————————

test('applyPageOps: insert at root/end, into a container by index, and refuses non-containers', () => {
  const atEnd = applyPageOps(page(), [insertOp(textBlock('footer'))]);
  assert.deepEqual(atEnd.errors, []);
  assert.equal(atEnd.applied, 1);
  assert.equal(atEnd.blocks[2].id, 'footer');

  const intoHero = applyPageOps(page(), [insertOp(textBlock('eyebrow'), 'hero', 0)]);
  assert.equal(findBlock(intoHero.blocks, 'hero')!.children![0].id, 'eyebrow');

  const past = applyPageOps(page(), [insertOp(textBlock('late'), 'hero', 99)]);
  assert.equal(findBlock(past.blocks, 'hero')!.children!.at(-1)!.id, 'late', 'an index past the end clamps');

  const notContainer = applyPageOps(page(), [insertOp(textBlock('x'), 'cta', 0)]);
  assert.equal(notContainer.applied, 0);
  assert.match(notContainer.errors[0], /only containers hold children/);

  const missing = applyPageOps(page(), [insertOp(textBlock('x'), 'nope', 0)]);
  assert.match(missing.errors[0], /container "nope" is not on the page/);

  const badIndex = applyPageOps(page(), [{ op: 'insert', containerId: null, index: -1, block: textBlock('x') }]);
  assert.match(badIndex.errors[0], /index must be/);
});

test('applyPageOps: update keeps id and type, replace keeps the id and slot, remove and move work on any depth', () => {
  const updated = applyPageOps(page(), [{ op: 'update', id: 'hero-title', patch: { text: 'Hello', id: 'evil', type: 'container' } }]);
  const title = findBlock(updated.blocks, 'hero-title')!;
  assert.equal(title.text, 'Hello');
  assert.equal(title.type, 'text');
  assert.equal(findBlock(updated.blocks, 'evil'), null);

  const replaced = applyPageOps(page(), [
    { op: 'replace', id: 'hero-body', block: { id: 'other', type: 'media', media: 'image', src: 'https://example.com/a.png' } }
  ]);
  assert.deepEqual(replaced.errors, []);
  const hero = findBlock(replaced.blocks, 'hero')!;
  assert.equal(hero.children![1].id, 'hero-body', 'same id, same slot');
  assert.equal(hero.children![1].type, 'media');
  assert.equal(findBlock(replaced.blocks, 'other'), null);

  const removed = applyPageOps(page(), [{ op: 'remove', id: 'hero-body' }, { op: 'remove', id: 'cta' }]);
  assert.equal(removed.applied, 2);
  assert.deepEqual(ids(removed.blocks), ['hero', 'hero-title']);

  const moved = applyPageOps(page(), [{ op: 'move', id: 'cta', containerId: 'hero', index: 0 }]);
  assert.deepEqual(moved.errors, []);
  assert.equal(findBlock(moved.blocks, 'hero')!.children![0].id, 'cta');
  assert.equal(moved.blocks.length, 1);

  const intoSelf = applyPageOps(page(), [{ op: 'move', id: 'hero', containerId: 'hero', index: 0 }]);
  assert.equal(intoSelf.applied, 0);
  assert.match(intoSelf.errors[0], /cannot move/);

  const whole = applyPageOps(page(), [{ op: 'setBlocks', blocks: [textBlock('only')] }]);
  assert.deepEqual(ids(whole.blocks), ['only']);
});

test('applyPageOps: refused ops are reported and skipped, duplicate ids are rewritten, caps hold', () => {
  const mixed = applyPageOps(page(), [
    { op: 'update', id: 'ghost', patch: { text: 'x' } },
    { op: 'teleport', id: 'hero' },
    { op: 'update', id: 'hero-title', patch: 'nope' },
    insertOp(textBlock('after'))
  ]);
  assert.equal(mixed.applied, 1, 'the good op after the bad ones still lands');
  assert.equal(mixed.errors.length, 3);
  assert.match(mixed.errors[0], /^op 0 \(update\): block "ghost" is not on the page/);
  assert.match(mixed.errors[1], /^op 1 \(teleport\): op must be one of insert/);
  assert.match(mixed.errors[2], /^op 2 \(update\): patch must be an object/);
  assert.equal(mixed.blocks.at(-1)!.id, 'after');
  assert.deepEqual(
    mixed.ops.map((op) => op.op),
    ['insert'],
    'the landed ops (ids normalised) are reported for replay'
  );

  const dup = applyPageOps(page(), [insertOp({ id: 'hero', type: 'container', direction: 'row', children: [textBlock('hero-title')] })]);
  assert.deepEqual(dup.errors, []);
  const all = ids(dup.blocks);
  assert.equal(new Set(all).size, all.length, 'every id stays unique');
  assert.equal(countBlocks(dup.blocks), countBlocks(page()) + 2);
  for (const id of all) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);

  // a model's "Bad Id" is normalised into a slug, a made-up type is refused
  const badShape = applyPageOps(page(), [insertOp({ id: 'Bad Id', type: 'text' } as WebpageBlock), insertOp({ id: 'ok', type: 'sparkle' } as any)]);
  assert.equal(badShape.applied, 1);
  assert.match(badShape.errors[0], /^op 1 \(insert\): block\.type must be one of/);
  for (const id of ids(badShape.blocks)) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.equal(countBlocks(badShape.blocks), countBlocks(page()) + 1);

  const notString = applyPageOps(page(), ['insert', 42, null]);
  assert.equal(notString.errors.length, 3);
  assert.match(notString.errors[1], /^op 1: must be an object/);

  const tooMany = applyPageOps([], [{ op: 'setBlocks', blocks: Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => textBlock(`t-${i}`)) }]);
  assert.match(tooMany.errors[0], /exceed/);

  let deep: WebpageBlock = textBlock('leaf');
  for (let level = 0; level < 8; level += 1) deep = { id: `box-${level}`, type: 'container', children: [deep] };
  const tooDeep = applyPageOps([], [insertOp(deep)]);
  assert.match(tooDeep.errors[0], /deeper than/);

  // structure never travels through update — insert/remove/move/replace do that
  const childrenOnText = applyPageOps(page(), [{ op: 'update', id: 'hero-title', patch: { children: [textBlock('x')] } }]);
  assert.match(childrenOnText.errors[0], /cannot rewrite children/);

  const nested = applyPageOps(page(), [
    { op: 'replace', id: 'hero', block: { id: 'hero', type: 'container', direction: 'row', children: [textBlock('cta'), textBlock('fresh')] } }
  ]);
  assert.deepEqual(nested.errors, []);
  const nestedIds = ids(nested.blocks);
  assert.equal(new Set(nestedIds).size, nestedIds.length, 'children that collide with the rest of the tree are rewritten');
  assert.ok(nestedIds.includes('fresh'));
  assert.equal(findBlock(nested.blocks, 'hero')!.direction, 'row');

  // the ops list itself is untrusted input
  assert.deepEqual(applyPageOps(page(), 'nope' as unknown as unknown[]).errors, ['ops must be an array']);
});

// ——— patch events ———————————————————————————————————————————————————————

test('applyLopuPatchEvent paints into the active draft and honours explicit page targets', () => {
  const noDraft = applyLopuPatchEvent({ id: 't1', target: 'active', ops: [insertOp(textBlock('x'))] });
  assert.deepEqual(noDraft, { ok: false, reason: 'no-draft', applied: 0, errors: [] });

  const a = fakeDraft({ id: 'page-a', blocks: page() });
  registerWebpageDraft(a);
  const outcome = applyLopuPatchEvent({ id: 't1', target: 'active', ops: [insertOp(textBlock('footer'))], pageId: 'page-a', persisted: true });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.applied, 1);
  assert.equal(outcome.persisted, true);
  assert.equal(outcome.draft, a);
  assert.equal(a.calls.setBlocks.length, 1);
  assert.equal(a.blocks.at(-1)!.id, 'footer');
  assert.equal(a.dirty, true, 'setBlocks marks the draft dirty until markSaved lands');

  const byId = applyLopuPatchEvent({ id: 't2', target: { id: 'page-a' }, ops: [{ op: 'remove', id: 'cta' }] });
  assert.equal(byId.ok, true);
  assert.equal(findBlock(a.blocks, 'cta'), null);

  // the server applied to a page that is not the one on screen — never
  // paint it into the wrong draft
  const mismatch = applyLopuPatchEvent({ id: 't3', target: 'active', pageId: 'page-b', ops: [insertOp(textBlock('nope'))] });
  assert.deepEqual(mismatch, { ok: false, reason: 'page-mismatch', applied: 0, errors: [] });
  assert.deepEqual(applyLopuPatchEvent({ id: 't4', target: { id: 'page-b' }, ops: [] }).reason, 'page-mismatch');
  assert.equal(a.calls.setBlocks.length, 2);

  const noOps = applyLopuPatchEvent({ id: 't5', target: 'active', ops: 'x' });
  assert.equal(noOps.reason, 'no-ops');

  // a draft still resolving its page (id unknown, target known) is not a
  // tree the server patched — the persisted thing event converges it
  const pending = fakeDraft({ target: { kind: 'id', id: 'page-c' } });
  registerWebpageDraft(pending);
  assert.deepEqual(resolveLopuDraft({ id: 'page-c' }), { draft: null, reason: 'unresolved' });
  assert.equal(applyLopuPatchEvent({ id: 't6', target: { id: 'page-c' }, ops: [insertOp(textBlock('x'))] }).reason, 'unresolved');
  assert.equal(pending.calls.setBlocks.length, 0);
});

test('partial ops paint as they close, never twice, and the final patch replays from the baseline', () => {
  const a = fakeDraft({ id: 'page-a', blocks: page() });
  registerWebpageDraft(a);
  const baseline = a.blocks;
  const ops = [insertOp(textBlock('one')), insertOp(textBlock('two')), insertOp(textBlock('three'))];

  // one element, still open: nothing has closed
  let step = applyLopuPartialPageOps([ops[0]], { id: 'tool-1' });
  assert.deepEqual(step, { ok: true, applied: 0, pending: 1, changed: false });
  assert.equal(a.calls.setBlocks.length, 0);

  // a second element began — the first one closed
  step = applyLopuPartialPageOps([ops[0], { op: 'insert', containerId: null, index: 'end', block: { id: 'two' } }], { id: 'tool-1' });
  assert.equal(step.applied, 1);
  assert.equal(step.changed, true);
  assert.equal(step.pending, 1);
  assert.deepEqual(ids(a.blocks), [...ids(baseline), 'one']);

  // the same fragment again (every delta re-parses): no repaint
  step = applyLopuPartialPageOps([ops[0], ops[1]], { id: 'tool-1' });
  assert.equal(step.changed, false);
  assert.equal(a.calls.setBlocks.length, 1);

  step = applyLopuPartialPageOps(ops, { id: 'tool-1' });
  assert.equal(step.applied, 2);
  assert.deepEqual(ids(a.blocks), [...ids(baseline), 'one', 'two']);

  step = applyLopuPartialPageOps(ops, { id: 'tool-1', complete: true });
  assert.equal(step.applied, 3);
  assert.equal(step.pending, 0);
  assert.deepEqual(ids(a.blocks), [...ids(baseline), 'one', 'two', 'three']);

  // the server's complete event (ids rewritten upstream) replays on the
  // baseline: three blocks, not six
  const final = applyLopuPatchEvent({ id: 'tool-1', target: 'active', ops: [ops[0], ops[1], insertOp(textBlock('three-x'))], persisted: false });
  assert.equal(final.applied, 3);
  assert.deepEqual(ids(a.blocks), [...ids(baseline), 'one', 'two', 'three-x']);
  assert.equal(countBlocks(a.blocks), countBlocks(baseline) + 3);

  // the baseline is gone: another patch with the same id applies on top
  applyLopuPatchEvent({ id: 'tool-1', target: 'active', ops: [insertOp(textBlock('four'))] });
  assert.equal(countBlocks(a.blocks), countBlocks(baseline) + 4);
});

test('partial ops ignore malformed closed ops and revert on discard', () => {
  const a = fakeDraft({ id: 'page-a', blocks: page() });
  registerWebpageDraft(a);
  const baseline = a.blocks;
  const step = applyLopuPartialPageOps([{ op: 'insert', containerId: null, index: 'end', block: { id: 'half' } }, insertOp(textBlock('ok'))], {
    id: 'tool-2'
  });
  assert.equal(step.changed, true);
  assert.equal(step.errors!.length, 1, 'a closed-but-malformed op is reported, not painted');
  assert.equal(findBlock(a.blocks, 'half'), null);

  applyLopuPartialPageOps([{ op: 'insert', containerId: null, index: 'end', block: { id: 'half' } }, insertOp(textBlock('ok'))], {
    id: 'tool-2',
    complete: true
  });
  assert.ok(findBlock(a.blocks, 'ok'));

  assert.equal(discardLopuPartialPageOps('tool-2'), true);
  assert.equal(a.blocks, baseline, 'discard puts the baseline tree back');
  assert.equal(discardLopuPartialPageOps('tool-2'), false);

  // no draft: fragments are reported, nothing pinned
  resetLopuBuildBridge();
  assert.equal(applyLopuPartialPageOps([ops0(), ops0()], { id: 'tool-3' }).reason, 'no-draft');
  assert.equal(applyLopuPartialPageOps('x', { id: 'tool-3' }).reason, 'no-ops');
});

const ops0 = () => insertOp(textBlock('z'));

// ——— thing events ———————————————————————————————————————————————————————

test('component things are pushed under componentKey and id into every mounted draft, read-only included', () => {
  const editable = fakeDraft({ id: 'page-a', blocks: page() });
  const viewer = fakeDraft({ id: 'page-v', editable: false, blocks: page() });
  registerWebpageDraft(editable);
  registerWebpageDraft(viewer);
  const thing = { id: 'cmp-123', thingtime: ['component'], crystal: { componentKey: 'pricing-table', render: { tag: 'div' } } };

  const outcome = applyLopuThingEvent({ type: 'thing', id: 'cmp-123', kind: 'component', thing });
  assert.deepEqual(outcome, { ok: true, kind: 'component', refs: ['pricing-table', 'cmp-123'], marked: 0 });
  for (const draft of [editable, viewer]) {
    assert.deepEqual(
      draft.calls.addComponent.map(([ref]) => ref),
      ['pricing-table', 'cmp-123']
    );
    assert.equal(draft.componentsByRef!['pricing-table'], thing);
    assert.equal(draft.calls.markSaved.length, 0);
  }

  // a bare public thing (no envelope) works too, kind read from thingtime
  const bare = applyLopuThingEvent({ id: 'cmp-9', thingtime: ['component'], crystal: { render: {} } });
  assert.deepEqual(bare.refs, ['cmp-9']);

  // malformed envelopes and crystal-less components never reach a draft
  assert.equal(applyLopuThingEvent({ type: 'thing', id: 'x', kind: 'component' } as any).reason, 'no-thing');
  assert.equal(applyLopuThingEvent({ type: 'thing', kind: 'component', thing: { id: 'no-crystal' } }).reason, 'no-thing');
  assert.equal(editable.calls.addComponent.length, 3);

  // other kinds are acknowledged, not painted
  assert.deepEqual(applyLopuThingEvent({ type: 'thing', kind: 'action', thing: { id: 'act', crystal: {} } }), { ok: true, kind: 'action', refs: [], marked: 0 });
});

test('a persisted webpage thing marks the matching drafts saved and announces thingtime:webpage-saved', () => {
  const events: Array<{ type: string; detail: unknown }> = [];
  const original = (globalThis as any).window;
  (globalThis as any).window = {
    dispatchEvent(event: { type: string; detail: unknown }) {
      events.push({ type: event.type, detail: event.detail });
      return true;
    }
  };
  try {
    const a = fakeDraft({ id: 'page-a', blocks: page(), updatedAt: '2026-09-03T09:00:00.000Z' });
    const b = fakeDraft({ id: 'page-b', blocks: page() });
    const pending = fakeDraft({ target: { kind: 'id', id: 'page-a' } });
    for (const draft of [a, b, pending]) registerWebpageDraft(draft);
    a.setBlocks([...a.blocks, textBlock('footer')]);
    assert.equal(a.dirty, true);

    const thing = {
      id: 'page-a',
      thingtime: ['webpage'],
      crystal: { name: 'Home', pageKey: 'home', siteRoute: '/', blocks: [...page(), textBlock('footer')] },
      updatedAt: '2026-09-03T10:00:00.000Z'
    };
    const outcome = applyLopuThingEvent({ type: 'thing', id: 'page-a', kind: 'webpage', thing });
    assert.deepEqual(outcome, { ok: true, kind: 'webpage', refs: [], marked: 2 });
    assert.equal(a.calls.markSaved.length, 1);
    assert.equal(a.calls.markSaved[0], thing);
    assert.equal(a.dirty, false);
    assert.equal(a.updatedAt, '2026-09-03T10:00:00.000Z');
    assert.equal(pending.calls.markSaved.length, 1, 'a draft still resolving that page adopts the save');
    assert.equal(b.calls.markSaved.length, 0);
    assert.deepEqual(events, [{ type: 'thingtime:webpage-saved', detail: { pageKey: 'home', siteRoute: '/', id: 'page-a', source: 'lopu' } }]);

    // a page nobody has open still announces (site caches invalidate)
    applyLopuThingEvent({ type: 'thing', kind: 'webpage', thing: { id: 'page-new', crystal: { name: 'New', blocks: [] } } });
    assert.equal(events.length, 2);
    assert.deepEqual(events[1].detail, { pageKey: null, siteRoute: null, id: 'page-new', source: 'lopu' });
  } finally {
    if (original === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = original;
  }
});

// ——— partial components ————————————————————————————————————————————————

test('a streaming component rebuilds in place when it is on a mounted page, and the saved thing replaces it', () => {
  const saved: ComponentThingLike = { id: 'cmp-123', crystal: { componentKey: 'pricing-table', name: 'Pricing', render: { tag: 'div' } } };
  const a = fakeDraft({ id: 'page-a', blocks: page(), componentsByRef: { 'pricing-table': saved } });
  const other = fakeDraft({ id: 'page-b', blocks: [textBlock('plain')] });
  registerWebpageDraft(a);
  registerWebpageDraft(other);

  const byId = applyLopuPartialComponent('cmp-123', { tag: 'section' });
  assert.deepEqual(byId, { ok: true, pushed: 1, refs: ['pricing-table'], deferred: false });
  assert.equal(a.calls.addComponent.length, 1);
  const [ref, pushed] = a.calls.addComponent[0];
  assert.equal(ref, 'pricing-table');
  assert.deepEqual(pushed, { id: 'cmp-123', crystal: { componentKey: 'pricing-table', name: 'Pricing', render: { tag: 'section' } } });
  assert.equal(other.calls.addComponent.length, 0, 'pages without the component are untouched');

  // by key, with extra crystal fields from the partial input
  applyLopuPartialComponent('pricing-table', { tag: 'article' }, { crystal: { name: 'Pricing v2' } });
  assert.deepEqual(a.calls.addComponent[1][1]!.crystal, { componentKey: 'pricing-table', name: 'Pricing v2', render: { tag: 'article' } });

  assert.equal(applyLopuPartialComponent('nope', { tag: 'div' }).reason, 'not-on-page');
  assert.equal(applyLopuPartialComponent('', { tag: 'div' }).reason, 'no-ref');
  assert.equal(applyLopuPartialComponent('cmp-123', null).reason, 'no-render');

  // the final thing event swaps in the saved version and clears the partial
  const final = { ...saved, crystal: { ...saved.crystal, render: { tag: 'article', children: [] } } };
  applyLopuThingEvent({ type: 'thing', kind: 'component', thing: final });
  assert.equal(a.componentsByRef!['pricing-table'], final);
  assert.equal(discardLopuPartialComponent('cmp-123'), false, 'nothing left to discard once the thing landed');

  // an abandoned rebuild restores what the page showed before
  applyLopuPartialComponent('cmp-123', { tag: 'broken' });
  assert.notEqual(a.componentsByRef!['pricing-table'], final);
  assert.equal(discardLopuPartialComponent('cmp-123'), true);
  assert.equal(a.componentsByRef!['pricing-table'], final);
});

test('unregistering a draft drops the partial state pinned to it', () => {
  const a = fakeDraft({ id: 'page-a', blocks: page() });
  const off = registerWebpageDraft(a);
  applyLopuPartialPageOps([ops0(), ops0()], { id: 'tool-9' });
  applyLopuPartialComponent('pricing-table', { tag: 'p' });
  off();
  assert.equal(discardLopuPartialPageOps('tool-9'), false);
  assert.equal(discardLopuPartialComponent('pricing-table'), false);
});

// ——— markSaved semantics (the hook's pure halves) ——————————————————————

test('mergeSavedWebpage adopts the saved page as the viewer-owned resolved page', () => {
  const thing = {
    id: 'page-a',
    crystal: { name: 'Home', blocks: [textBlock('hi')] },
    updatedAt: '2026-09-03T10:00:00.000Z',
    acl: ['tt:user', 'tt:all', 7 as unknown as string]
  };
  // nothing resolved yet (the save outran the first resolve)
  assert.deepEqual(mergeSavedWebpage(null, thing), {
    page: { id: 'page-a', crystal: thing.crystal, updatedAt: thing.updatedAt, acl: ['tt:user', 'tt:all'] },
    source: 'user',
    componentsByRef: {}
  });
  const prev: ResolvedWebpage = {
    page: { id: 'page-a', crystal: { name: 'Old', blocks: [] }, author: { id: 'u1' }, updatedAt: '2026-09-03T09:00:00.000Z', acl: ['tt:user'] },
    source: 'system',
    componentsByRef: { 'pricing-table': null }
  };
  const merged = mergeSavedWebpage(prev, thing)!;
  assert.equal(merged.source, 'user');
  assert.equal(merged.page!.updatedAt, thing.updatedAt);
  assert.equal(merged.page!.crystal.name, 'Home');
  assert.deepEqual(merged.page!.author, { id: 'u1' }, 'the author survives when the save carries none');
  assert.deepEqual(merged.page!.acl, ['tt:user', 'tt:all']);
  assert.deepEqual(merged.componentsByRef, prev.componentsByRef);
  // partial saves keep what they do not carry
  const partial = mergeSavedWebpage(prev, { id: 'page-a', updatedAt: '2026-09-03T11:00:00.000Z' })!;
  assert.equal(partial.page!.crystal.name, 'Old');
  assert.equal(partial.page!.updatedAt, '2026-09-03T11:00:00.000Z');
  // nothing to adopt and nothing resolved: stay empty
  assert.equal(mergeSavedWebpage(null, { updatedAt: 'x' }), null);
});

test('isStaleWebpageLanding only flags an older answer for the SAME page', () => {
  const saved = { id: 'page-a', updatedAt: '2026-09-03T10:00:00.000Z' };
  assert.equal(isStaleWebpageLanding(saved, { id: 'page-a', updatedAt: '2026-09-03T09:59:59.000Z' }), true);
  assert.equal(isStaleWebpageLanding(saved, { id: 'page-a', updatedAt: '2026-09-03T10:00:00.000Z' }), false);
  assert.equal(isStaleWebpageLanding(saved, { id: 'page-a', updatedAt: '2026-09-03T10:00:01.000Z' }), false);
  assert.equal(isStaleWebpageLanding(saved, { id: 'page-b', updatedAt: '2026-09-03T09:00:00.000Z' }), false);
  assert.equal(isStaleWebpageLanding(saved, { id: 'page-a' }), false);
  assert.equal(isStaleWebpageLanding(null, { id: 'page-a', updatedAt: '2026-09-03T09:00:00.000Z' }), false);
  assert.equal(isStaleWebpageLanding(saved, null), false);
});

test('only the /p/ viewer route is read-only by default', () => {
  assert.equal(isReadOnlyWebpageViewerRoute('/p/some-page'), true);
  assert.equal(isReadOnlyWebpageViewerRoute('/p/webpage-route-home'), true);
  assert.equal(isReadOnlyWebpageViewerRoute('/builder'), false);
  assert.equal(isReadOnlyWebpageViewerRoute('/builder?page=x'), false);
  assert.equal(isReadOnlyWebpageViewerRoute('/'), false);
  assert.equal(isReadOnlyWebpageViewerRoute('/pokeworld'), false);
  assert.equal(isReadOnlyWebpageViewerRoute('/p'), false);
});
