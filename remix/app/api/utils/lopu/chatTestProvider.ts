// The scripted provider behind LOPU_CHAT_PROVIDER=test. It speaks the same
// provider protocol as Claude/ChatGPT (chatEvents.ts LopuProviderStream) so
// the real tool loop executes REAL tools against the viewer's things — this
// is what verify-lopu.mjs and the browser checklist run on a machine with no
// AI keys. Deterministic: the latest user text picks a script by keyword,
// tool inputs stream in ≥ 6 tool_input_delta chunks so live previews render,
// and every hop ends exactly like a provider hop would.

import type { LopuProviderEvent, LopuProviderStream, LopuProviderToolResult } from './chatEvents';
import type { LopuActivePage, LopuToolName } from './chatTools';

export const LOPU_TEST_COMPONENT_KEY = 'lopu-test-card';
export const LOPU_TEST_ACTION_KEY = 'lopu-pong';
export const LOPU_TEST_MIN_INPUT_CHUNKS = 6;

export type LopuTestProviderInput = {
  userText: string;
  activePage: LopuActivePage | null;
  // ms between streamed chunks; 0 in tests, a gentle pace live
  paceMs?: number;
};

type ToolPlan = { name: LopuToolName; input: Record<string, unknown> };
type Hop = { text?: string; tools: ToolPlan[] };
type HopBuilder = (results: LopuProviderToolResult[], previous: LopuProviderToolResult[][]) => Hop;

const sleep = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

const chunkWords = (text: string): string[] => text.match(/\S+\s*/g) || [text];

// Split a JSON document into at least `min` chunks, cutting at arbitrary
// character offsets (exactly what a real provider does — chunk boundaries
// land inside strings and numbers, which is what parsePartialJson is for).
export const chunkJson = (json: string, min = LOPU_TEST_MIN_INPUT_CHUNKS): string[] => {
  const size = Math.max(1, Math.ceil(json.length / Math.max(min, Math.ceil(json.length / 40))));
  const chunks: string[] = [];
  for (let offset = 0; offset < json.length; offset += size) chunks.push(json.slice(offset, offset + size));
  while (chunks.length < min && chunks.some((chunk) => chunk.length > 1)) {
    const index = chunks.findIndex((chunk) => chunk.length > 1);
    const chunk = chunks[index];
    const half = Math.ceil(chunk.length / 2);
    chunks.splice(index, 1, chunk.slice(0, half), chunk.slice(half));
  }
  return chunks;
};

// --- the scripted things ---------------------------------------------------

export const testCardComponent = (title: string): Record<string, unknown> => ({
  name: 'Lopu test card',
  componentKey: LOPU_TEST_COMPONENT_KEY,
  description: 'A small card Lopu builds in test mode — title arg, soft border, one line of copy.',
  category: 'cards',
  args: [
    { name: 'title', type: 'string', label: 'Title', default: title, maxLength: 80 },
    { name: 'body', type: 'text', label: 'Body', default: 'Built live by Lopu 🦄', maxLength: 400 }
  ],
  render: {
    tag: 'div',
    props: { style: { padding: '16px 18px', borderRadius: '14px', border: '1px solid #e2e8f0', background: '#ffffff', display: 'flex', flexDirection: 'column', gap: '6px' } },
    children: [
      { tag: 'h3', props: { style: { margin: 0, fontSize: '18px', fontWeight: 700 } }, children: ['{title}'] },
      { tag: 'p', props: { style: { margin: 0, color: '#4a5568', fontSize: '14px' } }, children: ['{body}'] }
    ]
  }
});

export const testSectionBlocks = (componentRef: string, prefix: string) => [
  {
    id: `${prefix}-section`,
    type: 'container',
    direction: 'column',
    gap: 4,
    align: 'center',
    children: [
      { id: `${prefix}-heading`, type: 'text', text: 'Hello from Lopu ✨', style: 'heading', align: 'center' },
      { id: `${prefix}-copy`, type: 'text', text: 'This section was streamed into the page block by block while the reply was still being written.', style: 'body', align: 'center', maxWidth: 560 },
      { id: `${prefix}-card`, type: 'component', component: componentRef, args: { title: 'A tiny card' } }
    ]
  }
];

