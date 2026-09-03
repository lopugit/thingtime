// Lopu's tools: the JSON-schema definitions the providers advertise plus the
// executors that run them AS THE VIEWER through the ordinary api/utils
// (things create/update/delete, components browse, webpage resolve, actions
// run, suites install). Nothing here reaches Mongo directly — every write is
// the same unified things path a click in the UI takes, so ACL, quotas, kind
// gates and crystal sanitizers all apply exactly as they would by hand.
//
// The module's TOP LEVEL is pure (definitions, validators, bounding helpers):
// the prompt builder, the test provider and the unit tests import it without
// loading the Mongo-backed utils, which the executor pulls in lazily on first
// use. Executors never throw — an error is returned as { ok:false, error }
// and fed back to the model verbatim so it can self-correct.

import { countBlocks, type WebpageBlock } from '~/components/Builder/webpageBlocks';
import {
  ACL_ALL,
  ACL_OWNER,
  ACTION_CAPABILITIES,
  ACTION_INPUT_TYPES,
  ACTION_STEP_OPS,
  COMPONENT_ARG_TYPES,
  COMPONENT_KEY_PATTERN,
  deriveActionEffects,
  MAX_COMPONENT_KEY_CHARS,
  MAX_SCHEMA_NAME_CHARS,
  sanitizeActionCrystal,
  validateThingtimeCrystal,
  WEBPAGE_BLOCK_TYPES
} from '~/schemas/registry';
import { getAllSuites, summarizeBehaviourSuite } from '~/schemas/behaviourSuites';
// registers the app suites (pokeworld/starsalign) so install_suite and
// list_demos see the whole catalog even when this is the first server module
// to load after a rebuild — see api/utils/webpages/suites.ts for the why
import '~/schemas/appSuites/index';
import { getWebpageDemo, getWebpageDemos, webpageDemoCrystal, WEBPAGE_DEMO_FAMILIES } from '~/schemas/webpageDemos';
import type { LopuChatContext, LopuChatStreamEvent } from './chatEvents';
import { applyPageOps, summarizeBlocks, validatePageOps, validatePatchTarget, type PageOp, type PatchTarget } from './pageOps';
// type-only namespace imports: erased at compile time, so the Mongo-backed
// modules still load lazily (loadServerDeps below), never at import time
import type * as ActionsModule from '../actions/execute';
import type * as BrowseModule from '../components/browse';
import type * as SearchModule from '../things/search';
import type * as ThingsModule from '../things/things';
import type * as SuitesModule from '../webpages/suites';
import type * as WebpagesModule from '../webpages/webpages';

export const LOPU_TOOL_NAMES = [
  'search_things',
  'get_thing',
  'list_my_things',
  'create_component',
  'update_component',
  'browse_components',
  'create_page',
  'patch_page',
  'get_page',
  'list_demos',
  'get_demo',
  'create_action',
  'run_action',
  'list_actions',
  'install_suite',
  'create_schema',
  'create_data',
  'update_thing',
  'delete_thing',
  'navigate'
] as const;
export type LopuToolName = (typeof LOPU_TOOL_NAMES)[number];

// The builder tools whose inputs the client previews live while they stream
// (Anthropic eager_input_streaming; every provider emits tool_input_delta).
export const LOPU_STREAMED_INPUT_TOOLS: readonly LopuToolName[] = ['create_component', 'update_component', 'create_page', 'patch_page'];

export const MAX_LOPU_TOOL_INPUT_BYTES = 96 * 1024;
export const MAX_LOPU_TOOL_DATA_BYTES = 16 * 1024;
export const MAX_LOPU_SEARCH_LIMIT = 20;
export const MAX_LOPU_LIST_LIMIT = 50;
export const MAX_LOPU_BROWSE_LIMIT = 12;
export const MAX_LOPU_NAVIGATE_PATH_CHARS = 300;

export type LopuToolDefinition = {
  name: LopuToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  // stream the input JSON to the client as it is generated (live preview)
  streamInput?: boolean;
  // writes something (used by the prompt to remind the model to confirm)
  mutates?: boolean;
};

const LIST_MY_THINGS_KINDS = ['webpage', 'component', 'action', 'schema', 'data'] as const;
type ListMyThingsKind = (typeof LIST_MY_THINGS_KINDS)[number];

const BLOCK_SCHEMA_DESCRIPTION =
  'A webpage block: { id (unique lowercase-dashed), type: "text" | "container" | "component" | "media" | "html" | "native", ' +
  'text blocks: text + style ("body" | "heading" | "eyebrow") + optional tag/href; containers: direction ("column" | "row" | "grid") + gap + columns + children[]; ' +
  'component blocks: component (componentKey or thing id) + args {}; media: media ("image" | "video" | "audio") + src + alt; ' +
  'any block: align ("start" | "center" | "end" | "stretch"), maxWidth, css { "kebab-prop": "value" } }';

const blockSchema = { type: 'object', description: BLOCK_SCHEMA_DESCRIPTION, additionalProperties: true, required: ['id', 'type'] };

const pageOpSchema = {
  type: 'object',
  description:
    'One patch operation: { op: "insert", containerId: <block id | null for the root>, index: <number | "end">, block } | ' +
    '{ op: "update", id, patch: { text?, style?, args?, css?, align?, ... } } | { op: "replace", id, block } | { op: "remove", id } | ' +
    '{ op: "move", id, containerId, index } | { op: "setBlocks", blocks: [...] } (whole tree, last resort)',
  required: ['op'],
  properties: {
    op: { type: 'string', enum: ['insert', 'update', 'replace', 'remove', 'move', 'setBlocks'] },
    id: { type: 'string' },
    containerId: { type: ['string', 'null'] },
    index: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'string', enum: ['end'] }] },
    block: blockSchema,
    patch: { type: 'object', additionalProperties: true },
    blocks: { type: 'array', items: blockSchema }
  }
};

const componentArgSchema = {
  type: 'object',
  required: ['name', 'type'],
  properties: {
    name: { type: 'string', description: 'identifier, e.g. "title"' },
    type: { type: 'string', enum: [...COMPONENT_ARG_TYPES] },
    label: { type: 'string' },
    description: { type: 'string' },
    default: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
    values: { type: 'array', items: { type: 'string' }, description: 'enum options' },
    min: { type: 'number' },
    max: { type: 'number' },
    maxLength: { type: 'integer' }
  }
};

