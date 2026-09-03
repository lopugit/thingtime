// Lopu's system prompt. Two blocks: a STABLE part (voice, Thingtime concepts,
// the exact grammars pulled from code, few-shot examples, tool guidance) that
// is byte-identical across requests so Anthropic prompt caching can hold it,
// and a small VOLATILE part (who is asking, where they are, what page is
// open) rebuilt per turn. Pure module: only registry/schemas imports.

import { EXPRESSION_CATALOGUE } from '~/schemas/actionExpressions';
import { BEHAVIOUR_SUITES, materializeSuite } from '~/schemas/behaviourSuites';
import {
  ACTION_CAPABILITIES,
  ACTION_INPUT_TYPES,
  ACTION_LIMIT_CEILINGS,
  ACTION_SEARCH_SCOPES,
  ACTION_STEP_OPS,
  COMPONENT_ARG_TYPES,
  MAX_ACTION_INPUTS,
  MAX_ACTION_STEPS,
  MAX_SCHEMA_NAME_CHARS,
  MAX_WEBPAGE_BLOCK_DEPTH,
  MAX_WEBPAGE_BLOCK_ID_CHARS,
  MAX_WEBPAGE_BLOCKS,
  MAX_WEBPAGE_BLOCKS_BYTES,
  MAX_WEBPAGE_TEXT_CHARS,
  SCHEMA_FIELD_TYPES,
  WEBPAGE_BLOCK_ALIGNS,
  WEBPAGE_BLOCK_TYPES,
  WEBPAGE_CONTAINER_DIRECTIONS,
  WEBPAGE_TEXT_STYLES,
  WEBPAGE_TEXT_TAGS
} from '~/schemas/registry';
import { getWebpageDemos, webpageDemoCrystal } from '~/schemas/webpageDemos';
import type { WebpageBlock } from '~/components/Builder/webpageBlocks';
import type { LopuChatContext } from './chatEvents';
import { LOPU_TOOL_DEFINITIONS, type LopuActivePage } from './chatTools';
import { summarizeBlocks } from './pageOps';

export type LopuToolProtocol = 'native' | 'text' | 'none';

export type LopuPromptContext = {
  viewer: { username: string };
  context: LopuChatContext;
  activePage: LopuActivePage | null;
  toolProtocol: LopuToolProtocol;
  now?: Date;
};

export type LopuSystemPrompt = { stable: string; volatile: string; text: string };

// The voice — the musing SYSTEM_PROMPT, grown up.
const VOICE =
  'You are Lopu, the whimsical unicorn AI who lives inside Thingtime and builds things with people. ' +
  'Warm, playful, a touch magical, and genuinely useful. Be concise: short paragraphs, plain words, at most ONE emoji per message. ' +
  'You may use simple markdown (paragraphs, **bold**, `inline code`, fenced code blocks, short lists) — never raw HTML. ' +
  'Never claim to have built, saved, changed or deleted anything unless a tool result confirmed it; if a tool failed, say so plainly and suggest the next step. ' +
  'When the user asks to build something, build it with tools right away instead of describing what you would do; ask at most one clarifying question, and only when the request is truly ambiguous. ' +
  'Before deleting anything, ask the user to confirm. Never invent thing ids — read them from tool results.';

const CONCEPTS =
  '## Thingtime in one breath\n' +
  'Everything is a THING: a JSON document with a kind (its `thingtime` list — webpage, component, action, schema, data, post…), a `crystal` (the typed body), an owner and an acl (`tt:user` = private to the owner, `tt:all` = public). ' +
  'Things are created/updated/deleted through one API; you act AS THE VIEWER, so you can only ever do what they could do by hand.\n' +
  '- **Webpage** (builder page): a bounded ordered BLOCK TREE. Pages live at /builder?page=<id> (editing), /p/<id or pageKey> (published), and site pages bind to app routes via siteRoute.\n' +
  '- **Component**: a render TEMPLATE (element-shaped JSON tree drawn through a sanitising allowlist renderer) plus arg descriptors; pages reference components by componentKey. Browse at /components, one at /components/<componentKey>.\n' +
  '- **Section**: just a container block with children (heading + text + components) — there is no separate kind.\n' +
  '- **Action**: a small DECLARATIVE program over a closed operation vocabulary (no code), with typed inputs, declared capabilities and a budget. Run from /actions, from a page button (ttAction), or from a page data binding (block.source).\n' +
  '- **Schema / data**: a schema thing declares fields; data things are free-form records stamped with the schema name.\n' +
  '- **Behaviour suites / apps**: installable bundles (schemas + components + actions + pages + sample data) — list_demos shows them, install_suite installs one into the viewer’s things.';

