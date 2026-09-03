# Lopu AI assistant — design note

Branch `claude/lopu-ai-chatbot-358029` → `develop`. Built on top of PR #578
(builder demo library, action grammar v2, page runtime, `liveComponent.tsx`).

Lopu becomes a real assistant: a streamed chat with model / reasoning-effort /
speed selection drawn from an `ai-model` catalog stored in Thingtime, tool-use
that builds webpages, components, sections and actions **as the viewer**, and
live streamed builder patches that render on screen while the reply is still
streaming. Conversations live in Messenger. Surfaces: `/lopu` page, a Drawer
link, and a global floating launcher + draggable/resizable chat window.

Everything below is normative for the implementation agents. Where this note
and the code disagree, fix the code (or this note in the same commit).

---

## 0. House rules that apply everywhere

- API only (FUNDAMENTALS §1). Every write goes through `api/utils` and the
  unified things path (`createThing`/`updateThing`/`deleteThing` as the viewer).
- New `/api/v1` endpoints register in THREE places: route file, the import map
  in `remix/server/routes/api/[...].ts`, and an `endpoint({...})` entry in
  `remix/app/docs/apiDocs.ts` (`contractVersion: '1.0.0'`, `featureVersion`
  when bumping). Add a `RATE_LIMIT_DEFAULTS` key for every route and call
  `enforceRateLimit`. Add `apiTests.ts` entries (group `lopu`). Pin new
  `api.<id>` features in `apiCapabilities.test.ts` /
  `thingtimeCapabilities.test.ts` only if those tests enumerate ids explicitly.
- Streaming is NDJSON (`application/x-ndjson; charset=utf-8`,
  `Cache-Control: no-store`, `X-Accel-Buffering: no`), one JSON object per
  line, via `new Response(new ReadableStream(...))` exactly like
  `routes/api/v1/lopu/musing/_musing.tsx`.
- Every AI call site resolves its model through the Admin waterfall helpers
  (`getAiPreferredModelWaterfall`, `resolveAiPreferredAnthropicChoice`,
  `resolveAiPreferredOpenAiChoice`, `toAnthropicEffort`,
  `toOpenAiReasoningEffort`) and is listed in
  `remix/scripts/ai-model-routing-contract.mjs`. That script must be changed to
  read `app/api/utils/lopu/musing.ts` by explicit path (it currently assumes
  `directClientFiles[0]` is musing.ts; a new `lopu/chat.ts` sorts before it).
- Never `Write` a shared file; use `Edit` with a freshly re-read `old_string`.
  Shared files: `registry.ts`, `apiDocs.ts`, `[...].ts`, `rateLimit/config.ts`,
  `apiTests.ts`, `useApi.tsx`, `routes.tsx`, `root.tsx`, `drawerMenu.tsx`,
  `useDrawer.tsx`, `messenger.ts`, `externalAi.ts`, `messengerTypes.ts`,
  `package.json`, `README.md`, `TESTING.md`, `FUNDAMENTALS.md`,
  `remix/CHANGELOG.md`.
- User-facing notifications: `useLopu()` only. Optimistic rendering: seed from
  `readLocalCache('tt-lopu-…')`, refetch in the background, never flash a
  spinner over known state. Sweep `tt-lopu-` on logout.
- Lint changed files with `corepack pnpm --dir remix run lint:files -- <files>`.
  Full `tsc --noEmit` is known-broken; use focused `node --test` suites.
- Before reading source, run `scripts/graphify query "<symbols>"` from the repo
  root (hook mandates it). Never `cd` into `remix/` for a persistent shell;
  use absolute paths.

---

## 1. Data model

### 1.1 `ai-model` things (the model catalog)

A new **protected, control-plane** kind. Seeded from `AI_WORKFLOW_BASE_MODELS`
(`prConflictResolverModelWaterfallCore.ts`), one doc per base model, owned by
`system`, `storageClass: 'control'`, `acl: ['tt:all']`,
`shareId: 'ai-model-<modelId>'`, `uniqueKeys: [thingUniqueKey('aiModel', modelId)]`.

```ts
crystal: {
  modelId: 'claude-opus-5',          // provider-native id == catalog id
  label: 'Claude Opus 5',
  provider: 'anthropic' | 'openai',  // 'default' sentinel is NOT a doc
  efforts: ['low','medium','high','xhigh','max'],   // from catalog
  speeds: ['normal','fast'],                          // from catalog
  family: 'claude' | 'gpt' | 'o-series',             // derived
  enabled: true,                    // admin toggle (default true)
  sortOrder: 10,                    // catalog index
  contextWindow?: 1000000,          // optional, from a static table
  notes?: string
}
```

Registration (`registry.ts`): `aiModelSchema` (kind `'crystal'`, id
`'ai-model'`) in `thingtimeSchemas`; add `'ai-model'` to `PROTECTED_THINGTIME`
(generic create/update/delete refuse it) and to
`CONTROL_PLANE_STORAGE_THINGTIMES` (`storage/storageCore.ts`). No
`crystalSanitizers` entry (dedicated writer only). FUNDAMENTALS §3 gets a row.

Writer: `remix/app/api/utils/ai/models.ts`

- `ensureAiModelCatalog()` — idempotent upsert of every catalog model (via
  `getHomeThingsCollection()` + `thingUniqueKeyFilter('aiModel', id)`,
  `$setOnInsert` root fields, `$set` label/provider/efforts/speeds/sortOrder,
  never touching `enabled`). Memoised per process (runs once per boot on the
  first read) and callable from the admin route.
