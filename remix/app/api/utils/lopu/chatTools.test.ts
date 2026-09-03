import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import { anthropicToolDefinitions, boundToolData, createLopuToolContext, isSiteRelativePath, LOPU_STREAMED_INPUT_TOOLS, LOPU_TOOL_DEFINITIONS, LOPU_TOOL_NAMES, MAX_LOPU_TOOL_INPUT_BYTES, openAiToolDefinitions, runLopuTool, validateLopuToolInput, type LopuToolEvent } from './chatTools.ts';

const viewer = { id: 'user-1', username: 'lopu' };

test('every tool has a definition with an object schema, and the builder tools stream their input', () => {
  assert.equal(LOPU_TOOL_DEFINITIONS.length, LOPU_TOOL_NAMES.length);
  for (const definition of LOPU_TOOL_DEFINITIONS) {
    assert.ok(LOPU_TOOL_NAMES.includes(definition.name), definition.name);
    assert.equal(definition.inputSchema.type, 'object', definition.name);
    assert.ok(definition.description.length > 20, definition.name);
    assert.equal(!!definition.streamInput, LOPU_STREAMED_INPUT_TOOLS.includes(definition.name), definition.name);
  }
  const anthropic = anthropicToolDefinitions();
  for (const tool of anthropic) {
    assert.equal(tool.input_schema.type, 'object');
    assert.equal((tool as any).eager_input_streaming, LOPU_STREAMED_INPUT_TOOLS.includes(tool.name as any) ? true : undefined, tool.name);
  }
  const openai = openAiToolDefinitions();
  assert.equal(openai.length, LOPU_TOOL_NAMES.length);
  assert.equal(openai[0].type, 'function');
  assert.equal(openai.find((tool) => tool.function.name === 'patch_page')?.function.parameters.type, 'object');
});

test('validators refuse unknown tools and oversized inputs with model-readable errors', () => {
  const unknown = validateLopuToolInput('fly', {});
  assert.equal(unknown.ok, false);
  if (unknown.ok === false) assert.match(unknown.error, /Unknown tool "fly"/);
  const huge = validateLopuToolInput('search_things', { query: 'x'.repeat(MAX_LOPU_TOOL_INPUT_BYTES + 1) });
  assert.equal(huge.ok, false);
  if (huge.ok === false) assert.match(huge.error, /exceeds/);
});

test('search/list validators clamp limits and normalise kinds', () => {
  const search = validateLopuToolInput('search_things', { query: '  pricing  ', kinds: ['webpage', ' component '], limit: 999 });
  assert.deepEqual(search, { ok: true, input: { query: 'pricing', kinds: ['webpage', 'component'], limit: 20 } });
  assert.equal(validateLopuToolInput('search_things', {}).ok, false);
  assert.equal(validateLopuToolInput('search_things', { query: 'x', kinds: 'webpage' }).ok, false);
  const list = validateLopuToolInput('list_my_things', { kind: 'webpage' });
  assert.deepEqual(list, { ok: true, input: { kind: 'webpage', limit: 20 } });
  const badKind = validateLopuToolInput('list_my_things', { kind: 'user' });
  assert.equal(badKind.ok, false);
  if (badKind.ok === false) assert.match(badKind.error, /kind must be one of/);
});

test('create_component needs a name, a slug componentKey and a render object', () => {
  const missingRender = validateLopuToolInput('create_component', { name: 'Card', componentKey: 'card' });
  assert.equal(missingRender.ok, false);
  if (missingRender.ok === false) assert.match(missingRender.error, /render must be a render template object/);
  const badKey = validateLopuToolInput('create_component', { name: 'Card', componentKey: 'Card Thing', render: { tag: 'div' } });
  assert.equal(badKey.ok, false);
  if (badKey.ok === false) assert.match(badKey.error, /lowercase-dashed slug/);
  const ok = validateLopuToolInput('create_component', { name: ' Card ', componentKey: 'card', render: { tag: 'div' }, public: true, args: [] });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual({ name: ok.input.name, public: ok.input.public }, { name: 'Card', public: true });
  const nothing = validateLopuToolInput('update_component', { id: 'c1' });
  assert.equal(nothing.ok, false);
  if (nothing.ok === false) assert.match(nothing.error, /Nothing to update/);
});