export const LOPU_TOOL_DEFINITIONS: readonly LopuToolDefinition[] = [
  {
    name: 'search_things',
    description:
      'Search the things the viewer can see (their own things plus public ones) by text. Returns id, kind, name and a snippet per hit. Use before get_thing when you only know a name.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'free text, 1–200 chars' },
        kinds: { type: 'array', items: { type: 'string' }, description: 'optional thingtime kinds, e.g. ["webpage","component"]' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LOPU_SEARCH_LIMIT }
      }
    }
  },
  {
    name: 'get_thing',
    description: 'Read one thing by id as the viewer (crystal bounded to 16KB; large render trees are summarised).',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }
  },
  {
    name: 'list_my_things',
    description: 'List the viewer’s own things of one kind (newest first): webpage, component, action, schema or data.',
    inputSchema: {
      type: 'object',
      required: ['kind'],
      properties: {
        kind: { type: 'string', enum: [...LIST_MY_THINGS_KINDS] },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LOPU_LIST_LIMIT }
      }
    }
  },
  {
    name: 'create_component',
    description:
      'Create a component thing owned by the viewer: a render template (element shaped { tag, props, children } using {argName} tokens and ttArg/ttIf/ttEach/ttRepeat/ttMap/ttFormat wrappers) plus arg descriptors. Private unless public: true. Emits the created thing so the builder can use it immediately.',
    streamInput: true,
    mutates: true,
    inputSchema: {
      type: 'object',
      required: ['name', 'componentKey', 'render'],
      properties: {
        name: { type: 'string', description: `display name, ≤ ${MAX_SCHEMA_NAME_CHARS} chars` },
        componentKey: { type: 'string', description: `stable lowercase-dashed slug, ≤ ${MAX_COMPONENT_KEY_CHARS} chars` },
        description: { type: 'string' },
        category: { type: 'string', description: 'e.g. cards, buttons, forms, layout' },
        args: { type: 'array', items: componentArgSchema },
        render: { type: 'object', description: 'the render template: { tag: "div", props: { style: {...} }, children: [...] }', additionalProperties: true },
        previewBg: { type: 'string' },
        public: { type: 'boolean', description: 'share with everyone (default: private to the viewer)' }
      }
    }
  },
  {
    name: 'update_component',
    description: 'Update one of the viewer’s components (merge): render, args, name, description, savedArgs; bumpVersion increments crystal.version.',
    streamInput: true,
    mutates: true,
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        render: { type: 'object', additionalProperties: true },
        args: { type: 'array', items: componentArgSchema },
        name: { type: 'string' },
        description: { type: 'string' },
        savedArgs: { type: 'object', additionalProperties: true },
        bumpVersion: { type: 'boolean' }
      }
    }
  },
  {
    name: 'browse_components',
    description: 'Browse the component library (platform + public + the viewer’s own): componentKey, name, category, library, args. Use a componentKey as a page block’s "component" ref.',
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: MAX_LOPU_BROWSE_LIMIT } }
    }
  },
  {
    name: 'create_page',
    description:
      'Create a webpage thing (a block tree) owned by the viewer. It becomes the active page for the rest of this turn (later patch_page calls may target "active"). open: true navigates the user to the builder for it.',
    streamInput: true,
    mutates: true,
    inputSchema: {
      type: 'object',
      required: ['name', 'blocks'],
      properties: {
        name: { type: 'string' },
        pageKey: { type: 'string', description: 'optional lowercase-dashed stable key (serves at /p/<pageKey>)' },
        description: { type: 'string' },
        previewBg: { type: 'string', description: 'optional CSS background for the canvas' },
        blocks: { type: 'array', items: blockSchema },
        public: { type: 'boolean', description: 'publish for everyone (default: private)' },
        open: { type: 'boolean', description: 'open the page in the builder after creating it' }
      }
    }
  },
  {
    name: 'patch_page',
    description:
      'Change a page with a list of ops (insert/update/replace/remove/move/setBlocks). target "active" = the page the user has open in the builder (or the page created earlier this turn). Ops render live on the user’s screen; the page is saved when the user owns it (persist: false keeps it a draft).',
    streamInput: true,
    mutates: true,
    inputSchema: {
      type: 'object',
      required: ['ops'],
      properties: {
        target: { anyOf: [{ type: 'string', enum: ['active'] }, { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }] },
        ops: { type: 'array', items: pageOpSchema, minItems: 1 },
        persist: { type: 'boolean' }
      }
    }
  },
  {
    name: 'get_page',
    description: 'Read a page’s block tree summary and its resolved components — by id, by site path (e.g. "/status"), or "active" for the open builder draft.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, path: { type: 'string' }, active: { type: 'boolean' } }
    }
  },
  {
    name: 'list_demos',
    description: 'Browse the builder demo library (sections, pages, components) and installable behaviour suites — the few-shot examples of good pages.',
    inputSchema: {
      type: 'object',
      properties: {
        family: { type: 'string', enum: WEBPAGE_DEMO_FAMILIES.map((family) => family.key) },
        kind: { type: 'string', enum: ['section', 'page', 'component'] },
        q: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 40 }
      }
    }
  },
  {
    name: 'get_demo',
    description: 'Read one demo’s full block tree by slug (from list_demos) to copy or adapt.',
    inputSchema: { type: 'object', required: ['slug'], properties: { slug: { type: 'string' } } }
  },
  {
    name: 'create_action',
    description:
      'Create an action thing (a declarative program): { name, actionKey, description?, category?, inputs: [{ name, type, label?, required?, default?, values? }], steps: [{ op, ... }], capabilities: [{ capability, schemas?, actions? }], limits? }. Steps are validated against the closed vocabulary; the result reports the derived effects.',
    mutates: true,
    inputSchema: {
      type: 'object',
      required: ['crystal'],
      properties: {
        crystal: {
          type: 'object',
          additionalProperties: true,
          description: `ops: ${ACTION_STEP_OPS.join(', ')}; capabilities: ${ACTION_CAPABILITIES.join(', ')}; input types: ${ACTION_INPUT_TYPES.join(', ')}`
        }
      }
    }
  },
  {
    name: 'run_action',
    description: 'Run one of the viewer’s actions by actionKey or id with typed inputs and return its result (bounded).',
    mutates: true,
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: { action: { type: 'string' }, inputs: { type: 'object', additionalProperties: true } }
    }
  },
  { name: 'list_actions', description: 'List the viewer’s own actions (id, actionKey, name, inputs).', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'install_suite',
    description: 'Install a behaviour suite / app bundle (schemas + components + actions + pages + sample data) into the viewer’s things by suite key. Idempotent.',
    mutates: true,
    inputSchema: { type: 'object', required: ['key'], properties: { key: { type: 'string' } } }
  },
  {
    name: 'create_schema',
    description: 'Create a schema thing: { name, description?, fields: [{ name, type: string|text|number|boolean|date|enum|string[]|object|array, required?, values?, min?, max?, maxLength? }] }.',
    mutates: true,
    inputSchema: {
      type: 'object',
      required: ['name', 'fields'],
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        fields: { type: 'array', items: { type: 'object', additionalProperties: true, required: ['name', 'type'] } }
      }
    }
  },
  {
    name: 'create_data',
    description: 'Create a data thing for one of the viewer’s schemas (by schema name or schema thing id) from a values object.',
    mutates: true,
    inputSchema: {
      type: 'object',
      required: ['schema', 'values'],
      properties: {
        schema: { type: 'string' },
        values: { type: 'object', additionalProperties: true },
        public: { type: 'boolean' }
      }
    }
  },
  {
    name: 'update_thing',
    description: 'Generic update of one of the viewer’s things: merge a crystal patch (or replace the crystal with replaceCrystal: true). Protected and messenger kinds refuse.',
    mutates: true,
    inputSchema: {
      type: 'object',
      required: ['id', 'crystal'],
      properties: { id: { type: 'string' }, crystal: { type: 'object', additionalProperties: true }, replaceCrystal: { type: 'boolean' } }
    }
  },
  {
    name: 'delete_thing',
    description: 'Delete one of the viewer’s things. Refuses unless confirmed: true — ask the user to confirm first, never assume.',
    mutates: true,
    inputSchema: {
      type: 'object',
      required: ['id', 'confirmed'],
      properties: { id: { type: 'string' }, confirmed: { type: 'boolean' } }
    }
  },
  {
    name: 'navigate',
    description: 'Send the user to a Thingtime page (site-relative path only, e.g. "/builder?page=<id>", "/components/<key>", "/p/<pageKey>").',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } }
  }
];

const definitionByName = new Map<string, LopuToolDefinition>(LOPU_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]));

export const getLopuToolDefinition = (name: string): LopuToolDefinition | null => definitionByName.get(name) || null;
export const isLopuToolName = (name: unknown): name is LopuToolName => typeof name === 'string' && definitionByName.has(name);

// Provider-shaped definitions (pure).
export const anthropicToolDefinitions = () =>
  LOPU_TOOL_DEFINITIONS.map((definition) => ({
    name: definition.name,
    description: definition.description,
    input_schema: definition.inputSchema as { type: 'object'; [key: string]: unknown },
    ...(definition.streamInput ? { eager_input_streaming: true } : {})
  }));

export const openAiToolDefinitions = () =>
  LOPU_TOOL_DEFINITIONS.map((definition) => ({
    type: 'function' as const,
    function: { name: definition.name, description: definition.description, parameters: definition.inputSchema }
  }));

// ---------------------------------------------------------------------------
// bounding — a tool_result must stay small on the wire and in the model's
// context; created things ride the separate `thing` event whole.