- `listAiModels(viewer)` → `{ ok:true, models: AiModelPublic[], defaults, providers }`
  where `AiModelPublic = { id, label, provider, efforts, speeds, family, enabled, available, isDefault }`,
  `available = enabled && providerConfigured(provider)`,
  `providers = { anthropic: { configured: !!process.env.ANTHROPIC_API_KEY }, openai: { configured: !!process.env.OPENAI_API_KEY } }`
  (also honour `ANTHROPIC_AUTH_TOKEN`), and
  `defaults = resolveLopuChatDefaults(models)` = `{ model, effort, speed }`.
- `resolveLopuChatDefaults` — settings singleton `Thingtime.LopuChatDefaults`
  (`api/utils/settings/lopuChatDefaults.ts`, same store pattern as the
  waterfall store, admin POST / public GET route
  `/api/v1/settings/lopu-chat-defaults`) holding
  `{ model: 'claude-opus-5', effort: 'high', speed: 'normal' }`; if the stored
  model is unavailable fall back to the first available model in catalog order,
  effort clamped to that model's `efforts` (prefer `'high'`, else last), speed
  `'normal'` unless offered. If NO provider is configured, `defaults.model` is
  `null` and chat replies come from the canned fallback.
- `setAiModelEnabled(id, enabled)` (admin).
- `resolveLopuModelChoice(requested: { model?, effort?, speed? }, models)` →
  `{ ok:true, choice: AiWorkflowModelChoice }` or `{ ok:false, status:400, error }`
  — validates against the catalog + availability (composed ids accepted via
  `parseAiWorkflowModelOptionId`, plain `{model,effort,speed}` also accepted).

Routes:

- `GET /api/v1/ai/models` (optional auth, rate `ai.models` 120/min) → the list above.
- `POST /api/v1/admin/ai/models` (admin, rate `admin.ai.models` 30/min failClosed)
  body `{ id, enabled }` → `{ ok, model }`; `POST` with `{ seed: true }` re-runs
  `ensureAiModelCatalog()` and returns `{ ok, seeded, models }`.
- `GET|POST /api/v1/settings/lopu-chat-defaults` (public GET, admin POST).

### 1.2 Lopu conversations in Messenger

Reuse the messenger family with a discriminator (no new chat kind):

- **chat**: `newThingDoc('chat', { ownerId: user.id, targetId: null, crystal })`,
  `shareId: 'lopu-chat-<uuid>'` (prefix reserved nowhere else; keep it
  recognisable), crystal:
  ```ts
  {
    chatType: 'group', name: <title | 'Lopu'>, topic: 'Lopu, the Thingtime assistant',
    communityId: null, sectionId: null, channelVisibility: null, dmKey: null,
    externalSource: { access: 'lopu', provider: 'lopu', sourceId: 'lopu', label: 'Lopu', connector: 'thingtime', readOnly: false },
    lopu: { model: 'claude-opus-5', effort: 'high', speed: 'normal', turns: 0, lastModel: null }
    // model/effort/speed are validated against AI_WORKFLOW_BASE_MODELS at write
    // time; null (the create default) means "catalog default" — the reply route
    // resolves it through resolveLopuChatDefaults + availability every turn
  }
  ```
- **chat-member**: exactly one, the user (`role: 'owner'`, `state: 'active'`).
  There is no Lopu user thing (decision: mirror `deviceLiveAi`).
- **chat-message (user turn)**: plain row owned by the user
  (`shareId: messageIdForRequest(user.id, requestId)`), no externalSource →
  stays editable/deletable.
- **chat-message (assistant turn)**: owned by the user,
  `shareId: messageIdForRequest(user.id, requestId + ':assistant')`,
  `crystal.externalSource: { access:'lopu', provider:'lopu', sourceId:'lopu', label:'Lopu', connector:'thingtime', readOnly:true, role:'assistant', authorName:'Lopu', messageId: requestId, revision: 1 }`,
  `crystal.lopu: { model, effort, speed, provider: 'claude'|'openai'|'test'|'fallback', usage?: { inputTokens, outputTokens }, toolCalls: [{ name, ok, summary, thingId? }] (≤ 20, each summary ≤ 240 chars), stopReason }`.
  Text > 4000 chars is split with `splitLiveMessageText` into
  `segmentIndex/segmentCount` rows (same as deviceLiveAi).