export const testPongAction = (): Record<string, unknown> => ({
  name: 'Pong',
  actionKey: LOPU_TEST_ACTION_KEY,
  description: 'Echoes a message back with a pong prefix — the smallest possible action.',
  category: 'utilities',
  inputs: [{ name: 'message', type: 'string', label: 'Message', default: 'ping', maxLength: 200 }],
  steps: [
    { op: 'compute', value: { ttConcat: ['pong: ', '$input.message'] } },
    { op: 'return', value: '$step.1' }
  ],
  limits: { timeoutMs: 2000, maxOperations: 4 }
});

const idIn = (text: string): string | null => {
  // a thing id mentioned in the message (uuid-ish or a lowercase-dashed slug
  // with at least two dashes), else null
  const uuid = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuid) return uuid[0];
  const slug = text.match(/\b[a-z0-9]+(?:-[a-z0-9]+){2,}\b/);
  return slug ? slug[0] : null;
};

const dataOf = (result: LopuProviderToolResult | undefined): Record<string, any> => (result && result.ok && result.data && typeof result.data === 'object' ? (result.data as Record<string, any>) : {});

const failureLine = (result: LopuProviderToolResult | undefined): string | null =>
  result && !result.ok ? `Hmm — ${result.name} did not work: ${result.error || result.summary}.` : null;

const buildScript = (userText: string, activePage: LopuActivePage | null): HopBuilder[] => {
  const text = userText.toLowerCase();
  const wantsComponent = text.includes('component');
  const wantsPage = text.includes('page') || text.includes('section') || text.includes('hero');
  const wantsAction = text.includes('action');
  const wantsDelete = text.includes('delete');

  if (wantsDelete) {
    const id = idIn(userText) || 'the-thing-you-mentioned';
    return [
      () => ({ text: 'Let me check that delete for you… ', tools: [{ name: 'delete_thing', input: { id, confirmed: false } }] }),
      (results) => ({
        text: `I did not delete anything yet — ${results[0]?.ok ? 'that went through' : 'deleting needs your say-so'}. Reply "yes, delete ${id}" and I will remove it for good 🗑️`,
        tools: []
      })
    ];
  }

  if (wantsAction) {
    return [
      () => ({ text: 'Spinning up a tiny pong action… ', tools: [{ name: 'create_action', input: { crystal: testPongAction() } }] }),
      (results) =>
        results[0]?.ok
          ? { text: 'Now let me run it. ', tools: [{ name: 'run_action', input: { action: LOPU_TEST_ACTION_KEY, inputs: { message: 'ping' } } }] }
          : { text: `${failureLine(results[0])} I will leave it there for now.`, tools: [] },
      (results, previous) => {
        const created = previous[0]?.[0];
        const ran = results[0];
        const result = dataOf(ran).result;
        return {
          text: ran?.ok
            ? `Pong! The action answered "${typeof result === 'string' ? result : JSON.stringify(result)}". It is saved as ${LOPU_TEST_ACTION_KEY}${dataOf(created).thing?.id ? ` (id ${dataOf(created).thing.id})` : ''} — find it on /actions 🏓`
            : `${failureLine(ran)} The action itself is saved on /actions.`,
          tools: []
        };
      }
    ];
  }

  if (wantsComponent || wantsPage) {
    const hops: HopBuilder[] = [];
    if (wantsComponent) {
      hops.push(() => ({ text: 'Let me build a little card component first… ', tools: [{ name: 'create_component', input: testCardComponent('Hello from Lopu') } as ToolPlan] }));
    }
    if (wantsPage) {
      hops.push((results, previous) => {
        const componentResult = wantsComponent ? (previous.length ? previous[previous.length - 1][0] : results[0]) : undefined;
        // the section always references Lopu's own test card: built this turn
        // when asked for, otherwise the one an earlier turn made (a fresh
        // account without it renders the builder's "not found" placeholder,
        // which is honest — the script never depends on a seeded catalog)
        const componentRef = componentResult?.ok || !wantsComponent ? LOPU_TEST_COMPONENT_KEY : 'thingtime-button-solid';
        const prefix = `lopu-${Math.floor(Date.now() / 1000).toString(36)}`;
        if (activePage) {
          return {
            text: 'Adding a fresh section to your page… ',
            tools: [{ name: 'patch_page', input: { target: 'active', ops: [{ op: 'insert', containerId: null, index: 'end', block: testSectionBlocks(componentRef, prefix)[0] }] } }]
          };
        }
        return {
          text: 'No page is open, so I will make one… ',
          tools: [{ name: 'create_page', input: { name: 'Lopu test page', blocks: testSectionBlocks(componentRef, prefix), open: true } }]
        };
      });
    }
    hops.push((results, previous) => {
      const all = [...previous.flat(), ...results];
      const failed = all.find((entry) => !entry.ok);
      const page = all.find((entry) => entry.name === 'create_page' || entry.name === 'patch_page');
      const component = all.find((entry) => entry.name === 'create_component');
      const bits: string[] = [];
      if (component?.ok) bits.push(`the card component is saved as ${LOPU_TEST_COMPONENT_KEY} (see /components/${LOPU_TEST_COMPONENT_KEY})`);
      if (page?.ok && page.name === 'create_page') bits.push(`your new page is open in the builder${dataOf(page).pageId ? ` at /builder?page=${dataOf(page).pageId}` : ''}`);
      if (page?.ok && page.name === 'patch_page') bits.push(`the new section is on your page${dataOf(page).persisted ? ' and saved' : ' — hit Save when you are happy with it'}`);
      const line = bits.length ? `All done: ${bits.join('; ')}.` : 'I could not finish the build this time.';
      return { text: failed ? `${line} ${failureLine(failed)}` : `${line} Want me to tweak the copy or the colours? 🦄`, tools: [] };
    });
    return hops;
  }

  return [
    () => ({
      text: `Hello! I’m Lopu, Thingtime’s resident unicorn 🦄 I can build pages, sections, components and actions right here — try "make me a hero section", "create a card component", or "make an action that says pong".${
        activePage ? ` I can see the page "${activePage.name || 'untitled'}" is open in your builder, so anything you ask for lands there.` : ''
      }`,
      tools: []
    })
  ];
};