const jsonLength = (value: unknown): number => {
  try {
    const json = JSON.stringify(value);
    return typeof json === 'string' ? json.length : 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

const shrink = (value: unknown, depth: number, options: { maxString: number; maxItems: number; dropRender: boolean }): unknown => {
  if (typeof value === 'string') return value.length > options.maxString ? `${value.slice(0, options.maxString)}… (${value.length} chars)` : value;
  if (Array.isArray(value)) {
    const items = value.slice(0, options.maxItems).map((entry) => shrink(entry, depth + 1, options));
    if (value.length > options.maxItems) items.push(`… ${value.length - options.maxItems} more`);
    return items;
  }
  if (value && typeof value === 'object') {
    if (depth > 12) return '[nested]';
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (options.dropRender && key === 'render' && entry && typeof entry === 'object') {
        out[key] = `[render tree omitted — ${countNodes(entry)} nodes; read the full thing with get_thing when you need it]`;
        continue;
      }
      out[key] = shrink(entry, depth + 1, options);
    }
    return out;
  }
  return value;
};

const countNodes = (value: unknown): number => {
  if (Array.isArray(value)) return value.reduce<number>((sum, entry) => sum + countNodes(entry), 0);
  if (value && typeof value === 'object') return 1 + Object.values(value as Record<string, unknown>).reduce<number>((sum, entry) => sum + countNodes(entry), 0);
  return 0;
};

// Shrink `value` until its JSON fits `cap` bytes: long strings first, then
// long lists, then render trees; a value that still will not fit degrades to
// a truncated JSON preview rather than being dropped.
export const boundToolData = (value: unknown, cap = MAX_LOPU_TOOL_DATA_BYTES): unknown => {
  if (jsonLength(value) <= cap) return value;
  const ladder = [
    { maxString: 600, maxItems: 60, dropRender: false },
    { maxString: 240, maxItems: 30, dropRender: true },
    { maxString: 120, maxItems: 12, dropRender: true }
  ];
  for (const options of ladder) {
    const shrunk = shrink(value, 0, options);
    if (jsonLength(shrunk) <= cap) return shrunk;
  }
  let json = '';
  try {
    json = JSON.stringify(shrink(value, 0, ladder[2])) || '';
  } catch {
    json = '';
  }
  return { truncated: true, preview: json.slice(0, Math.max(0, cap - 64)) };
};

export const toolInputByteLength = (input: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(input ?? {})).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

// ---------------------------------------------------------------------------
// validators — small hand-written guards (no zod); every error string is
// written for the model, which sees it verbatim.

export type LopuToolValidation<T = Record<string, unknown>> = { ok: true; input: T } | { ok: false; error: string };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const optionalString = (value: unknown, name: string, max: number): string | undefined | { error: string } => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') return { error: `${name} must be a string` };
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) return { error: `${name} is too long (max ${max} chars)` };
  return trimmed;
};

const requiredString = (value: unknown, name: string, max: number): string | { error: string } => {
  const result = optionalString(value, name, max);
  if (result === undefined) return { error: `${name} is required` };
  return result;
};

const isError = (value: unknown): value is { error: string } => isPlainObject(value) && typeof value.error === 'string';

const optionalLimit = (value: unknown, name: string, max: number, fallback: number): number | { error: string } => {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return { error: `${name} must be a positive integer` };
  return Math.min(number, max);
};

const optionalBoolean = (value: unknown, name: string): boolean | undefined | { error: string } => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') return { error: `${name} must be true or false` };
  return value;
};

const thingId = (value: unknown, name = 'id'): string | { error: string } => {
  const result = requiredString(value, name, 128);
  if (isError(result)) return result;
  if (/[$\s]/.test(result)) return { error: `${name} must be a thing id` };
  return result;
};

const slug = (value: unknown, name: string): string | { error: string } => {
  const result = requiredString(value, name, MAX_COMPONENT_KEY_CHARS);
  if (isError(result)) return result;
  if (!COMPONENT_KEY_PATTERN.test(result)) return { error: `${name} must be a lowercase-dashed slug like "pricing-card"` };
  return result;
};

const optionalSlug = (value: unknown, name: string): string | undefined | { error: string } => {
  if (value === undefined || value === null || value === '') return undefined;
  return slug(value, name);
};

const optionalObject = (value: unknown, name: string): Record<string, unknown> | undefined | { error: string } => {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) return { error: `${name} must be an object` };
  return value;
};

const optionalArray = (value: unknown, name: string): unknown[] | undefined | { error: string } => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return { error: `${name} must be a list` };
  return value;
};

const blocksInput = (value: unknown, name: string): WebpageBlock[] | { error: string } => {
  if (!Array.isArray(value)) return { error: `${name} must be a list of blocks` };
  const validated = validatePageOps([{ op: 'setBlocks', blocks: value }]);
  if (validated.ok === false) return { error: validated.error.replace('ops[0].blocks', name) };
  return value as WebpageBlock[];
};

const SITE_PATH_PATTERN = /^\/(?![/\\])[^\s]*$/;