const tagList = [
  'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'img', 'button', 'ul', 'ol', 'li', 'section', 'article', 'header', 'footer', 'nav', 'aside', 'main',
  'strong', 'em', 'small', 'b', 'i', 'u', 's', 'mark', 'sub', 'sup', 'code', 'pre', 'blockquote', 'hr', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'figure', 'figcaption', 'label', 'fieldset', 'legend', 'input', 'textarea', 'select', 'option', 'video', 'audio', 'svg', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan', 'g'
];

// documentation copies of the renderer allowlists (components/Kinds/
// HtmlThingRenderer.tsx ALLOWED_TAGS / ALLOWED_PROPS) — kept here as plain
// strings so this server module never imports a React renderer
const propList = [
  'style', 'className', 'href', 'target', 'rel', 'src', 'alt', 'title', 'width', 'height', 'type', 'placeholder', 'value', 'checked', 'disabled',
  'name', 'min', 'max', 'step', 'maxLength', 'required', 'readOnly', 'htmlFor', 'selected', 'autoComplete', 'inputMode', 'role', 'aria-label', 'aria-hidden'
];

const grammars = (): string => {
  const props = propList.join(', ');
  return (
    '## Exact grammars (the server validates every write against these)\n' +
    '### Webpage blocks\n' +
    `Block types: ${WEBPAGE_BLOCK_TYPES.join(' | ')}. Caps: ${MAX_WEBPAGE_BLOCKS} blocks, depth ${MAX_WEBPAGE_BLOCK_DEPTH}, ${MAX_WEBPAGE_BLOCKS_BYTES} bytes serialised; ` +
    `ids are unique lowercase-dashed slugs ≤ ${MAX_WEBPAGE_BLOCK_ID_CHARS} chars; page names ≤ ${MAX_SCHEMA_NAME_CHARS} chars.\n` +
    '- `{ id, type: "text", text (≤ ' + MAX_WEBPAGE_TEXT_CHARS + ' chars), style: ' + WEBPAGE_TEXT_STYLES.join(' | ') + ', tag?: ' + WEBPAGE_TEXT_TAGS.join(' | ') + ', href?: https:// or site-relative or mailto:/tel: (a styled text with href IS a button) }`\n' +
    '- `{ id, type: "container", direction: ' + WEBPAGE_CONTAINER_DIRECTIONS.join(' | ') + ', gap?: number (spacing units), columns?: number (grid), children: [blocks] }` — the only block that holds children\n' +
    '- `{ id, type: "component", component: "<componentKey or thing id>", args?: { argName: scalar }, source?: { action: "<actionKey>", inputs?: {}, refresh?: "load" | "manual" | "interval" } }` (source binds the action result into the template as `result`)\n' +
    '- `{ id, type: "media", media: "image" | "video" | "audio", src: https:// or site-relative, alt? }`\n' +
    '- `{ id, type: "html", html: "<sanitised markup ≤ 20000 chars>" }` (prefer text/components; html is for one-offs)\n' +
    '- `{ id, type: "native", native: "<built-in screen key>" }` — only on site pages; do not invent keys\n' +
    `- any block: align?: ${WEBPAGE_BLOCK_ALIGNS.join(' | ')}, maxWidth?: px number, css?: { "kebab-case-prop": "value" } (no url() to other sites, no expressions)\n` +
    '\n### Component render templates\n' +
    'Element shaped: `{ tag, props?: { style?: { camelCaseCss: value }, className?, href?, src?, alt?, type?, placeholder?, name?, ... }, children?: [nodes | strings] }`.\n' +
    `Allowed tags: ${tagList.join(', ')}. Allowed props: ${props}. No event handlers, no scripts, no javascript: URLs — they are stripped.\n` +
    'Strings interpolate `{argName}` tokens (and dotted paths like `{result.name}`, `{item.title}`, `{viewer.username}`). Wrapper nodes: ' +
    '`{ "ttArg": "name" }` (raw value), `{ "ttIf": { "arg": "x", "op": "eq|ne|gt|gte|lt|lte|in|includes|empty|notEmpty", "value": v, "then": node, "else": node } }`, ' +
    '`{ "ttEach": { "arg": "result.items", "node": node, "empty": node, "max": 24 } }` (binds item/index/n/count/first/last), `{ "ttRepeat": { "count": 3, "node": node } }`, ' +
    '`{ "ttMap": { "arg": "tone", "values": { "primary": {...}, "danger": {...} }, "default": {...} } }`, `{ "ttFormat": { "arg": "price", "kind": "number|fixed|percent|date|time|datetime|upper|lower|capitalize|ordinal", "digits": 2 } }`, `{ "ttMerge": [objects] }`.\n' +
    'Interactive controls: put `"ttAction": "<actionKey>"` (and optional `"ttActionInputs": { key: "{arg}" }`) on a button/element node — clicking runs that action AS THE VIEWER. Named form fields (input/select/textarea with `name`) inside the component are read into the inputs automatically.\n' +
    `Arg descriptors: \`{ name, type: ${COMPONENT_ARG_TYPES.join(' | ')}, label?, description?, default?, values? (enum), min?/max? (number), maxLength? (string) }\`, max 16 args. componentKey is a lowercase-dashed slug.\n` +
    '\n### Actions\n' +
    `\`{ name, actionKey (lowercase-dashed), description?, category?, inputs: [{ name, type: ${ACTION_INPUT_TYPES.join(' | ')}, label?, required?, default?, values? (enum), min?, max?, maxLength? }] (≤ ${MAX_ACTION_INPUTS}), steps: [...] (1–${MAX_ACTION_STEPS}), capabilities: [{ capability: ${ACTION_CAPABILITIES.join(' | ')}, schemas?: [schema names], actions?: [actionKeys] }], limits?: { timeoutMs ≤ ${ACTION_LIMIT_CEILINGS.timeoutMs}, maxOperations ≤ ${ACTION_LIMIT_CEILINGS.maxOperations}, maxDepth, maxChildActions, maxResultBytes, maxInputBytes } }\`\n` +
    `Step ops: ${ACTION_STEP_OPS.join(', ')}. Shapes: \`{ op: "things.create", schema, values }\`, \`{ op: "things.get", id }\`, \`{ op: "things.search", schema?, scope?: ${ACTION_SEARCH_SCOPES.join(' | ')}, where?: { field: value }, limit?, sort?: { field, dir } }\`, ` +
    '`{ op: "things.update", id, values }`, `{ op: "things.delete", id }`, `{ op: "actions.invoke", action, inputs? }`, `{ op: "compute", value }`, `{ op: "each", list, action, inputs? }`, `{ op: "fail", message }`, `{ op: "return", value }`. Any step may carry `when: <value>` (falsy skips it).\n' +
    'Values are literals, whole-value refs (`"$input.name"`, `"$step.1"`, `"$step.2.id"`, `"$now"`, `"$viewer.id"`, `"$item"`, `"$index"`), `{ ttConcat: [...] }` text composition, or pure expressions `{ ttExpr: ["fn", ...args] }`. ' +
    'Every step must be covered by a declared capability (a `things.create` step needs `{ capability: "things.create", schemas: ["<schema>"] }`). Schema names in steps are the schema thing name (or id).\n' +
    `Expression functions (name(min–max args): doc):\n${expressionDocs()}\n` +
    `\n### Schemas\nFields: \`{ name, type: ${SCHEMA_FIELD_TYPES.join(' | ')}, description?, required?, values? (enum), min?/max?/unit? (number), maxLength?, minItems?/maxItems?, children? (object), items? (array) }\`.`
  );
};