test('page validators normalise the patch target and reject malformed ops and blocks', () => {
  const patch = validateLopuToolInput('patch_page', { ops: [{ op: 'remove', id: 'x' }] });
  assert.equal(patch.ok, true);
  if (patch.ok) assert.deepEqual(patch.input, { target: 'active', ops: [{ op: 'remove', id: 'x' }], persist: true });
  const noPersist = validateLopuToolInput('patch_page', { target: { id: 'p1' }, ops: [{ op: 'remove', id: 'x' }], persist: false });
  assert.equal(noPersist.ok, true);
  if (noPersist.ok) assert.deepEqual(noPersist.input.target, { id: 'p1' });
  const badOps = validateLopuToolInput('patch_page', { ops: [{ op: 'explode' }] });
  assert.equal(badOps.ok, false);
  if (badOps.ok === false) assert.match(badOps.error, /ops\[0\]\.op must be one of/);
  const badBlocks = validateLopuToolInput('create_page', { name: 'P', blocks: [{ id: 'a', type: 'nope' }] });
  assert.equal(badBlocks.ok, false);
  if (badBlocks.ok === false) assert.match(badBlocks.error, /blocks\[0\]\.type must be one of/);
  const page = validateLopuToolInput('get_page', { id: 'active' });
  assert.equal(page.ok, true);
  if (page.ok) assert.equal(page.input.active, true);
  assert.equal(validateLopuToolInput('get_page', {}).ok, false);
});

test('create_action accepts a crystal wrapper or top-level action fields', () => {
  const wrapped = validateLopuToolInput('create_action', { crystal: { name: 'Pong', steps: [] } });
  assert.equal(wrapped.ok, true);
  const flat = validateLopuToolInput('create_action', { name: 'Pong', steps: [{ op: 'return', value: 1 }] });
  assert.equal(flat.ok, true);
  if (flat.ok) assert.equal((flat.input.crystal as any).name, 'Pong');
  assert.equal(validateLopuToolInput('create_action', { name: 'no steps' }).ok, false);
});

test('navigate only accepts site-relative paths', () => {
  assert.equal(isSiteRelativePath('/builder?page=abc'), true);
  assert.equal(isSiteRelativePath('//evil.example'), false);
  assert.equal(isSiteRelativePath('/\\evil.example'), false);
  assert.equal(isSiteRelativePath('https://evil.example'), false);
  assert.equal(isSiteRelativePath('/p/<script>'), false);
  const bad = validateLopuToolInput('navigate', { path: 'https://evil.example' });
  assert.equal(bad.ok, false);
  if (bad.ok === false) assert.match(bad.error, /site-relative/);
});

test('delete_thing defaults confirmed to false and the executor refuses without touching the server', async () => {
  const validated = validateLopuToolInput('delete_thing', { id: 'thing-1' });
  assert.deepEqual(validated, { ok: true, input: { id: 'thing-1', confirmed: false } });
  const events: LopuToolEvent[] = [];
  const ctx = createLopuToolContext(viewer, null, (event) => events.push(event));
  const result = await runLopuTool({ id: 't1', name: 'delete_thing', input: { id: 'thing-1', confirmed: 'yes' } }, ctx);
  assert.equal(result.ok, false);
  if (result.ok === false) assert.match(result.error, /explicit confirmation/);
  assert.deepEqual(events, []);
});