- After each turn: rewrite `chat.crystal.lastMessage` (preview of the
  assistant text, `externalSource` attached), bump `updatedAt`, bump
  `crystal.lopu.turns`, advance the member's `lastReadMessageId/lastReadAt` to
  the assistant row (so the user's own conversation never bolds).

Server changes in the messenger family:

- `externalAi.ts`: add `'lopu'` to `AI_SOURCE_PROVIDERS` and an
  `access === 'lopu'` branch in `publicExternalAiSource` returning
  `PublicLopuExternalAiSource = { access:'lopu', provider:'lopu', sourceId, label, connector, readOnly: boolean, role?, authorName?, messageId?, revision?, segmentIndex?, segmentCount? }`
  (`readOnly` is false on the chat and true on assistant rows, mirroring the
  stored flag). `crystal.lopu` on message rows projects onto
  `PublicChatMessage.lopu` (`publicLopuMessageMeta`: role, requestId,
  segment info, and for assistant rows model/effort/speed/provider/usage/
  toolCalls/stopReason) so the chat UI can render tool cards for history.
- `messenger.ts`: export `resolveChatAccess`, `chatListEntryFor` (or a
  `listChatsById`), `projectMessages`, `touchChat`, `chatPreviewOf`,
  `insertChatMember`/`newChatMemberDoc`; narrow the 409 guards so
  `externalSource.access === 'lopu'` chats may be renamed via `updateChat` and
  Lopu rows may be deleted via `deleteMessage` (assistant rows stay
  non-editable).
- New util `remix/app/api/utils/messenger/lopuChats.ts`:
  - `createLopuChat(viewerId, { title?, model?, effort?, speed? })` → `{ ok, chat: LopuChatEntry }`
    where `LopuChatEntry = ChatListEntry & { lopu: { model, effort, speed, turns, lastModel } }`
    (the chat's own settings ride on every list/create/update/get entry so the
    client adopts them when the conversation is selected — no second round trip)
  - `listLopuChats(viewerId, { limit? })` → `{ ok, chats: LopuChatEntry[] }` (owner query on `crystal.externalSource.provider === 'lopu'`; rows take the `listChats` summary path)
  - `getLopuChat(viewerId, chatId)` → `{ ok, chat, myMember, settings: crystal.lopu }`
  - `updateLopuChat(viewerId, chatId, { title?, model?, effort?, speed? })` → `{ ok, chat: LopuChatEntry }`
    (model/effort/speed validate statically against `AI_WORKFLOW_BASE_MODELS`;
    enablement/availability is resolved per turn by the reply route — stored
    settings leniently, explicit per-turn overrides strictly → 400)
  - `deleteLopuChat(viewerId, chatId)` — owner only; deletes chat + member + messages (+ reactions on them) in one `withMessengerStorageTransaction`
  - `persistLopuUserTurn(viewerId, { chatId, requestId, text })` → `{ ok, message: PublicChatMessage }` (409 on requestId reuse, same rule as sendMessage)
  - `persistLopuAssistantTurn(viewerId, { chatId, requestId, text, lopu })` → `{ ok, messages: PublicChatMessage[] }` (segments), also touches chat + member
  - `loadLopuHistory(viewerId, chatId, { limit = 40 })` → ordered `{ role:'user'|'assistant', text }[]` for the model (oldest first, capped by chars ≤ 60k)
  All utils gate with `resolveChatAccess(viewerId, chatId, { requireActive: true })`
  AND `chat.crystal.externalSource?.provider === 'lopu'`.

Routes (group `lopu`, all session-only, `Content-Type: application/json` for POST):

- `GET /api/v1/lopu/chats` (rate `lopu.chats` 120/min) → `{ ok, chats }`
- `POST /api/v1/lopu/chats` body `{ title?, model?, effort?, speed? }` (rate `lopu.chats.write` 30/min) → `{ ok, chat }`
- `POST /api/v1/lopu/chats/update` body `{ chatId, title?, model?, effort?, speed? }` → `{ ok, chat }`
- `POST /api/v1/lopu/chats/delete` body `{ chatId }` → `{ ok }`
- `POST /api/v1/lopu/chats/reply` — the streamed turn (section 3).

Client types (`components/Messenger/messengerTypes.ts`): `LopuAiSource`,
`ExternalAiSource` union extended, `isLopuAiSource(source)`.

---

## 2. Provider layer and tools

### 2.1 Files

- `remix/app/api/utils/lopu/chat.ts` — `streamLopuChatTurn(input): AsyncGenerator<LopuChatEvent>`
  (provider loop, tool loop, fallbacks). Constructs `new Anthropic()` /
  `new OpenAI()`; must be added to `ai-model-routing-contract.mjs` with
  assertions mirroring musing.ts (waterfall read, `resolveAiPreferred*Choice`,
  a named ≥4-digit ceiling `LOPU_CHAT_MAX_OUTPUT_TOKENS = 16000` used for
  `max_tokens` and `max_completion_tokens`, no `model: process.env.*`).
- `remix/app/api/utils/lopu/chatTools.ts` — tool definitions (JSON schema) +
  executors (`runLopuTool(viewer, name, input, ctx)`); pure definitions exported
  separately (`LOPU_TOOL_DEFINITIONS`) so tests and the prompt builder can
  import them without Mongo.
- `remix/app/api/utils/lopu/chatPrompt.ts` — `buildLopuSystemPrompt(ctx)`:
  Lopu's voice (extend the musing SYSTEM_PROMPT: whimsical unicorn, warm, at
  most one emoji per message, concise, never claims to have done something a
  tool did not confirm), Thingtime concepts (things/kinds, builder pages =
  block trees, components = render templates with the ttArg DSL, sections =
  container blocks, actions = declarative programs), the exact grammars pulled
  from code (`WEBPAGE_BLOCK_TYPES` + caps, `COMPONENT_ARG_TYPES`, allowlisted
  tags, `ACTION_STEP_OPS`, `ACTION_CAPABILITIES`, `EXPRESSION_FUNCTION_NAMES`
  with docs), a few-shot page (`webpageDemoCrystal` of a small demo) and a
  few-shot component + action (from `behaviourSuites`), and the live context
  (route, active page target + its current block ids/types summary, selected
  block id, viewer username). Put the stable part first with
  `cache_control: { type: 'ephemeral' }` on the Anthropic side and the volatile
  context in a second system block.