export const isSiteRelativePath = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_LOPU_NAVIGATE_PATH_CHARS && SITE_PATH_PATTERN.test(value) && !/[<>"'`]/.test(value);

export const validateLopuToolInput = (name: string, raw: unknown): LopuToolValidation => {
  if (!isLopuToolName(name)) return { ok: false, error: `Unknown tool "${String(name).slice(0, 40)}" — the available tools are ${LOPU_TOOL_NAMES.join(', ')}` };
  if (toolInputByteLength(raw) > MAX_LOPU_TOOL_INPUT_BYTES) return { ok: false, error: `Tool input exceeds ${MAX_LOPU_TOOL_INPUT_BYTES} bytes — split the work into smaller calls` };
  const input = isPlainObject(raw) ? raw : {};
  const fail = (error: string): LopuToolValidation => ({ ok: false, error });

  switch (name) {
    case 'search_things': {
      const query = requiredString(input.query, 'query', 200);
      if (isError(query)) return fail(query.error);
      const kinds = optionalArray(input.kinds, 'kinds');
      if (isError(kinds)) return fail(kinds.error);
      if (kinds && kinds.some((kind) => typeof kind !== 'string' || !kind.trim() || kind.length > 40)) return fail('kinds must be a list of kind names');
      const limit = optionalLimit(input.limit, 'limit', MAX_LOPU_SEARCH_LIMIT, 10);
      if (isError(limit)) return fail(limit.error);
      return { ok: true, input: { query, kinds: kinds ? (kinds as string[]).map((kind) => kind.trim()) : undefined, limit } };
    }
    case 'get_thing': {
      const id = thingId(input.id);
      if (isError(id)) return fail(id.error);
      return { ok: true, input: { id } };
    }
    case 'list_my_things': {
      const kind = typeof input.kind === 'string' ? input.kind.trim() : '';
      if (!(LIST_MY_THINGS_KINDS as readonly string[]).includes(kind)) return fail(`kind must be one of ${LIST_MY_THINGS_KINDS.join(', ')}`);
      const limit = optionalLimit(input.limit, 'limit', MAX_LOPU_LIST_LIMIT, 20);
      if (isError(limit)) return fail(limit.error);
      return { ok: true, input: { kind, limit } };
    }
    case 'create_component': {
      const componentName = requiredString(input.name, 'name', MAX_SCHEMA_NAME_CHARS);
      if (isError(componentName)) return fail(componentName.error);
      const componentKey = slug(input.componentKey, 'componentKey');
      if (isError(componentKey)) return fail(componentKey.error);
      const description = optionalString(input.description, 'description', 500);
      if (isError(description)) return fail(description.error);
      const category = optionalString(input.category, 'category', 40);
      if (isError(category)) return fail(category.error);
      const args = optionalArray(input.args, 'args');
      if (isError(args)) return fail(args.error);
      if (!isPlainObject(input.render)) return fail('render must be a render template object like { tag: "div", props: {}, children: [] }');
      const previewBg = optionalString(input.previewBg, 'previewBg', 200);
      if (isError(previewBg)) return fail(previewBg.error);
      const isPublic = optionalBoolean(input.public, 'public');
      if (isError(isPublic)) return fail(isPublic.error);
      return { ok: true, input: { name: componentName, componentKey, description, category, args, render: input.render, previewBg, public: isPublic === true } };
    }
    case 'update_component': {
      const id = thingId(input.id);
      if (isError(id)) return fail(id.error);
      const render = optionalObject(input.render, 'render');
      if (isError(render)) return fail(render.error);
      const args = optionalArray(input.args, 'args');
      if (isError(args)) return fail(args.error);
      const componentName = optionalString(input.name, 'name', MAX_SCHEMA_NAME_CHARS);
      if (isError(componentName)) return fail(componentName.error);
      const description = optionalString(input.description, 'description', 500);
      if (isError(description)) return fail(description.error);
      const savedArgs = optionalObject(input.savedArgs, 'savedArgs');
      if (isError(savedArgs)) return fail(savedArgs.error);
      const bumpVersion = optionalBoolean(input.bumpVersion, 'bumpVersion');
      if (isError(bumpVersion)) return fail(bumpVersion.error);
      if (!render && !args && !componentName && !description && !savedArgs && !bumpVersion) return fail('Nothing to update — pass render, args, name, description, savedArgs or bumpVersion');
      return { ok: true, input: { id, render, args, name: componentName, description, savedArgs, bumpVersion: bumpVersion === true } };
    }
    case 'browse_components': {
      const q = optionalString(input.q, 'q', 120);
      if (isError(q)) return fail(q.error);
      const limit = optionalLimit(input.limit, 'limit', MAX_LOPU_BROWSE_LIMIT, 8);
      if (isError(limit)) return fail(limit.error);
      return { ok: true, input: { q, limit } };
    }
    case 'create_page': {
      const pageName = requiredString(input.name, 'name', MAX_SCHEMA_NAME_CHARS);
      if (isError(pageName)) return fail(pageName.error);
      const pageKey = optionalSlug(input.pageKey, 'pageKey');
      if (isError(pageKey)) return fail(pageKey.error);
      const description = optionalString(input.description, 'description', 500);
      if (isError(description)) return fail(description.error);
      const previewBg = optionalString(input.previewBg, 'previewBg', 200);
      if (isError(previewBg)) return fail(previewBg.error);
      const blocks = blocksInput(input.blocks, 'blocks');
      if (isError(blocks)) return fail(blocks.error);
      const isPublic = optionalBoolean(input.public, 'public');
      if (isError(isPublic)) return fail(isPublic.error);
      const open = optionalBoolean(input.open, 'open');
      if (isError(open)) return fail(open.error);
      return { ok: true, input: { name: pageName, pageKey, description, previewBg, blocks, public: isPublic === true, open: open === true } };
    }
    case 'patch_page': {
      const target = validatePatchTarget(input.target);
      if (target.ok === false) return fail(target.error);
      const ops = validatePageOps(input.ops);
      if (ops.ok === false) return fail(ops.error);
      const persist = optionalBoolean(input.persist, 'persist');
      if (isError(persist)) return fail(persist.error);
      return { ok: true, input: { target: target.target, ops: ops.ops, persist: persist !== false } };
    }
    case 'get_page': {
      const active = input.active === true || input.id === 'active' || input.target === 'active';
      const id = active ? undefined : optionalString(input.id, 'id', 128);
      if (isError(id)) return fail(id.error);
      const path = active ? undefined : optionalString(input.path, 'path', 120);
      if (isError(path)) return fail(path.error);
      if (!active && !id && !path) return fail('Pass id, path (a site route like "/status") or active: true');
      return { ok: true, input: { id, path, active } };
    }
    case 'list_demos': {
      const family = optionalString(input.family, 'family', 40);
      if (isError(family)) return fail(family.error);
      const kind = optionalString(input.kind, 'kind', 20);
      if (isError(kind)) return fail(kind.error);
      if (kind && !['section', 'page', 'component'].includes(kind)) return fail('kind must be section, page or component');
      const q = optionalString(input.q, 'q', 120);
      if (isError(q)) return fail(q.error);
      const limit = optionalLimit(input.limit, 'limit', 40, 24);
      if (isError(limit)) return fail(limit.error);
      return { ok: true, input: { family, kind, q, limit } };
    }
    case 'get_demo': {
      const demoSlug = slug(input.slug, 'slug');
      if (isError(demoSlug)) return fail(demoSlug.error);
      return { ok: true, input: { slug: demoSlug } };
    }
    case 'create_action': {
      // models often pass the action fields at the top level — accept both
      const crystal = isPlainObject(input.crystal) ? input.crystal : isPlainObject(input.steps) || Array.isArray(input.steps) ? input : null;
      if (!crystal) return fail('crystal must be an action object with at least name and steps');
      return { ok: true, input: { crystal } };
    }
    case 'run_action': {
      const action = requiredString(input.action, 'action', 128);
      if (isError(action)) return fail(action.error);
      const inputs = optionalObject(input.inputs, 'inputs');
      if (isError(inputs)) return fail(inputs.error);
      return { ok: true, input: { action, inputs: inputs || {} } };
    }
    case 'list_actions':
      return { ok: true, input: {} };
    case 'install_suite': {
      const key = slug(input.key, 'key');
      if (isError(key)) return fail(key.error);
      return { ok: true, input: { key } };
    }
    case 'create_schema': {
      const schemaName = requiredString(input.name, 'name', MAX_SCHEMA_NAME_CHARS);
      if (isError(schemaName)) return fail(schemaName.error);
      const description = optionalString(input.description, 'description', 500);
      if (isError(description)) return fail(description.error);
      if (!Array.isArray(input.fields) || !input.fields.length) return fail('fields must be a non-empty list of { name, type, ... }');
      return { ok: true, input: { name: schemaName, description, fields: input.fields } };
    }
    case 'create_data': {
      const schema = requiredString(input.schema, 'schema', 128);
      if (isError(schema)) return fail(schema.error);
      if (!isPlainObject(input.values)) return fail('values must be an object of field values');
      const isPublic = optionalBoolean(input.public, 'public');
      if (isError(isPublic)) return fail(isPublic.error);
      return { ok: true, input: { schema, values: input.values, public: isPublic === true } };
    }
    case 'update_thing': {
      const id = thingId(input.id);
      if (isError(id)) return fail(id.error);
      if (!isPlainObject(input.crystal)) return fail('crystal must be an object of fields to merge');
      const replaceCrystal = optionalBoolean(input.replaceCrystal, 'replaceCrystal');
      if (isError(replaceCrystal)) return fail(replaceCrystal.error);
      return { ok: true, input: { id, crystal: input.crystal, replaceCrystal: replaceCrystal === true } };
    }
    case 'delete_thing': {
      const id = thingId(input.id);
      if (isError(id)) return fail(id.error);
      return { ok: true, input: { id, confirmed: input.confirmed === true } };
    }
    case 'navigate': {
      const path = requiredString(input.path, 'path', MAX_LOPU_NAVIGATE_PATH_CHARS);
      if (isError(path)) return fail(path.error);
      if (!isSiteRelativePath(path)) return fail('path must be site-relative, e.g. "/builder?page=<id>" — no external URLs');
      return { ok: true, input: { path } };
    }
    default:
      return fail('Unknown tool');
  }
};

// ---------------------------------------------------------------------------
// execution context

export type LopuToolResult = { ok: true; summary: string; data?: unknown } | { ok: false; error: string };

export type LopuToolEvent = Extract<LopuChatStreamEvent, { type: 'patch' | 'thing' | 'navigate' }>;

export type LopuActivePage = {
  id: string | null;
  // 'user' = the viewer owns the doc (patches may persist); 'system' = a
  // seeded/shared doc the viewer will fork on save; 'draft' = an unsaved
  // builder draft with no doc yet
  source: 'user' | 'system' | 'draft';
  name?: string;
  pageKey?: string;
  siteRoute?: string;
  updatedAt: string | null;
  blocks: WebpageBlock[];
};

export type LopuToolViewer = { id: string; username: string };

export type LopuToolContext = {
  viewer: LopuToolViewer;
  context: LopuChatContext;
  activePage: LopuActivePage | null;
  emit: (event: LopuToolEvent) => void;
  // page-mutating tools run one at a time even when a hop executes tools in
  // parallel, so two patches never race on the same draft
  pageLock: Promise<unknown>;
};

export type LopuToolCall = { id: string; name: string; input: unknown };

export const activePageFromContext = (context: LopuChatContext | null | undefined): LopuActivePage | null => {
  const page = context?.page;
  if (!page || typeof page !== 'object') return null;
  const hasBlocks = Array.isArray(page.blocks);
  const id = typeof page.id === 'string' && page.id.trim() ? page.id.trim() : null;
  if (!hasBlocks && !id) return null;
  return {
    id,
    source: page.source === 'user' && id ? 'user' : id ? 'system' : 'draft',
    name: typeof page.name === 'string' ? page.name : undefined,
    pageKey: typeof page.pageKey === 'string' ? page.pageKey : undefined,
    siteRoute: typeof page.siteRoute === 'string' ? page.siteRoute : undefined,
    updatedAt: typeof page.updatedAt === 'string' ? page.updatedAt : null,
    blocks: hasBlocks ? (page.blocks as WebpageBlock[]) : []
  };
};

export const createLopuToolContext = (viewer: LopuToolViewer, context: LopuChatContext | null | undefined, emit: (event: LopuToolEvent) => void): LopuToolContext => ({
  viewer,
  context: context || {},
  activePage: activePageFromContext(context),
  emit,
  pageLock: Promise.resolve()
});

const withPageLock = async <T>(ctx: LopuToolContext, fn: () => Promise<T>): Promise<T> => {
  const previous = ctx.pageLock;
  let release: () => void = () => {};
  ctx.pageLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await previous.catch(() => {});
    return await fn();
  } finally {
    release();
  }
};