// --- the stream ------------------------------------------------------------

export const createLopuTestProvider = (input: LopuTestProviderInput): LopuProviderStream => {
  const pace = typeof input.paceMs === 'number' ? Math.max(0, input.paceMs) : Number(process.env.LOPU_TEST_PROVIDER_PACE_MS ?? 12) || 0;
  const script = buildScript(input.userText, input.activePage);
  let calls = 0;
  const usage = { inputTokens: 0, outputTokens: 0 };

  async function* streamText(text: string): AsyncGenerator<LopuProviderEvent, void, unknown> {
    for (const chunk of chunkWords(text)) {
      usage.outputTokens += 1;
      yield { type: 'text', text: chunk };
      await sleep(pace);
    }
  }

  async function* streamTool(plan: ToolPlan): AsyncGenerator<LopuProviderEvent, void, unknown> {
    calls += 1;
    const id = `toolu_test_${calls}`;
    const json = JSON.stringify(plan.input);
    yield { type: 'tool_use_start', id, name: plan.name };
    for (const chunk of chunkJson(json)) {
      usage.outputTokens += 1;
      yield { type: 'tool_input_delta', id, name: plan.name, partial: chunk };
      await sleep(pace);
    }
    yield { type: 'tool_use', id, name: plan.name, input: JSON.parse(json) };
  }

  async function* run(): LopuProviderStream {
    const previous: LopuProviderToolResult[][] = [];
    let results: LopuProviderToolResult[] = [];
    for (const build of script) {
      usage.inputTokens += 1;
      const hop = build(results, previous);
      if (hop.text) yield* streamText(hop.text);
      for (const plan of hop.tools) yield* streamTool(plan);
      if (!hop.tools.length) {
        yield { type: 'hop_end', stopReason: 'end_turn', usage: { ...usage } };
        return;
      }
      const feed = yield { type: 'hop_end', stopReason: 'tool_use', usage: { ...usage } };
      if (!feed) return;
      previous.push(feed.results);
      results = feed.results;
      if (feed.finalHop) {
        yield* streamText('That is as far as the tool budget goes this turn — ask again and I will pick it up from here 🦄');
        yield { type: 'hop_end', stopReason: 'end_turn', usage: { ...usage } };
        return;
      }
    }
    // a script that ends on tools still owes the user a closing line
    const last = results.find((entry) => !entry.ok);
    yield* streamText(last ? `${failureLine(last)}` : 'Done ✨');
    yield { type: 'hop_end', stopReason: 'end_turn', usage: { ...usage } };
  }

  return run();
};