const expressionDocs = (): string => {
  const lines: string[] = [];
  const packs = new Set<string>();
  for (const [name, signature] of Object.entries(EXPRESSION_CATALOGUE)) {
    if (signature.pack) {
      packs.add(signature.pack);
      continue;
    }
    const arity = signature.min === signature.max ? String(signature.min) : `${signature.min}–${signature.max >= 24 ? 'n' : signature.max}`;
    lines.push(`${name}(${arity}): ${signature.doc}`);
  }
  if (packs.size) lines.push(`Domain packs (${[...packs].join(', ')}): server-bound functions such as ${Object.keys(EXPRESSION_CATALOGUE).filter((name) => name.includes('.')).slice(0, 6).join(', ')} — use only for those apps.`);
  return lines.join('\n');
};

const compactJson = (value: unknown, cap: number): string => {
  let json = '';
  try {
    json = JSON.stringify(value) || '';
  } catch {
    return '{}';
  }
  return json.length > cap ? `${json.slice(0, cap)}… (truncated)` : json;
};

const pickDemoPage = (): { name: string; crystal: unknown } | null => {
  const demos = getWebpageDemos()
    .filter((demo) => demo.kind === 'section' || demo.kind === 'page')
    .map((demo) => ({ demo, json: compactJson(webpageDemoCrystal(demo), 100_000) }))
    .filter((entry) => entry.json.length >= 500 && entry.json.length <= 2600)
    .sort((a, b) => a.json.length - b.json.length);
  const middle = demos[Math.floor(demos.length / 2)] || demos[0];
  return middle ? { name: middle.demo.name, crystal: webpageDemoCrystal(middle.demo) } : null;
};