// ---------------------------------------------------------------------------
// server dependencies — loaded on first execution, never at import time

type ServerDeps = {
  things: typeof ThingsModule;
  search: typeof SearchModule;
  browse: typeof BrowseModule;
  webpages: typeof WebpagesModule;
  suites: typeof SuitesModule;
  actions: typeof ActionsModule;
};

let serverDepsPromise: Promise<ServerDeps> | null = null;

const loadServerDeps = (): Promise<ServerDeps> => {
  if (!serverDepsPromise) {
    serverDepsPromise = Promise.all([
      import('../things/things'),
      import('../things/search'),
      import('../components/browse'),
      import('../webpages/webpages'),
      import('../webpages/suites'),
      import('../actions/execute')
    ]).then(([things, search, browse, webpages, suites, actions]) => ({ things, search, browse, webpages, suites, actions }));
    serverDepsPromise.catch(() => {
      serverDepsPromise = null;
    });
  }
  return serverDepsPromise;
};

type PublicThingLike = {
  id: string;
  thingtime: string[];
  acl: string[];
  crystal: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  author?: { id?: string; username?: string } | null;
};

const kindOf = (thing: PublicThingLike): string => (Array.isArray(thing.thingtime) && thing.thingtime[0]) || 'data';
const nameOf = (thing: PublicThingLike): string => {
  const crystal = thing.crystal || {};
  for (const key of ['name', 'title', 'label']) {
    if (typeof crystal[key] === 'string' && crystal[key].trim()) return crystal[key].trim();
  }
  return '';
};
const keyOf = (thing: PublicThingLike): string | undefined => {
  const crystal = thing.crystal || {};
  for (const key of ['componentKey', 'pageKey', 'actionKey']) {
    if (typeof crystal[key] === 'string' && crystal[key]) return crystal[key];
  }
  return undefined;
};
const snippetOf = (thing: PublicThingLike): string => {
  const crystal = thing.crystal || {};
  for (const key of ['description', 'text', 'message', 'summary', 'body']) {
    if (typeof crystal[key] === 'string' && crystal[key].trim()) {
      const text = crystal[key].replace(/\s+/g, ' ').trim();
      return text.length > 160 ? `${text.slice(0, 157)}…` : text;
    }
  }
  return '';
};

const thingSummary = (thing: PublicThingLike) => ({
  id: thing.id,
  kind: kindOf(thing),
  name: nameOf(thing),
  ...(keyOf(thing) ? { key: keyOf(thing) } : {}),
  updatedAt: thing.updatedAt
});

// The bounded thing shape a tool_result carries (the `thing` event carries
// the whole public thing separately).
export const boundThing = (thing: PublicThingLike, cap = 12 * 1024) => ({
  id: thing.id,
  kind: kindOf(thing),
  thingtime: thing.thingtime,
  name: nameOf(thing),
  acl: thing.acl,
  createdAt: thing.createdAt,
  updatedAt: thing.updatedAt,
  crystal: boundToolData(thing.crystal, cap)
});

const failText = (result: { ok: false; error?: string; status?: number }): string => result.error || 'Request failed';

const emitThing = (ctx: LopuToolContext, callId: string, thing: PublicThingLike) => {
  ctx.emit({ type: 'thing', id: callId, kind: kindOf(thing), thing });
};

// ---------------------------------------------------------------------------
// executors

const runSearchThings = async (deps: ServerDeps, ctx: LopuToolContext, input: { query: string; kinds?: string[]; limit: number }): Promise<LopuToolResult> => {
  const result = await deps.search.searchThings(ctx.viewer, {
    q: input.query,
    ...(input.kinds?.length ? { thingtime: input.kinds.join(',') } : {}),
    limit: input.limit
  });
  if (result.ok === false) return { ok: false, error: failText(result) };
  const hits = result.things.map((thing) => ({ ...thingSummary(thing as PublicThingLike), snippet: snippetOf(thing as PublicThingLike) }));
  return {
    ok: true,
    summary: hits.length ? `Found ${hits.length} thing(s) for "${input.query}"` : `No things match "${input.query}"`,
    data: { hits, total: result.total }
  };
};

const runGetThing = async (deps: ServerDeps, ctx: LopuToolContext, input: { id: string }): Promise<LopuToolResult> => {
  const result = await deps.things.getThing(ctx.viewer, input.id);
  if (result.ok === false) return { ok: false, error: failText(result) };
  const thing = result.thing as PublicThingLike;
  return { ok: true, summary: `${kindOf(thing)} "${nameOf(thing) || thing.id}"`, data: { thing: boundThing(thing) } };
};

const runListMyThings = async (deps: ServerDeps, ctx: LopuToolContext, input: { kind: ListMyThingsKind; limit: number }): Promise<LopuToolResult> => {
  const result = await deps.things.listThings(ctx.viewer, { thingtime: [input.kind], limit: input.limit });
  if (result.ok === false) return { ok: false, error: failText(result) };
  const things = result.things.map((thing) => thingSummary(thing as PublicThingLike));
  return { ok: true, summary: `${things.length} ${input.kind} thing(s)`, data: { things, nextCursor: result.nextCursor } };
};

const runCreateComponent = async (
  deps: ServerDeps,
  ctx: LopuToolContext,
  callId: string,
  input: { name: string; componentKey: string; description?: string; category?: string; args?: unknown[]; render: Record<string, unknown>; previewBg?: string; public: boolean }
): Promise<LopuToolResult> => {
  const crystal: Record<string, unknown> = {
    name: input.name,
    componentKey: input.componentKey,
    library: 'custom',
    category: input.category || 'general',
    version: 1,
    render: input.render,
    ...(input.description ? { description: input.description } : {}),
    ...(input.args ? { args: input.args } : {}),
    ...(input.previewBg ? { previewBg: input.previewBg } : {})
  };
  const validated = validateThingtimeCrystal(['component'], crystal);
  if (validated.ok === false) return { ok: false, error: validated.error };
  const created = await deps.things.createThing(ctx.viewer.id, { thingtime: ['component'], crystal: validated.crystal, acl: [input.public ? ACL_ALL : ACL_OWNER] }, ctx.viewer);
  if (created.ok === false) return { ok: false, error: failText(created) };
  const thing = (await deps.things.toPublicThings([created.doc], ctx.viewer))[0] as PublicThingLike;
  emitThing(ctx, callId, thing);
  return {
    ok: true,
    summary: `Created component "${input.name}" (componentKey ${input.componentKey}, id ${thing.id})${input.public ? ', public' : ''}`,
    data: { thing: boundThing(thing) }
  };
};

