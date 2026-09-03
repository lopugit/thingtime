import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import { sanitizeActionCrystal, validateThingtimeCrystal } from '../../../schemas/registry.ts';
// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import type { LopuProviderEvent, LopuProviderHopInput, LopuProviderToolResult } from './chatEvents.ts';
// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import { chunkJson, createLopuTestProvider, LOPU_TEST_ACTION_KEY, LOPU_TEST_COMPONENT_KEY, LOPU_TEST_MIN_INPUT_CHUNKS, testCardComponent, testPongAction, testSectionBlocks } from './chatTestProvider.ts';
// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import type { LopuActivePage } from './chatTools.ts';

// Drive a provider hop by hop the way chat.ts does, answering every
// tool_use with `answer(call)` and stopping at the first end_turn.
const drive = async (
  userText: string,
  activePage: LopuActivePage | null,
  answer: (call: { id: string; name: string; input: any }) => LopuProviderToolResult = (call) => ({ id: call.id, name: call.name, ok: true, summary: `${call.name} ok`, data: {} })
) => {
  const provider = createLopuTestProvider({ userText, activePage, paceMs: 0 });
  const hops: LopuProviderEvent[][] = [];
  let current: LopuProviderEvent[] = [];
  let pending: Array<{ id: string; name: string; input: any }> = [];
  let feed: LopuProviderHopInput | undefined;
  for (;;) {
    const step = await provider.next(feed);
    feed = undefined;
    if (step.done === true) break;
    current.push(step.value);
    if (step.value.type === 'tool_use') pending.push({ id: step.value.id, name: step.value.name, input: step.value.input });
    if (step.value.type === 'hop_end') {
      hops.push(current);
      current = [];
      if (step.value.stopReason === 'tool_use' && pending.length) {
        feed = { results: pending.map(answer), finalHop: false };
        pending = [];
      }
    }
  }
  return hops;
};

const text = (events: LopuProviderEvent[]) => events.filter((event) => event.type === 'text').map((event: any) => event.text).join('');
const toolUses = (events: LopuProviderEvent[]) => events.filter((event): event is Extract<LopuProviderEvent, { type: 'tool_use' }> => event.type === 'tool_use');
const inputDeltas = (events: LopuProviderEvent[], id: string) =>
  events.filter((event): event is Extract<LopuProviderEvent, { type: 'tool_input_delta' }> => event.type === 'tool_input_delta' && event.id === id);

test('chunkJson splits into at least six chunks that reassemble to the original', () => {
  for (const json of ['{}', JSON.stringify({ a: 1 }), JSON.stringify(testCardComponent('Hi'))]) {
    const chunks = chunkJson(json);
    // a two-character document can only ever be two chunks
    assert.ok(chunks.length >= Math.min(LOPU_TEST_MIN_INPUT_CHUNKS, json.length), `${json.length} chars → ${chunks.length} chunks`);
    assert.equal(chunks.join(''), json);
  }
});

test('the scripted things pass the real crystal gates', () => {
  const component = validateThingtimeCrystal(['component'], testCardComponent('Hello'));
  assert.equal(component.ok, true, JSON.stringify(component));
  const action = sanitizeActionCrystal(testPongAction());
  assert.equal(action.ok, true, JSON.stringify(action));
  const page = validateThingtimeCrystal(['webpage'], { name: 'Lopu test page', blocks: testSectionBlocks(LOPU_TEST_COMPONENT_KEY, 'lopu-abc') });
  assert.equal(page.ok, true, JSON.stringify(page));
});

test('a greeting is text only — one hop, end_turn, no tools', async () => {
  const hops = await drive('hello there', null);
  assert.equal(hops.length, 1);
  assert.equal(toolUses(hops[0]).length, 0);
  assert.match(text(hops[0]), /Lopu/);
  assert.equal((hops[0].at(-1) as any).stopReason, 'end_turn');
});

test('"component" creates the card component with a streamed input, then closes with text', async () => {
  const hops = await drive('make me a card component', null);
  assert.equal(hops.length, 2);
  const [first, second] = hops;
  const starts = first.filter((event) => event.type === 'tool_use_start');
  assert.equal(starts.length, 1);
  const call = toolUses(first)[0];
  assert.equal(call.name, 'create_component');
  assert.equal((call.input as any).componentKey, LOPU_TEST_COMPONENT_KEY);
  const deltas = inputDeltas(first, call.id);
  assert.ok(deltas.length >= LOPU_TEST_MIN_INPUT_CHUNKS, `${deltas.length} deltas`);
  assert.deepEqual(JSON.parse(deltas.map((event) => event.partial).join('')), call.input);
  // the protocol order: start → deltas → tool_use → hop_end(tool_use)
  const types = first.map((event) => event.type);
  assert.ok(types.indexOf('tool_use_start') < types.indexOf('tool_input_delta'));
  assert.ok(types.lastIndexOf('tool_input_delta') < types.indexOf('tool_use'));
  assert.equal((first.at(-1) as any).stopReason, 'tool_use');
  assert.equal(toolUses(second).length, 0);
  assert.match(text(second), new RegExp(LOPU_TEST_COMPONENT_KEY));
  assert.equal((second.at(-1) as any).stopReason, 'end_turn');
});