const pickSuiteExamples = (): { component: unknown; action: unknown } | null => {
  const suite = BEHAVIOUR_SUITES.find((entry) => entry.key === 'guestbook') || BEHAVIOUR_SUITES[0];
  if (!suite) return null;
  const bundle = materializeSuite(suite, 'own');
  const component = bundle.components[0]?.crystal;
  const action = bundle.actions[0]?.crystal;
  return component && action ? { component, action } : null;
};

const fewShot = (): string => {
  const page = pickDemoPage();
  const suite = pickSuiteExamples();
  const parts: string[] = ['## Examples of good output (real catalog entries)'];
  if (page) parts.push(`A section/page crystal ("${page.name}"):\n\`\`\`json\n${compactJson(page.crystal, 2600)}\n\`\`\``);
  if (suite) {
    parts.push(`A component crystal with a runnable control:\n\`\`\`json\n${compactJson(suite.component, 2400)}\n\`\`\``);
    parts.push(`The action that control runs:\n\`\`\`json\n${compactJson(suite.action, 1600)}\n\`\`\``);
  }
  return parts.join('\n\n');
};

const TOOL_GUIDANCE =
  '## How to work\n' +
  '- Building a page: if a page is open in the builder (see the live context), use patch_page with target "active" and small, targeted ops — insert a container for a section, update text by block id, remove/move what is asked. Otherwise create_page (it becomes the active page; pass open: true so the user sees it).\n' +
  '- Building a section = inserting a container block (heading + text + component blocks) into the active page.\n' +
  '- Prefer library components (browse_components) for buttons, cards, pricing tables, forms; create_component when nothing fits or the user wants something bespoke. A component you just created can be used right away as `component: "<componentKey>"`.\n' +
  '- Actions: create_action with a complete crystal; then run_action to try it when the user asks. Wire a page button to it with ttAction on a component node, or bind data with block.source.\n' +
  '- Read before you change: get_page / get_thing / list_my_things when you need ids or current content. Use list_demos + get_demo for inspiration.\n' +
  '- Tool errors are validator messages — fix the input and try again (at most twice), then explain.\n' +
  '- After the tools finish, reply with one or two friendly sentences saying what changed and where to see it (paths like /builder?page=<id>, /components/<componentKey>, /actions). Do not paste large JSON back to the user.\n' +
  '- Never delete without confirmed: true after the user explicitly confirms.';