const runUpdateComponent = async (
  deps: ServerDeps,
  ctx: LopuToolContext,
  callId: string,
  input: { id: string; render?: Record<string, unknown>; args?: unknown[]; name?: string; description?: string; savedArgs?: Record<string, unknown>; bumpVersion: boolean }
): Promise<LopuToolResult> => {
  const current = await deps.things.getThing(ctx.viewer, input.id);
  if (current.ok === false) return { ok: false, error: failText(current) };
  const existing = current.thing as PublicThingLike;
  if (!existing.thingtime.includes('component')) return { ok: false, error: `${input.id} is a ${kindOf(existing)} thing, not a component` };
  const patch: Record<string, unknown> = {
    ...(input.render ? { render: input.render } : {}),
    ...(input.args ? { args: input.args } : {}),
    ...(input.name ? { name: input.name } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.savedArgs ? { savedArgs: input.savedArgs } : {}),
    ...(input.bumpVersion ? { version: (Number(existing.crystal?.version) || 1) + 1 } : {})
  };
  const updated = await deps.things.updateThing(ctx.viewer, input.id, { crystal: patch });
  if (updated.ok === false) return { ok: false, error: failText(updated) };
  const thing = updated.thing as PublicThingLike;
  emitThing(ctx, callId, thing);
  return { ok: true, summary: `Updated component "${nameOf(thing)}" (${Object.keys(patch).join(', ')})`, data: { thing: boundThing(thing) } };
};

const runBrowseComponents = async (deps: ServerDeps, ctx: LopuToolContext, input: { q?: string; limit: number }): Promise<LopuToolResult> => {
  const result = await deps.browse.browseComponents(ctx.viewer, { q: input.q, limit: input.limit, ...(input.q ? { sort: 'relevance' } : {}) });
  if (result.ok === false) return { ok: false, error: failText(result) };
  const components = result.components.map((component) => {
    const crystal = component.crystal || {};
    return {
      id: component.id,
      componentKey: typeof crystal.componentKey === 'string' ? crystal.componentKey : undefined,
      name: nameOf(component as PublicThingLike),
      library: crystal.library,
      category: crystal.category,
      description: typeof crystal.description === 'string' ? crystal.description.slice(0, 160) : undefined,
      args: Array.isArray(crystal.args) ? crystal.args.map((arg: any) => `${arg?.name}${arg?.type ? `:${arg.type}` : ''}`).slice(0, 16) : []
    };
  });
  return { ok: true, summary: `${components.length} component(s)${input.q ? ` for "${input.q}"` : ''}`, data: { components, total: result.total } };
};

const runCreatePage = async (
  deps: ServerDeps,
  ctx: LopuToolContext,
  callId: string,
  input: { name: string; pageKey?: string; description?: string; previewBg?: string; blocks: WebpageBlock[]; public: boolean; open: boolean }
): Promise<LopuToolResult> =>
  withPageLock(ctx, async () => {
    // normalise ids the same way patch_page does (duplicates / bad slugs are
    // rewritten instead of bouncing the whole page)
    const normalised = applyPageOps([], [{ op: 'setBlocks', blocks: input.blocks }]);
    const crystal: Record<string, unknown> = {
      name: input.name,
      version: 1,
      blocks: normalised.blocks,
      ...(input.pageKey ? { pageKey: input.pageKey } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.previewBg ? { previewBg: input.previewBg } : {})
    };
    const validated = validateThingtimeCrystal(['webpage'], crystal);
    if (validated.ok === false) return { ok: false, error: validated.error };
    const created = await deps.things.createThing(ctx.viewer.id, { thingtime: ['webpage'], crystal: validated.crystal, acl: [input.public ? ACL_ALL : ACL_OWNER] }, ctx.viewer);
    if (created.ok === false) return { ok: false, error: failText(created) };
    const thing = (await deps.things.toPublicThings([created.doc], ctx.viewer))[0] as PublicThingLike;
    const blocks = Array.isArray(thing.crystal?.blocks) ? (thing.crystal.blocks as WebpageBlock[]) : normalised.blocks;
    ctx.activePage = { id: thing.id, source: 'user', name: input.name, pageKey: input.pageKey, updatedAt: thing.updatedAt, blocks };
    emitThing(ctx, callId, thing);
    if (input.open) ctx.emit({ type: 'navigate', id: callId, path: `/builder?page=${encodeURIComponent(thing.id)}` });
    return {
      ok: true,
      summary: `Created page "${input.name}" with ${countBlocks(blocks)} block(s) — id ${thing.id}${input.open ? ', opened in the builder' : ''}. It is now the active page.`,
      data: { pageId: thing.id, pageKey: input.pageKey, blocks: summarizeBlocks(blocks), thing: boundThing(thing, 4 * 1024) }
    };
  });

const resolvePatchTarget = async (deps: ServerDeps, ctx: LopuToolContext, target: PatchTarget): Promise<LopuActivePage | { error: string }> => {
  if (target === 'active') {
    if (ctx.activePage) return ctx.activePage;
    return {
      error: 'No page is open in the builder right now. Call create_page (the new page becomes the active page for this turn) or pass target: { id: "<webpage id>" }.'
    };
  }
  if (ctx.activePage?.id === target.id) return ctx.activePage;
  const resolved = await deps.webpages.resolveWebpage(ctx.viewer, { id: target.id });
  if (resolved.ok === false) return { error: failText(resolved) };
  if (!resolved.page) return { error: `Webpage ${target.id} was not found` };
  const page = resolved.page as PublicThingLike;
  return {
    id: page.id,
    source: resolved.source === 'user' ? 'user' : 'system',
    name: nameOf(page),
    pageKey: typeof page.crystal?.pageKey === 'string' ? page.crystal.pageKey : undefined,
    siteRoute: typeof page.crystal?.siteRoute === 'string' ? page.crystal.siteRoute : undefined,
    updatedAt: page.updatedAt,
    blocks: Array.isArray(page.crystal?.blocks) ? (page.crystal.blocks as WebpageBlock[]) : []
  };
};

const runPatchPage = async (deps: ServerDeps, ctx: LopuToolContext, callId: string, input: { target: PatchTarget; ops: PageOp[]; persist: boolean }): Promise<LopuToolResult> =>
  withPageLock(ctx, async () => {
    const page = await resolvePatchTarget(deps, ctx, input.target);
    if ('error' in page) return { ok: false, error: page.error };
    const applied = applyPageOps(page.blocks, input.ops);
    if (!applied.applied) return { ok: false, error: `No op could be applied: ${applied.errors.join('; ')}` };
    const validated = validateThingtimeCrystal(['webpage'], { name: page.name || 'Page', blocks: applied.blocks });
    if (validated.ok === false) return { ok: false, error: `The patched page is invalid — ${validated.error}` };
    const blocks = (validated.crystal.blocks as WebpageBlock[]) || applied.blocks;

    let persisted = false;
    let saveNote = '';
    let savedThing: PublicThingLike | null = null;
    if (input.persist && page.source === 'user' && page.id) {
      const updated = await deps.things.updateThing(ctx.viewer, page.id, { crystal: { blocks } }, page.updatedAt ? { expectedUpdatedAt: page.updatedAt } : {});
      if (updated.ok === false) {
        saveNote = updated.status === 409 ? ' (not saved: the page changed on the server since the draft loaded — the user can Save from the builder)' : ` (not saved: ${updated.error})`;
      } else {
        persisted = true;
        savedThing = updated.thing as PublicThingLike;
      }
    } else if (input.persist && page.source !== 'user') {
      saveNote = page.source === 'system' ? ' (draft only — the user does not own this page; saving forks it into their things)' : ' (draft only — the page has not been saved yet)';
    }

    const next: LopuActivePage = { ...page, blocks, updatedAt: savedThing ? savedThing.updatedAt : page.updatedAt };
    ctx.activePage = next;
    ctx.emit({ type: 'patch', id: callId, target: input.target, ops: applied.ops, ...(page.id ? { pageId: page.id } : {}), persisted });
    if (savedThing) emitThing(ctx, callId, savedThing);
    const skipped = applied.errors.length ? `; skipped ${applied.errors.length}: ${applied.errors.join('; ')}` : '';
    return {
      ok: true,
      summary: `Applied ${applied.applied}/${input.ops.length} op(s) to "${page.name || page.id || 'the page'}"${persisted ? ' and saved it' : saveNote}${skipped}`,
      data: { pageId: page.id, persisted, applied: applied.applied, errors: applied.errors, blocks: summarizeBlocks(blocks) }
    };
  });