test('navigate, list_demos and get_demo run without a database and emit the right events', async () => {
  const events: LopuToolEvent[] = [];
  const ctx = createLopuToolContext(viewer, { route: '/builder' }, (event) => events.push(event));
  const nav = await runLopuTool({ id: 'call-nav', name: 'navigate', input: { path: '/components/pricing-card' } }, ctx);
  assert.equal(nav.ok, true);
  assert.deepEqual(events, [{ type: 'navigate', id: 'call-nav', path: '/components/pricing-card' }]);

  const demos = await runLopuTool({ id: 'call-demos', name: 'list_demos', input: { kind: 'section', limit: 5 } }, ctx);
  assert.equal(demos.ok, true);
  if (demos.ok) {
    const data = demos.data as any;
    assert.ok(Array.isArray(data.demos) && data.demos.length > 0 && data.demos.length <= 5);
    assert.ok(data.demos.every((demo: any) => demo.kind === 'section' && typeof demo.slug === 'string'));
    assert.ok(Array.isArray(data.suites) && data.suites.some((suite: any) => suite.key === 'guestbook'));
    const demo = await runLopuTool({ id: 'call-demo', name: 'get_demo', input: { slug: data.demos[0].slug } }, ctx);
    assert.equal(demo.ok, true);
    if (demo.ok) assert.ok(Array.isArray((demo.data as any).crystal.blocks));
  }
  const missing = await runLopuTool({ id: 'call-missing', name: 'get_demo', input: { slug: 'definitely-not-a-demo' } }, ctx);
  assert.equal(missing.ok, false);
  if (missing.ok === false) assert.match(missing.error, /No demo has the slug/);
});

test('createLopuToolContext seeds the active page from the request context', () => {
  const none = createLopuToolContext(viewer, { route: '/lopu' }, () => {});
  assert.equal(none.activePage, null);
  const owned = createLopuToolContext(viewer, { page: { id: 'p1', source: 'user', updatedAt: '2026-09-03T00:00:00.000Z', blocks: [{ id: 'a', type: 'text', text: 'x' }] } }, () => {});
  assert.equal(owned.activePage?.source, 'user');
  assert.equal(owned.activePage?.blocks.length, 1);
  const shared = createLopuToolContext(viewer, { page: { id: 'p2', source: 'system', blocks: [] } }, () => {});
  assert.equal(shared.activePage?.source, 'system');
  const draft = createLopuToolContext(viewer, { page: { blocks: [] } }, () => {});
  assert.equal(draft.activePage?.source, 'draft');
  assert.equal(draft.activePage?.id, null);
});

test('boundToolData shrinks oversized payloads and drops render trees before truncating', () => {
  const small = { a: 1 };
  assert.equal(boundToolData(small), small);
  // a wide-but-shallow tree survives the first ladder step (lists trimmed)
  const wide = { name: 'x', render: { tag: 'div', children: Array.from({ length: 4000 }, (_, index) => ({ tag: 'span', children: [`item ${index}`] })) } };
  const trimmed = boundToolData(wide) as any;
  assert.ok(JSON.stringify(trimmed).length <= 16 * 1024);
  assert.equal(typeof trimmed.render, 'object');
  assert.ok(trimmed.render.children.length <= 61);
  // a deep tree that stays too big after trimming loses its render tree
  const deep = {
    name: 'x',
    render: { tag: 'div', children: Array.from({ length: 40 }, (_, row) => ({ tag: 'div', children: Array.from({ length: 40 }, (_, col) => ({ tag: 'span', children: [`cell ${row}-${col}`] })) })) }
  };
  const bounded = boundToolData(deep) as any;
  assert.ok(JSON.stringify(bounded).length <= 16 * 1024);
  assert.match(String(bounded.render), /render tree omitted/);
  const longStrings = { notes: Array.from({ length: 200 }, () => 'y'.repeat(2000)) };
  const shrunk = boundToolData(longStrings) as any;
  assert.ok(JSON.stringify(shrunk).length <= 16 * 1024);
  assert.ok(Array.isArray(shrunk.notes));
});