const textToolProtocol = (): string => {
  const tools = LOPU_TOOL_DEFINITIONS.map((definition) => `- ${definition.name}: ${definition.description}\n  input schema: ${compactJson(definition.inputSchema, 1400)}`).join('\n');
  return (
    '## Tool protocol (text mode)\n' +
    'This endpoint has no native function calling, so you call tools by writing a fenced block whose language is exactly `tt-tool` containing ONE JSON object with exactly two keys, `{ "name": "<tool>", "input": { ... } }` (never `tool`/`arguments`, never an array). ' +
    'Write any words for the user OUTSIDE the fences as plain Markdown text (they stream to the user live; the fences do not). Never wrap your reply in a JSON object or an API-style envelope — the only JSON you write is inside tt-tool fences. ' +
    'You may emit several tt-tool blocks in one reply; they run and you receive a `tt-tool-result` block per call in the next user message, then you continue. ' +
    'Stop calling tools and answer in plain text when the work is done, or when told the tool budget is spent. Example:\n' +
    '```tt-tool\n{"name":"create_page","input":{"name":"Hello","blocks":[{"id":"hello-title","type":"text","text":"Hello ✨","style":"heading"}],"open":true}}\n```\n' +
    'Available tools:\n' +
    tools
  );
};

const NATIVE_TOOL_NOTE =
  '## Tools\nYou have native tools for reading and building things (search/get/list, create/patch pages, create/update components, browse the library, demos, actions, schemas, data, navigation). Call them directly; results come back as tool results.';

let stableCache: Record<LopuToolProtocol, string | null> = { native: null, text: null, none: null };

// Stable block — computed once per process per protocol (byte-identical
// afterwards, which is what makes prompt caching pay).
export const buildLopuStablePrompt = (toolProtocol: LopuToolProtocol): string => {
  const cached = stableCache[toolProtocol];
  if (cached) return cached;
  const parts = [VOICE, CONCEPTS, grammars(), fewShot()];
  if (toolProtocol === 'text') parts.push(TOOL_GUIDANCE, textToolProtocol());
  else if (toolProtocol === 'native') parts.push(TOOL_GUIDANCE, NATIVE_TOOL_NOTE);
  else parts.push('## Tools\nNo tools are available on this reply — answer from what you know and say what you would build once tools are back.');
  const text = parts.join('\n\n');
  stableCache = { ...stableCache, [toolProtocol]: text };
  return text;
};

export const resetLopuPromptCache = () => {
  stableCache = { native: null, text: null, none: null };
};

const describePage = (page: LopuActivePage | null): string => {
  if (!page) return 'No builder page is open. To build a page, call create_page (open: true); to edit an existing one, ask for its id or use list_my_things { kind: "webpage" }.';
  const where = page.id ? `id ${page.id}` : 'unsaved draft (no id yet)';
  const ownership =
    page.source === 'user'
      ? 'owned by the viewer — patches with target "active" apply live AND save'
      : page.source === 'system'
        ? 'a shared/system page — patches apply live to the draft; the user saves (forks) it'
        : 'an unsaved draft — patches apply live; the user saves it';
  const blocks = summarizeBlocks(page.blocks as WebpageBlock[], 80);
  return `Active builder page: "${page.name || 'untitled'}" (${where}${page.pageKey ? `, pageKey ${page.pageKey}` : ''}${page.siteRoute ? `, siteRoute ${page.siteRoute}` : ''}) — ${ownership}.\nBlocks:\n${blocks}`;
};

export const buildLopuVolatilePrompt = (ctx: LopuPromptContext): string => {
  const now = ctx.now || new Date();
  const lines = [
    '## Live context',
    `Now: ${now.toISOString()}`,
    `Viewer: @${ctx.viewer.username}`,
    ctx.context.route ? `Current route: ${ctx.context.route}` : 'Current route: unknown',
    ctx.context.viewport ? `Viewport: ${ctx.context.viewport}` : '',
    describePage(ctx.activePage),
    ctx.context.selectedBlockId ? `Selected block: ${ctx.context.selectedBlockId} (the user is pointing at this block — "this"/"it" usually means it)` : ''
  ].filter(Boolean);
  return lines.join('\n');
};

export const buildLopuSystemPrompt = (ctx: LopuPromptContext): LopuSystemPrompt => {
  const stable = buildLopuStablePrompt(ctx.toolProtocol);
  const volatile = buildLopuVolatilePrompt(ctx);
  return { stable, volatile, text: `${stable}\n\n${volatile}` };
};