const runGetPage = async (deps: ServerDeps, ctx: LopuToolContext, input: { id?: string; path?: string; active?: boolean }): Promise<LopuToolResult> => {
  if (input.active) {
    const page = ctx.activePage;
    if (!page) return { ok: false, error: 'No page is open in the builder right now.' };
    return {
      ok: true,
      summary: `Active page "${page.name || page.id || 'draft'}" — ${countBlocks(page.blocks)} block(s)`,
      data: { page: { id: page.id, source: page.source, name: page.name, pageKey: page.pageKey, siteRoute: page.siteRoute, blocks: summarizeBlocks(page.blocks) } }
    };
  }
  const resolved = await deps.webpages.resolveWebpage(ctx.viewer, input.id ? { id: input.id } : { path: input.path });
  if (resolved.ok === false) return { ok: false, error: failText(resolved) };
  if (!resolved.page) return { ok: false, error: 'No page matches' };
  const page = resolved.page as PublicThingLike;
  const blocks = Array.isArray(page.crystal?.blocks) ? (page.crystal.blocks as WebpageBlock[]) : [];
  return {
    ok: true,
    summary: `Page "${nameOf(page)}" (${resolved.source}, ${countBlocks(blocks)} block(s), ${resolved.components.length} component(s))`,
    data: {
      page: { id: page.id, source: resolved.source, name: nameOf(page), pageKey: page.crystal?.pageKey, siteRoute: page.crystal?.siteRoute, updatedAt: page.updatedAt, blocks: summarizeBlocks(blocks) },
      components: resolved.components.map((component) => ({ id: component.id, componentKey: component.crystal?.componentKey, name: nameOf(component as PublicThingLike) })),
      refs: resolved.refs
    }
  };
};

const runListDemos = (input: { family?: string; kind?: string; q?: string; limit: number }): LopuToolResult => {
  const needle = input.q?.toLowerCase();
  const demos = getWebpageDemos()
    .filter((demo) => (!input.family || demo.family === input.family) && (!input.kind || demo.kind === input.kind))
    .filter((demo) => !needle || `${demo.name} ${demo.description} ${demo.tags.join(' ')} ${demo.family}`.toLowerCase().includes(needle))
    .slice(0, input.limit)
    .map((demo) => ({ slug: demo.slug, name: demo.name, family: demo.family, kind: demo.kind, tags: demo.tags, description: demo.description, blockCount: countBlocks(demo.blocks as WebpageBlock[]) }));
  const suites = getAllSuites()
    .map((suite) => summarizeBehaviourSuite(suite))
    .filter((suite) => !needle || `${suite.title} ${suite.description} ${suite.key}`.toLowerCase().includes(needle))
    .slice(0, 20)
    .map((suite) => ({ key: suite.key, title: suite.title, description: suite.description }));
  return {
    ok: true,
    summary: `${demos.length} demo(s), ${suites.length} suite(s)`,
    data: { families: WEBPAGE_DEMO_FAMILIES.map((family) => ({ key: family.key, title: family.title, kind: family.kind })), demos, suites }
  };
};

const runGetDemo = (input: { slug: string }): LopuToolResult => {
  const demo = getWebpageDemo(input.slug);
  if (!demo) return { ok: false, error: `No demo has the slug "${input.slug}" — list_demos shows the catalog` };
  return {
    ok: true,
    summary: `Demo "${demo.name}" (${demo.kind}, ${countBlocks(demo.blocks as WebpageBlock[])} block(s))`,
    data: { slug: demo.slug, name: demo.name, kind: demo.kind, family: demo.family, crystal: webpageDemoCrystal(demo) }
  };
};

const runCreateAction = async (deps: ServerDeps, ctx: LopuToolContext, callId: string, input: { crystal: Record<string, unknown> }): Promise<LopuToolResult> => {
  const sanitized = sanitizeActionCrystal(input.crystal);
  if (sanitized.ok === false) return { ok: false, error: sanitized.error };
  const created = await deps.things.createThing(ctx.viewer.id, { thingtime: ['action'], crystal: sanitized.crystal, acl: [ACL_OWNER] }, ctx.viewer);
  if (created.ok === false) return { ok: false, error: failText(created) };
  const thing = (await deps.things.toPublicThings([created.doc], ctx.viewer))[0] as PublicThingLike;
  emitThing(ctx, callId, thing);
  const effects = deriveActionEffects(sanitized.crystal.steps);
  const effectBits = [
    effects.creates.length ? `creates ${effects.creates.join(', ')}` : '',
    effects.reads.length ? `reads ${effects.reads.join(', ')}` : '',
    effects.updates ? 'updates things' : '',
    effects.deletes ? 'deletes things' : '',
    effects.invokes.length ? `invokes ${effects.invokes.join(', ')}` : '',
    effects.computes ? 'computes values' : ''
  ].filter(Boolean);
  const actionKey = typeof sanitized.crystal.actionKey === 'string' ? sanitized.crystal.actionKey : null;
  return {
    ok: true,
    summary: `Created action "${String(sanitized.crystal.name)}"${actionKey ? ` (actionKey ${actionKey})` : ''} — id ${thing.id}${effectBits.length ? `; ${effectBits.join('; ')}` : ''}`,
    data: { thing: boundThing(thing, 6 * 1024), effects }
  };
};

const runRunAction = async (deps: ServerDeps, ctx: LopuToolContext, input: { action: string; inputs: Record<string, unknown> }): Promise<LopuToolResult> => {
  const result = await deps.actions.runAction(ctx.viewer, { action: input.action, inputs: input.inputs });
  if (result.ok === false) return { ok: false, error: failText(result) };
  const summary =
    result.status === 'ok'
      ? `Ran ${input.action} in ${result.durationMs}ms (${result.opsUsed} op(s))`
      : `Action ${input.action} failed: ${result.error || 'unknown error'}`;
  return {
    ok: true,
    summary,
    data: { runId: result.runId, status: result.status, result: boundToolData(result.result, 8 * 1024), error: result.error, opsUsed: result.opsUsed, durationMs: result.durationMs }
  };
};

const runListActions = async (deps: ServerDeps, ctx: LopuToolContext): Promise<LopuToolResult> => {
  const result = await deps.things.listThings(ctx.viewer, { thingtime: ['action'], limit: MAX_LOPU_LIST_LIMIT });
  if (result.ok === false) return { ok: false, error: failText(result) };
  const actions = result.things.map((thing) => {
    const crystal = thing.crystal || {};
    return {
      id: thing.id,
      actionKey: typeof crystal.actionKey === 'string' ? crystal.actionKey : undefined,
      name: typeof crystal.name === 'string' ? crystal.name : '',
      description: typeof crystal.description === 'string' ? crystal.description.slice(0, 160) : undefined,
      inputs: Array.isArray(crystal.inputs) ? crystal.inputs.map((entry: any) => `${entry?.name}${entry?.type ? `:${entry.type}` : ''}`) : []
    };
  });
  return { ok: true, summary: `${actions.length} action(s)`, data: { actions } };
};