- `remix/app/api/utils/lopu/chatEvents.ts` — the `LopuChatEvent` union (2.3).
- `remix/app/api/utils/lopu/chatTestProvider.ts` — deterministic scripted
  provider for `LOPU_CHAT_PROVIDER=test` (and `?provider=test` never; env only).
- `remix/app/utils/partialJson.ts` — isomorphic tolerant JSON parser
  (`parsePartialJson(text): { value, complete }`) that closes open strings /
  arrays / objects so streamed tool inputs can be previewed; unit tested.
- `remix/app/api/utils/lopu/pageOps.ts` — isomorphic patch-op grammar +
  `applyPageOps(blocks, ops)` (uses `components/Builder/webpageBlocks.ts` pure
  ops) shared by server (persist) and client (live draft).

### 2.2 Provider behaviour

Order: explicit choice's provider first; if that provider fails before any
text, try the other configured provider with its waterfall/default choice;
finally the fallback stream (`streamFallbackReply` — an honest canned line such
as "Lopu is resting her horn — no AI provider is configured yet. Ask an admin
to add ANTHROPIC_API_KEY." when nothing is configured, or "Lopu is
daydreaming… try again 🔮" on provider errors). Never a blank reply.

`LOPU_CHAT_PROVIDER` env: `auto` (default) | `claude` | `openai` | `test`.
`LOPU_OPENAI_TOOLS` env: `native` (default) | `text` — text mode makes tools
work on OpenAI-compatible endpoints that lack function calling (the local Codex
proxy): the system prompt describes the tool protocol and the model emits
```` ```tt-tool\n{"name":"…","input":{…}}\n``` ```` fenced blocks; the parser
extracts them from streamed text (text outside fences is still streamed as
`delta`), executes, and continues the loop by appending the tool result as a
user message.

Anthropic (installed SDK 0.105.0): `client.messages.stream({ model, max_tokens: LOPU_CHAT_MAX_OUTPUT_TOKENS, system: [...], messages, tools, tool_choice: { type:'auto' }, ...(effort ? { output_config: { effort } } : {}) })`;
fast → `client.beta.messages.stream({ ...same, speed:'fast', betas:['fast-mode-2026-02-01'] })`
with the decorated→bare retry ladder from musing.ts (retry only if nothing was
emitted). Thinking is left at the model default (adaptive on Opus 5). Raw event
handling: `content_block_start` (`tool_use` → `tool_use_start`),
`content_block_delta` (`text_delta` → `delta`; `input_json_delta` →
`tool_input_delta` with the partial JSON appended per block index),
`content_block_stop` (tool → `tool_use` with parsed input), then
`stream.finalMessage()`; push assistant content; while `stop_reason === 'tool_use'`
execute tools (in parallel via `Promise.all`, results returned in ONE user
message as `tool_result` blocks, `is_error` on failure) and loop. Max 12 hops,
max 24 tool executions per turn, total wall clock 240 s, then a final text
hop with `tool_choice: { type:'none' }`. Set `eager_input_streaming: true` on
`create_component`, `update_component`, `create_page`, `patch_page`
(fine-grained tool streaming so previews stream).

OpenAI: `chat.completions.create({ model, stream:true, max_completion_tokens, messages, tools:[{type:'function',function:{name,description,parameters}}], tool_choice:'auto', ...(reasoning_effort), ...(service_tier:'priority' when fast) })`;
accumulate `choices[0].delta.tool_calls[i].function.arguments` per index,
emitting `tool_input_delta`; `finish_reason === 'tool_calls'` → execute →
append `{ role:'assistant', tool_calls }` + `{ role:'tool', tool_call_id, content }` and loop.
The attempt ladder is decorated stream → bare stream → **plain completion**
(`stream: false`, no `stream_options`): OpenAI-compatible endpoints that
refuse streaming (the local Codex proxy answers 400 "Streaming is not
implemented") are served by the last rung, whose answer is replayed as chunks
(word-ish deltas, indexed tool_calls, a finish chunk with usage); once that
rung wins, later hops go straight to it. Plain answers are normalised before
parsing: an envelope the bridge's model wrapped around the reply
(`{"choices":[{"message":{"content":…}}]}`, `{"content":…}`,
`{"message":…}`, or the whole reply as one JSON string literal) is unwrapped
(`unwrapEnvelopeContent`), and in text mode a reply that is nothing but a
tool-call object/array naming known tools is re-fenced as tt-tool blocks
(`wrapBareToolCalls`). The text parser also accepts `tool`/`arguments`
spellings and a JSON-escaped fence body.

Test provider: given the latest user text, a script keyed by keywords:
- contains "hello"/default → text only.
- contains "component" → `create_component` (a small card component with an
  arg `title`), then text.
- contains "page" or "section" or "hero" → `create_page` (if no active page)
  or `patch_page` inserting a container with heading + text + the component
  (always Lopu's own `lopu-test-card` — built this turn when asked for,
  otherwise the one an earlier turn made; the script never depends on a
  seeded catalog), streamed in ≥ 6 `tool_input_delta` chunks so live
  rendering is exercised.
- contains "action" → `create_action` (pong) then `run_action`.
- contains "delete" → `delete_thing` without `confirmed` → tool refuses →
  text asks for confirmation.
It must produce the same event sequence shape as the real providers.

### 2.3 Event protocol (NDJSON, one per line)

```ts
type LopuChatEvent =
  | { type:'meta'; chatId; userMessageId; requestId; model; effort; speed; provider:'claude'|'openai'|'test'|'fallback'; label }
  | { type:'delta'; text }                                   // assistant text
  | { type:'thinking'; text }                                 // optional summarized thinking
  | { type:'tool_use_start'; id; name }
  | { type:'tool_input_delta'; id; name; partial }            // raw partial JSON fragment
  | { type:'tool_use'; id; name; input }                      // complete parsed input
  | { type:'tool_result'; id; name; ok; summary; data? }      // data bounded ≤ 16KB, e.g. { thing } or { ops, pageId }
  | { type:'patch'; id; target: PatchTarget; ops: PageOp[]; pageId?; persisted: boolean }  // live builder patch (2.5)
  | { type:'thing'; id; kind; thing }                         // created/updated public thing (component/page/action)
  | { type:'navigate'; id; path }                             // client should navigate
  | { type:'error'; message; retryable }
  | { type:'done'; assistantMessageId; messages: PublicChatMessage[]; usage?; stopReason }
```

Events are emitted in stream order; `patch`/`thing`/`navigate` are emitted by
the tool executor as soon as the tool completes (before `tool_result`). `id`
on every tool-scoped event (`tool_use_start` … `tool_result`, `patch`,
`thing`, `navigate`) is the TOOL CALL id, so the client attaches patches and
created things to the tool card that made them; a created thing's own id is
`thing.thing.id`. `meta` is always first; `done` is always last and is emitted
by the route after the assistant turn is persisted (the generator returns the
turn outcome instead of yielding `done`).

### 2.4 Tools (server-executed as the viewer)

All executors return `{ ok:true, summary, data? } | { ok:false, error }` and
NEVER throw. Errors (validator strings) are fed back verbatim so the model can
self-correct. Every tool input is validated with a small hand-written guard
(no zod dependency).

| name | input | effect |
|---|---|---|
| `search_things` | `{ query, kinds?: string[], limit?: ≤20 }` | viewer-visible search (things search util); returns `[{ id, kind, name, snippet }]` |
| `get_thing` | `{ id }` | `getThing` as viewer; returns public thing (crystal bounded to 16KB, render trees truncated with a note) |
| `list_my_things` | `{ kind: 'webpage'|'component'|'action'|'schema'|'data', limit?: ≤50 }` | `listThings` own |
| `create_component` | `{ name, componentKey, description?, category?, args?, render, previewBg?, public?: boolean }` | `validateThingtimeCrystal(['component'])` then `createThing` (acl `['tt:user']` unless public). Emits `thing`. |
| `update_component` | `{ id, render?, args?, name?, savedArgs?, bumpVersion?: true }` | `updateThing` (merge). Emits `thing`. |
| `browse_components` | `{ q?, limit?: ≤12 }` | `/components/browse` util |
| `create_page` | `{ name, pageKey?, blocks, public?: boolean, open?: boolean }` | validate `webpage` crystal, `createThing`; emits `thing` (+ `navigate` to `/builder?page=<id>` when `open`) |
| `patch_page` | `{ target: 'active' \| { id }, ops: PageOp[], persist?: boolean }` | resolve target (2.5), apply ops server-side to the known block tree, validate, `updateThing` when persisting; emits `patch` (always) and `thing` (when persisted) |
| `get_page` | `{ id \| path \| 'active' }` | `resolveWebpage` (+ components) |
| `list_demos` / `get_demo` | `{ family?, kind?, q? }` / `{ slug }` | catalog read (few-shot) |
| `create_action` | `{ crystal }` | `sanitizeActionCrystal` (isomorphic) → `createThing(['action'], acl tt:user)`; result includes `deriveActionEffects` summary. Emits `thing`. |
| `run_action` | `{ action, inputs? }` | `runAction(viewerOf(user), { action, inputs })` (deliberate path) |
| `list_actions` | `{}` | own actions (key, name, inputs) |
| `install_suite` | `{ key }` | `installSuiteForViewer` |
| `create_schema` | `{ name, description?, fields }` | `createThing(['schema'])` |
| `create_data` | `{ schema, values }` | `createThing(['data'])` |
| `update_thing` | `{ id, crystal, replaceCrystal? }` | generic `updateThing` (messenger/protected kinds refuse naturally) |
| `delete_thing` | `{ id, confirmed: boolean }` | refuses unless `confirmed === true`; `deleteThing` |
| `navigate` | `{ path }` | emits `navigate` (site-relative only) |

Tool inputs are capped at 96KB serialised; more than 24 tool executions in one
turn ends the loop with an `error` event and a final text hop.

### 2.5 Patch-op grammar (`pageOps.ts`, isomorphic)

```ts
type PatchTarget = 'active' | { id: string };
type PageOp =
  | { op:'insert'; containerId: string|null; index: number|'end'; block: WebpageBlock }
  | { op:'update'; id: string; patch: Partial<WebpageBlock> }        // text/args/css/… (id/type preserved)
  | { op:'replace'; id: string; block: WebpageBlock }                // same id, new content
  | { op:'remove'; id: string }
  | { op:'move'; id: string; containerId: string|null; index: number }
  | { op:'setBlocks'; blocks: WebpageBlock[] }                        // whole tree (last resort)
```

`applyPageOps(blocks, ops)` returns `{ blocks, applied: number, errors: string[] }`
using `insertBlock/updateBlock/removeBlock/moveBlock` from
`components/Builder/webpageBlocks.ts`; `replace` = remove + insert at the same
parent/index. New block ids must be unique lowercase-dashed; the server
rewrites duplicate ids with `newBlockId`. After applying, the server validates
with `validateThingtimeCrystal(['webpage'], { ...crystal, blocks })`.

Target resolution on the server: the reply request carries
`context.page = { id?: string, source?: 'user'|'system', pageKey?, siteRoute?, updatedAt?, blocks?: WebpageBlock[] (the client's current draft, ≤48KB) }`
when a builder draft is open. `'active'` → that page; the server applies ops to
`context.page.blocks` (the live draft) and persists only when
`context.page.source === 'user'` and `persist !== false`
(PATCH with `expectedUpdatedAt`); otherwise `persisted: false` and the client
keeps the draft dirty for the user to Save/fork. If no active page exists,
`patch_page` with `'active'` returns an error telling the model to call
`create_page` (which then becomes the active page for the rest of the turn —
the executor tracks `ctx.activePage`).

Client (`lopuBuildBridge.ts`): a module registry of mounted drafts
(`registerWebpageDraft(handle)` from `useWebpageDraft`,
`getActiveWebpageDraft()` = most recently registered/focused editable draft:
BuilderCanvas or SiteBlocksEditor page draft; `/p/` read-only drafts never
count). On a `patch` event the client applies ops via
`draft.setBlocks(applyPageOps(draft.blocks, ops).blocks)` immediately (each op
paints as it lands); on `thing` events for components it calls
`draft.addComponent(componentKey, thing)` AND `draft.addComponent(thing.id, thing)`
so `component` blocks render instantly; if `persisted` is true the client also
calls `draft.markSaved(thing)` (new small method) to clear `dirty` and update
`resolved.page.updatedAt`, and dispatches `thingtime:webpage-saved`.

**Live streaming preview**: while `tool_input_delta` events arrive for
`create_component`/`update_component`/`create_page`/`patch_page`, the client
runs `parsePartialJson` on the accumulated fragment and, when it yields an
object with a plausible `render` (component) or `ops`/`blocks` (page), renders
a **LopuLivePreview** inside the chat bubble (component: `resolveTemplate` +
`ChakraThingRenderer`/`HtmlThingRenderer`, clipped, no click wrapper; page:
`WebpageBlocksRenderer` bare) — re-rendered on every delta (throttled to one
paint per animation frame). For `update_component` targeting a component that
is on the active page, the partial render is also pushed into the draft via
`draft.addComponent(ref, { ...thing, crystal: { ...crystal, render: partial } })`
so the on-page component visibly rebuilds token by token; the final `thing`
event replaces it with the saved version. For `patch_page`, ops whose JSON is
already complete inside the partial array are applied to the draft as soon as
they close (tracked by op index) — the page grows block by block while the
model is still writing.

### 2.6 Reply request

`POST /api/v1/lopu/chats/reply` (session only; rate `lopu.chat` 40 per 10 min
per user, `failClosed: true`; body ≤ 256KB):

```ts
{
  chatId?: string,            // omit → create a chat titled from the first message
  text: string,               // ≤ 8000 chars
  requestId: string,          // client uuid; idempotent (409 on reuse)
  model?: string, effort?: string, speed?: string,   // override the chat's settings for this turn (and persist as chat settings)
  context?: {
    route?: string,
    page?: { id?, source?, pageKey?, siteRoute?, updatedAt?, blocks? },
    selectedBlockId?: string,
    viewport?: 'mobile'|'desktop'
  }
}
```

Flow: validate → resolve model choice → persist user turn → stream events →
persist assistant turn (even on error/abort, persisting what streamed plus a
note) → `done`. If the client disconnects, the server still finishes
persisting (wrap the generator in a `try/finally`; use `request.signal` to
abort provider calls).

---

## 3. Client

### 3.1 Shared chat state — `components/Lopu/useLopuChat.ts`

```ts
useLopuChat({ chatId?: string|null, context?: LopuContextProvider }) → {
  chats, chat, messages, streaming: LopuTurnState|null, sending,
  send(text, { model?, effort?, speed? }), abort(), selectChat(id|null), createChat(), deleteChat(id), renameChat(id, title),
  models, modelsLoading, settings: { model, effort, speed }, setSettings(...),
  error
}
```
Caches: `tt-lopu-chats-<userId>`, `tt-lopu-messages-<chatId>` (last 50),
`tt-lopu-models`, `tt-lopu-settings-<userId>`. Streaming reducer
`reduceLopuTurn(state, event)` in `components/Lopu/lopuTurnCore.ts` (pure,
unit-tested): accumulates text, tool activities (`{ id, name, status, input, partialInput, result }`),
patches applied, things created. NDJSON reader `readNdjson(response, onEvent, signal)`
in `components/Lopu/lopuChatStream.ts` (copy the useLopuStream loop, `credentials:'include'`, POST).

### 3.2 Components

- `LopuChatView` (`components/Lopu/LopuChatView.tsx`) props
  `{ chatId?: string|null, onChatChange?(id), compact?: boolean, context?: LopuContextProvider, showConversations?: boolean, onOpenFull?() }`
  — message list (user bubbles right, Lopu bubbles left with 🦄 avatar and
  rainbow accent, markdown-ish rendering: paragraphs, inline code, fenced code
  blocks; NO raw HTML), streaming caret `▍`, tool activity cards
  (`LopuToolCard`: name → friendly label, spinner → ✓/🌧️, summary, links to
  `/builder?page=`, `/components/<key>`, `/actions/<key>`, "Undo" for patches
  where the draft is still mounted), `LopuLivePreview` inside the streaming
  bubble, an empty state with suggestion chips ("Build me a landing page
  hero", "Make a pricing table component", "Create an action that saves a
  note", "What can you do?"), and the composer.
- `LopuComposer` — textarea (Enter sends, Shift+Enter newline, mobile: button),
  `LopuModelPicker` (model → efforts for that model → speed toggle only when
  offered; unavailable models shown disabled with "needs <provider> key"),
  context chip when a builder draft is active ("✏️ editing: <page name>"),
  stop button while streaming.
- `LopuPage` (`/lopu`, `/lopu/:chatId`): `PageShell width=1100`, header
  eyebrow "Thingtime · your AI", title "Lopu 🦄"; left column conversations
  (new chat, rename, delete, open in Messenger), main `LopuChatView`. Signed-out
  (or temporary user): quiet state with what Lopu can do + login CTA.
  `FULL_BLEED_PATHS` gets `/lopu` (startsWith). `document.title` branch.
  QuickSwitcher row + Commander `navCommand('lopu', '/lopu', 'Talk to Lopu', '🦄', ['ask','chat','ai'])`.
- `LopuHost` (`components/Lopu/LopuHost.tsx`, mounted in root.tsx after
  `DrawerSystem`, gated `mounted && !isAuthorizePopup`): launcher bubble (🦄,
  48px, rainbow ring, draggable with `startPointerGesture`, clamped, persisted
  in `tt-lopu-launcher`, default bottom-right stacked 72px above DevKit's
  corner) + window (`tt-lopu-window` `{x,y,width,height}`, default 400×560
  bottom-right, min 320×360, max viewport−24, drag by header, resize grip
  bottom-right + edges optional, double-click header → dock to right edge
  (a right-docked column stops `LOPU_DEVKIT_CLEARANCE` = 72px above DevKit's
  corner so the composer stays reachable, and the launcher hides while a
  column is docked; double-click again to float), Escape closes (an open
  menu/picker inside the window takes the Escape first), header buttons:
  model chip, "open in /lopu" ⤢, minimise −, close ✕); on mobile
  (`useIsMobileViewport`) render as an 88dvh bottom sheet instead, flagging
  `<html data-lopu-sheet="open">` so DevKit's trigger steps aside. DevKit also
  hides itself on `/lopu*` exactly as on `/messages*`. z rungs exported from
  `useDrawer.tsx`: `LOPU_WINDOW_Z = DRAWER_Z + 60`,
  `LOPU_LAUNCHER_Z = DRAWER_Z + 200` (documented in the ladder comment). Not
  `role="dialog"` while non-modal. Hidden on `/lopu` (the page IS the chat) and
  when `settings.lopu.launcher === false`. Open state `settings.lopu.open`
  written `tabLocal: true`. The window and the page share the SAME
  `useLopuChat` state through a small module store so opening the page
  continues the same conversation.
- Settings (`useLopuSettings()` local-first `settings.lopu.*`, namespace
  `'lopu'`): `launcher` (show floating Lopu, default true), `dock`
  ('right'|'left'|'free', default 'free'), `applyPatches` (apply Lopu's
  builder changes live, default true), `confirmDeletes` (default true),
  `enterSends` (default true), `model/effort/speed` preference (default from
  catalog). Rows mirrored into `UserSettingsModal` (new "Lopu 🦄" section) and
  `SettingsPage` (`SettingsSection eyebrow="Lopu 🦄"`). Admin: models
  enable/disable + defaults editor in `AdminPanel` (`LopuModelsEditor`).
- Drawer: `{ id:'lopu', label:'Lopu', icon:'🦄', to:'/lopu', children:[ chat, conversations (/messages), settings ] }`
  after `messages`; `DrawerContent.topRow` shows a tiny pulsing dot badge when
  a turn is streaming (`LopuActivityBadge`, reads the shared store).
- Messenger: `MessengerPage.mainPane` branches to `<LopuChatView chatId={selectedChat.id} showConversations={false} />`
  when `isLopuAiSource(selectedChat.externalSource)`; `InboxSidebar.StackedAvatars`,
  `SlackSidebar`, `MessageRow.Avatar`, `ChatView` header get a `lopu` branch
  (🦄 on a rainbow disc); `MessengerNotifications` skips Lopu chats (the user
  is present).

### 3.3 Context provider

`LopuContextProvider = () => LopuContext` returns `{ route, page (from getActiveWebpageDraft(): { id, source, pageKey, siteRoute, updatedAt, blocks }), selectedBlockId, viewport }`. `useLopuChat` calls it on every send.

---

## 4. Registration & docs checklist

- `[...].ts` keys: `v1/ai/models`, `v1/admin/ai/models`, `v1/settings/lopu-chat-defaults`, `v1/lopu/chats`, `v1/lopu/chats/update`, `v1/lopu/chats/delete`, `v1/lopu/chats/reply`.
- `apiDocs.ts` entries with ids: `ai-models`, `admin-ai-models`, `settings-lopu-chat-defaults`, `lopu-chats`, `lopu-chats-update`, `lopu-chats-delete`, `lopu-chats-reply` (NDJSON documented like `lopu-musing`).
- `RATE_LIMIT_DEFAULTS`: `ai.models` 120/min, `admin.ai.models` 30/min, `settings.lopu-chat-defaults` 30/min, `lopu.chats` 120/min, `lopu.chats.write` 30/min, `lopu.chat` 40/10min.
- `apiTests.ts` (group `lopu`): models GET 200 shape; chats GET 401 anonymous / 200 with session; reply anonymous 401; reply with session `expectNdjson()` (works with test provider or fallback); docs twins auto.
- `useApi.tsx`: `v1.ai.models()`, `v1.lopu.chats.list/create/update/delete()`, `v1.lopu.reply(body, { signal })` returning the raw `Response`, `v1.admin.setAiModel()`, `v1.settings.lopuChatDefaults()`/`admin.setLopuChatDefaults()`.
- `ai-model-routing-contract.mjs`: explicit musing path + `app/api/utils/lopu/chat.ts` in the list + mirror assertions.
- Tests: `test:lopu` picks up `app/api/utils/lopu/*.test.ts`; add `test:lopu-chat-streaming` (fake SSE server with tool_use frames) chained into `test:unit`; `test:messenger` picks up messenger tests; `app/components/Lopu/*.test.ts` via a new `test:lopu-ui` script chained into `test:unit`; `test:collections` (index budget untouched); `test:schemas` (builtin projection of `ai-model`); `test:api-capabilities`; `test:actions`.
- Live verify: `remix/scripts/verify-lopu.mjs <base>` — register throwaway user → GET models → create chat → reply (NDJSON, with `LOPU_CHAT_PROVIDER=test` the server builds a component + page) → resolve created page → messages listed in `/api/v1/chats/messages` → rename → delete → generic `/api/v1/things` cannot delete the chat.
- Docs: README "Lopu AI assistant" section (env placeholders: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `LOPU_CHAT_PROVIDER`, `LOPU_OPENAI_TOOLS`, `LOPU_CLAUDE_MODEL`), TESTING.md "## Lopu AI assistant" checklist, FUNDAMENTALS §3 rows (`ai-model` kind; Lopu chats as messenger rows), `remix/CHANGELOG.md` `[Unreleased]` entry, this note renamed to `PRs/<n>-…` once the PR exists.

---

## 5. File ownership (implementation agents)

| agent | owns (new) | edits (shared, Edit only) |
|---|---|---|
| A1 server-ai-models | `api/utils/ai/models.ts` (+test), `api/utils/settings/lopuChatDefaults.ts` (+test), `routes/api/v1/ai/models/_models.tsx`, `routes/api/v1/admin/ai/models/_models.tsx`, `routes/api/v1/settings/lopu-chat-defaults/_lopu-chat-defaults.tsx` | `registry.ts` (aiModelSchema, PROTECTED, thingtimeSchemas), `storage/storageCore.ts`, `[...].ts`, `apiDocs.ts`, `rateLimit/config.ts`, `apiTests.ts`, `FUNDAMENTALS.md` §3 row |
| A2 server-lopu-chats | `api/utils/messenger/lopuChats.ts` (+test), `routes/api/v1/lopu/chats/_chats.tsx`, `…/chats/update/_update.tsx`, `…/chats/delete/_delete.tsx` | `externalAi.ts`, `messenger.ts` (exports + guards), `[...].ts`, `apiDocs.ts`, `rateLimit/config.ts`, `apiTests.ts` |
| A3 server-lopu-brain | `api/utils/lopu/chat.ts`, `chatTools.ts`, `chatPrompt.ts`, `chatEvents.ts`, `chatTestProvider.ts`, `pageOps.ts` (+tests), `app/utils/partialJson.ts` (+test), `routes/api/v1/lopu/chats/reply/_reply.tsx`, `app/api/utils/lopu/chat.streaming.test.mts` | `[...].ts`, `apiDocs.ts`, `rateLimit/config.ts`, `apiTests.ts`, `scripts/ai-model-routing-contract.mjs`, `remix/package.json` (test scripts) |
| A4 client-chat-ui | `components/Lopu/lopuTurnCore.ts` (+test), `lopuChatStream.ts`, `lopuChatStore.ts`, `useLopuChat.ts`, `LopuChatView.tsx`, `LopuComposer.tsx`, `LopuModelPicker.tsx`, `LopuToolCard.tsx`, `LopuLivePreview.tsx`, `LopuMarkdown.tsx`, `LopuPage.tsx`, `routes/lopu.tsx` | `useApi.tsx`, `routes.tsx`, `root.tsx` (title only), `Layout/Main.tsx`, `quickSwitcherCore.ts`, `commanderCommands.ts` |
| A5 client-floating-host | `components/Lopu/LopuHost.tsx`, `useLopuSettings.ts`, `LopuActivityBadge.tsx`, `components/Admin/LopuModelsEditor.tsx` | `root.tsx` (mount), `useDrawer.tsx` (z rungs), `drawerMenu.tsx`, `DrawerContent.tsx`, `UserSettingsModal.tsx`, `SettingsPage.tsx`, `AdminPanel.tsx`, `useApi.tsx` (logout sweep) |
| A6 client-live-build-bridge + messenger UI | `components/Lopu/lopuBuildBridge.ts` (+test) | `Builder/useWebpage.ts` (register + markSaved), `messengerTypes.ts`, `MessengerPage.tsx`, `InboxSidebar.tsx`, `SlackSidebar.tsx`, `MessageRow.tsx`, `ChatView.tsx`, `MessengerNotifications.tsx` |

Agents import each other's modules by the paths above; where a dependency is
not yet on disk, code against the contract in this note and leave a
`// TODO(lopu-integration)` only if unavoidable. The integration pass wires,
lints, runs every suite, and fixes cross-module mismatches.