test('"page" without an active page creates a page; with one open it patches "active"', async () => {
  const fresh = await drive('build me a landing page', null);
  const create = toolUses(fresh[0])[0];
  assert.equal(create.name, 'create_page');
  assert.equal((create.input as any).open, true);
  assert.ok(inputDeltas(fresh[0], create.id).length >= LOPU_TEST_MIN_INPUT_CHUNKS);
  assert.match(text(fresh[1]), /builder/);

  const active: LopuActivePage = { id: 'page-1', source: 'user', name: 'Home', updatedAt: null, blocks: [] };
  const patched = await drive('add a hero section', active, (call) => ({ id: call.id, name: call.name, ok: true, summary: 'ok', data: { pageId: 'page-1', persisted: true } }));
  const patch = toolUses(patched[0])[0];
  assert.equal(patch.name, 'patch_page');
  assert.equal((patch.input as any).target, 'active');
  assert.equal((patch.input as any).ops[0].op, 'insert');
  assert.match(text(patched[1]), /saved/);
});

test('"component" + "page" builds the component first and the page references it', async () => {
  const hops = await drive('make a component and a page for it', null);
  assert.equal(hops.length, 3);
  assert.equal(toolUses(hops[0])[0].name, 'create_component');
  const page = toolUses(hops[1])[0];
  assert.equal(page.name, 'create_page');
  assert.equal(JSON.stringify(page.input).includes(LOPU_TEST_COMPONENT_KEY), true);
  assert.equal(toolUses(hops[2]).length, 0);
});

test('"action" creates the pong action, runs it, and reports the answer', async () => {
  const hops = await drive('make an action that says pong', null, (call) =>
    call.name === 'run_action'
      ? { id: call.id, name: call.name, ok: true, summary: 'ran', data: { result: 'pong: ping', status: 'ok' } }
      : { id: call.id, name: call.name, ok: true, summary: 'created', data: { thing: { id: 'action-1' } } }
  );
  assert.equal(hops.length, 3);
  assert.equal(toolUses(hops[0])[0].name, 'create_action');
  assert.equal((toolUses(hops[0])[0].input as any).crystal.actionKey, LOPU_TEST_ACTION_KEY);
  const run = toolUses(hops[1])[0];
  assert.equal(run.name, 'run_action');
  assert.equal((run.input as any).action, LOPU_TEST_ACTION_KEY);
  assert.match(text(hops[2]), /pong: ping/);
  assert.match(text(hops[2]), /action-1/);
});

test('"delete" calls delete_thing without confirmation and then asks for it', async () => {
  const hops = await drive('please delete thing abc-def-123', null, (call) => ({ id: call.id, name: call.name, ok: false, summary: 'Refused', error: 'Refused: needs confirmation' }));
  assert.equal(hops.length, 2);
  const call = toolUses(hops[0])[0];
  assert.equal(call.name, 'delete_thing');
  assert.deepEqual(call.input, { id: 'abc-def-123', confirmed: false });
  assert.match(text(hops[1]), /yes, delete abc-def-123/);
});

test('a failed tool result is reported honestly instead of claimed', async () => {
  const hops = await drive('make me a page', null, (call) => ({ id: call.id, name: call.name, ok: false, summary: 'Webpages need a name', error: 'Webpages need a name' }));
  assert.match(text(hops[1]), /did not work/);
  assert.doesNotMatch(text(hops[1]), /All done: your new page/);
});

test('a final-hop signal ends the script with text', async () => {
  const provider = createLopuTestProvider({ userText: 'make a page', activePage: null, paceMs: 0 });
  const events: LopuProviderEvent[] = [];
  let feed: LopuProviderHopInput | undefined;
  for (;;) {
    const step = await provider.next(feed);
    feed = undefined;
    if (step.done === true) break;
    events.push(step.value);
    if (step.value.type === 'hop_end' && step.value.stopReason === 'tool_use') {
      feed = { results: [{ id: 'toolu_test_1', name: 'create_page', ok: true, summary: 'ok' }], finalHop: true };
    }
  }
  assert.match(text(events), /tool budget/);
  assert.equal((events.at(-1) as any).stopReason, 'end_turn');
  assert.equal(toolUses(events).length, 1);
});