const runInstallSuite = async (deps: ServerDeps, ctx: LopuToolContext, input: { key: string }): Promise<LopuToolResult> => {
  const result = await deps.suites.installSuiteForViewer(ctx.viewer, input.key);
  if (result.ok === false) return { ok: false, error: failText(result) };
  return {
    ok: true,
    summary: `Installed "${result.title}" — ${result.created} created, ${result.updated} updated; the entry page is /p/${result.entryPageKey}`,
    data: {
      suite: result.suite,
      title: result.title,
      created: result.created,
      updated: result.updated,
      entryPageId: result.entryPageId,
      entryPageKey: result.entryPageKey,
      entryPath: `/p/${result.entryPageKey}`,
      pageIds: result.pageIds,
      componentIds: result.componentIds,
      actionIds: result.actionIds,
      schemaIds: result.schemaIds
    }
  };
};

const runCreateSchema = async (deps: ServerDeps, ctx: LopuToolContext, callId: string, input: { name: string; description?: string; fields: unknown[] }): Promise<LopuToolResult> => {
  const created = await deps.things.createThing(
    ctx.viewer.id,
    { thingtime: ['schema'], crystal: { name: input.name, description: input.description || '', fields: input.fields }, acl: [ACL_OWNER] },
    ctx.viewer
  );
  if (created.ok === false) return { ok: false, error: failText(created) };
  const thing = (await deps.things.toPublicThings([created.doc], ctx.viewer))[0] as PublicThingLike;
  emitThing(ctx, callId, thing);
  const fieldNames = Array.isArray(thing.crystal?.fields) ? thing.crystal.fields.map((field: any) => field?.name).filter(Boolean) : [];
  return { ok: true, summary: `Created schema "${input.name}" (${fieldNames.join(', ')}) — id ${thing.id}`, data: { thing: boundThing(thing, 6 * 1024) } };
};

const runCreateData = async (deps: ServerDeps, ctx: LopuToolContext, callId: string, input: { schema: string; values: Record<string, unknown>; public: boolean }): Promise<LopuToolResult> => {
  let schemaId: string | null = null;
  let schemaName = input.schema;
  const byId = /[$\s]/.test(input.schema) ? null : await deps.things.getThing(ctx.viewer, input.schema);
  if (byId && byId.ok !== false && (byId.thing as PublicThingLike).thingtime.includes('schema')) {
    schemaId = byId.thing.id;
    schemaName = nameOf(byId.thing as PublicThingLike) || schemaName;
  } else {
    const own = await deps.things.listThings(ctx.viewer, { thingtime: ['schema'], limit: MAX_LOPU_LIST_LIMIT });
    if (own.ok !== false) {
      const match = own.things.find((thing) => nameOf(thing as PublicThingLike).toLowerCase() === input.schema.toLowerCase());
      if (match) {
        schemaId = match.id;
        schemaName = nameOf(match as PublicThingLike);
      }
    }
  }
  const crystal: Record<string, unknown> = { ...input.values, schema: schemaName, ...(schemaId ? { schemaId } : {}) };
  const created = await deps.things.createThing(ctx.viewer.id, { thingtime: ['data'], crystal, acl: [input.public ? ACL_ALL : ACL_OWNER] }, ctx.viewer);
  if (created.ok === false) return { ok: false, error: failText(created) };
  const thing = (await deps.things.toPublicThings([created.doc], ctx.viewer))[0] as PublicThingLike;
  emitThing(ctx, callId, thing);
  return {
    ok: true,
    summary: `Created a "${schemaName}" data thing — id ${thing.id}${schemaId ? '' : ' (no matching schema thing found; stamped by name only)'}`,
    data: { thing: boundThing(thing, 6 * 1024), schemaId }
  };
};

const runUpdateThing = async (deps: ServerDeps, ctx: LopuToolContext, callId: string, input: { id: string; crystal: Record<string, unknown>; replaceCrystal: boolean }): Promise<LopuToolResult> => {
  const updated = await deps.things.updateThing(ctx.viewer, input.id, { crystal: input.crystal }, { replaceCrystal: input.replaceCrystal });
  if (updated.ok === false) return { ok: false, error: failText(updated) };
  const thing = updated.thing as PublicThingLike;
  emitThing(ctx, callId, thing);
  return { ok: true, summary: `Updated ${kindOf(thing)} "${nameOf(thing) || thing.id}" (${Object.keys(input.crystal).join(', ')})`, data: { thing: boundThing(thing) } };
};

const runDeleteThing = async (deps: ServerDeps, ctx: LopuToolContext, input: { id: string; confirmed: boolean }): Promise<LopuToolResult> => {
  if (!input.confirmed) {
    return {
      ok: false,
      error: 'Refused: deleting needs the user’s explicit confirmation. Tell them what would be deleted, ask them to confirm, and only then call delete_thing again with confirmed: true.'
    };
  }
  const result = await deps.things.deleteThing(ctx.viewer, input.id);
  if (result.ok === false) return { ok: false, error: failText(result) };
  return { ok: true, summary: `Deleted ${input.id}`, data: { id: input.id } };
};

const runNavigate = (ctx: LopuToolContext, callId: string, input: { path: string }): LopuToolResult => {
  ctx.emit({ type: 'navigate', id: callId, path: input.path });
  return { ok: true, summary: `Navigating the user to ${input.path}`, data: { path: input.path } };
};

// The one entry point the provider loop calls. Validates, executes as the
// viewer, and never throws.
export const runLopuTool = async (call: LopuToolCall, ctx: LopuToolContext): Promise<LopuToolResult> => {
  const validated = validateLopuToolInput(call.name, call.input);
  if (validated.ok === false) return validated;
  const input = validated.input as any;
  try {
    switch (call.name as LopuToolName) {
      case 'list_demos':
        return runListDemos(input);
      case 'get_demo':
        return runGetDemo(input);
      case 'navigate':
        return runNavigate(ctx, call.id, input);
      case 'delete_thing':
        // the refusal needs no server — keep it in front of the lazy import
        if (!input.confirmed) return await runDeleteThing(null as unknown as ServerDeps, ctx, input);
        break;
      default:
        break;
    }
    const deps = await loadServerDeps();
    switch (call.name as LopuToolName) {
      case 'search_things':
        return await runSearchThings(deps, ctx, input);
      case 'get_thing':
        return await runGetThing(deps, ctx, input);
      case 'list_my_things':
        return await runListMyThings(deps, ctx, input);
      case 'create_component':
        return await runCreateComponent(deps, ctx, call.id, input);
      case 'update_component':
        return await runUpdateComponent(deps, ctx, call.id, input);
      case 'browse_components':
        return await runBrowseComponents(deps, ctx, input);
      case 'create_page':
        return await runCreatePage(deps, ctx, call.id, input);
      case 'patch_page':
        return await runPatchPage(deps, ctx, call.id, input);
      case 'get_page':
        return await runGetPage(deps, ctx, input);
      case 'create_action':
        return await runCreateAction(deps, ctx, call.id, input);
      case 'run_action':
        return await runRunAction(deps, ctx, input);
      case 'list_actions':
        return await runListActions(deps, ctx);
      case 'install_suite':
        return await runInstallSuite(deps, ctx, input);
      case 'create_schema':
        return await runCreateSchema(deps, ctx, call.id, input);
      case 'create_data':
        return await runCreateData(deps, ctx, call.id, input);
      case 'update_thing':
        return await runUpdateThing(deps, ctx, call.id, input);
      case 'delete_thing':
        return await runDeleteThing(deps, ctx, input);
      default:
        return { ok: false, error: 'Unknown tool' };
    }
  } catch (error: any) {
    // a thrown Response (readJsonBody-style) or a storage/DB failure — the
    // model gets a plain sentence, the server log gets the detail
    console.error(`[lopu] tool ${call.name} threw:`, error?.message || error);
    return { ok: false, error: `${call.name} failed: ${typeof error?.message === 'string' ? error.message.slice(0, 300) : 'unexpected error'}` };
  }
};

// Pure helper for prompts/tests: the grammar the tools speak, pulled from code.
export const LOPU_TOOL_GRAMMAR = {
  blockTypes: [...WEBPAGE_BLOCK_TYPES],
  componentArgTypes: [...COMPONENT_ARG_TYPES],
  actionStepOps: [...ACTION_STEP_OPS],
  actionCapabilities: [...ACTION_CAPABILITIES],
  actionInputTypes: [...ACTION_INPUT_TYPES]
} as const;
