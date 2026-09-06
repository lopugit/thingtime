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
  `remix/app/docs/apiDocs.ts` (`contractVersion: '1.0.0'`; bump `contractVersion` —
  it is the field `createApiCapabilitiesManifest` publishes, `featureVersion` is
  not read). Add a `RATE_LIMIT_DEFAULTS` key for every route and call
  `enforceRateLimit`. Add `apiTests.ts` entries (group `lopu`). Pin new
  `api.<id>` features in `apiCapabilities.test.ts` /
  `thingtimeCapabilities.test.ts` only if those tests enumerate ids explicitly.
- Every Lopu POST — chats create/update/delete, the reply and voice streams,
  the vault — applies `requireJsonContentType` (`api/http.ts`, 415) BEFORE
  reading the body or spending a rate-limit bucket; the chat write buckets
  and the streams enforce their limits `failClosed`. Voice and vault writes
  refuse a temporary (guest) session (403) like the reply route does.
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
- **Verified keys** (`api/utils/ai/providerProbe.ts`): `configured` is
  presence, `verified` is a verdict. On the first catalog read per process the
  server probes each configured provider once —
  `GET {ANTHROPIC_BASE_URL|https://api.anthropic.com}/v1/models` (`x-api-key`,
  or `Authorization: Bearer` for `ANTHROPIC_AUTH_TOKEN`, plus
  `anthropic-version`) and `GET {OPENAI_BASE_URL|https://api.openai.com/v1}/models`
  (bearer) — 5 s timeout, no retries, `redirect: 'manual'`, in-process cache
  10 min after a success / 2 min after anything else, in-flight dedupe, never
  throws, never logs or returns a key, a base URL or a response body. 2xx →
  `verified: true`; 401/403 → `verified: false` (+ `reason`); everything else
  (timeout, network error, 3xx, 429, 5xx, malformed base URL) →
  `verified: null`. `providers.<p>` = `{ configured, verified, checkedAt, reason? }`,
  `AiModelPublic.verified` mirrors its provider, and
  `available = enabled && configured && verified !== false` — an unverifiable
  key never hides a model, a rejected one always does (so a stale key can no
  longer route every chat into the canned fallback). The service takes the
  probe as a dependency (`probeProvider`, omitted in unit tests →
  unverified); `listAiModels(viewer, { reprobe: true })` forces it.
  `POST /api/v1/admin/ai/models { probe: true }` (bucket `admin.ai.models`,
  fail-closed) answers `{ ok, probed: true, providers, models, defaults }`;
  the admin editor shows one row per provider (✓ key verified / ✗ key invalid
  + reason / ? key unverified / no key, "checked … ago") with a "Re-check
  keys" button, and the picker's disabled hint reads "<Provider> key invalid"
  when `verified === false`. Feature versions: `ai-models` 1.2.0,
  `admin-ai-models` 1.1.0, `settings-lopu-chat-defaults` 1.1.0.
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
  `ensureAiModelCatalog()` and returns `{ ok, seeded, models }`; `{ probe: true }`
  re-checks the provider keys → `{ ok, probed, providers, models, defaults }`.
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

### 1.3 Your own providers (Secure Vault → Lopu)

A signed-in user can run a Lopu turn on one of their own Secure Vault AI
connections (Settings → Secure Vault, `api/utils/lopu/userVault.ts`) instead
of the server keys. Voice mode already dialed those connections; chat now
shares the same brain and the same fence.

- `GET /api/v1/ai/models` (feature `1.1.0`) additionally returns, for a
  signed-in viewer, `vaultProviders: Array<{ id, name, kind: LopuProviderKind,
  model: string | null, endpointHost: string | null, available: boolean,
  reason?: string }>` plus `vault: { configured: boolean }`. Anonymous viewers
  and an unconfigured vault get `[]`. The projection (`lopu/vaultProviders.ts`
  `publicVaultProvider`, pinned by `LOPU_VAULT_PROVIDER_PUBLIC_KEYS`) never
  carries a token or an endpoint beyond its hostname; `available` is false
  with a `reason` when the vault key is missing, the host is outside the
  server allowlist (built-in vendor hosts +
  `THINGTIME_LOPU_PROVIDER_ALLOWED_HOSTS`), or the connection has no model.
- Chat settings gain `providerId?: string | null` (`crystal.lopu.providerId`)
  through `POST /api/v1/lopu/chats` and `/update` (both `1.1.0`); every
  list/get entry carries it under `lopu`. The id is shape-checked in
  `normalizeLopuChatSettings` and ownership-checked on write
  (`hasUserVaultProvider`) — someone else's id, or a deleted one, is a 400
  (`LOPU_PROVIDER_NOT_IN_VAULT_ERROR`). `null` returns the chat to
  Thingtime's models.
- `POST /api/v1/lopu/chats/reply` (`1.1.0`) accepts `providerId?: string |
  null`. An explicit id is strict — it must resolve through
  `getUserVaultProvider` (else 400, before anything is persisted) — and
  persists as the chat's setting (`null` clears it); a chat's stored id is
  honoured on every turn and dropped (cleared best-effort) when the connection
  no longer resolves or the vault is unconfigured. Vault turns count against
  the same `lopu.chat` bucket.
- The turn (`chat.ts`, `input.vaultProvider`): `anthropic` kind → the existing
  Anthropic path with the vault key/base URL; `openai` / `openrouter` / `xai`
  / `google` (its `/openai` compatibility surface) / `compatible` → the
  OpenAI-compatible path — native function tools on the named vendors, the
  fenced `tt-tool` text protocol on a custom `compatible` host
  (`vaultProviderToolProtocol`; `LOPU_OPENAI_TOOLS` does not apply). Model =
  the connection's own model (or the request's when the connection has none);
  effort = the chat's effort (the decorated → bare retry ladder absorbs an
  endpoint that rejects it); speed always `normal`. The SDK clients are built
  with the vault key + base URL only (`authToken`/`organization`/`project`/
  `adminAPIKey` pinned to null so no server credential rides along) and a
  redirect-refusing fetch. A vault turn takes precedence over every
  `LOPU_CHAT_PROVIDER` mode, `test` included.
- `meta` is emitted before dialing with `provider: 'vault'`,
  `providerLabel: <connection name>`, `label: '<name> · <model>'`. Errors
  from the user's provider surface as an `error` event with a friendly line
  (`friendlyVaultProviderError`: rejected key / unknown model / rate limited /
  unreachable / guard refusal — never the URL or the token) followed by the
  canned `LOPU_FALLBACK_VAULT` deltas; the persisted assistant row then has
  `provider: 'fallback'` and the vault model. The server keys are NOT a
  fallback for a vault turn. `LOPU_TURN_PROVIDERS` / `LopuChatProvider` gain
  `'vault'`. A completed vault turn persists `providerLabel` (the connection
  name, ≤ 80 chars, `publicLopuMessageMeta` keeps it on `'vault'` rows only)
  so history reads "via <name>" after a reload.
- The client states the provider choice on the wire whenever it knows the
  chat's own settings (the summary carries a `lopu` block): `providerId:
  null` travels explicitly and clears a pin the server still holds, so a
  refused `/update`, a provider the vault no longer lists, or a stale cache
  can never route a turn behind the picker's back. The key is omitted only
  for a chat the store does not know yet. The floating window's header chip
  reads the same per-chat store settings (provider name when pinned) and its
  list offers "Your providers" above the catalog.
- One place for BYO provider HTTP + SSRF: `lopu/vaultProviderClient.ts` —
  `assertSafeProviderEndpoint` (HTTPS → allowlist → fresh public DNS →
  private-range check), `createGuardedProviderFetch` (`redirect: 'error'`),
  `resolveVaultProviderClientConfig` (what chat.ts builds its SDK client
  from), and `callVaultProviderPlainCompletion` (the bounded non-streaming
  call `voice.ts` `streamLopuVoiceReply` now delegates to; the
  `/api/v1/lopu/voice/reply` wire contract is unchanged and
  `createTranscriptPage` stays exported).
- Dev only: vault endpoints must be public HTTPS hosts, so a local fake is
  reached through `THINGTIME_LOPU_PROVIDER_DEV_REWRITES=https://<saved
  origin>=http://127.0.0.1:<port>[,…]` — parsed only when `NODE_ENV !==
  'production'` and no `VERCEL*` env is set (`parseProviderDevRewrites`); a
  rewritten origin skips the allowlist/DNS checks. `scripts/verify-lopu.mjs`
  §K uses it (`https://lopu-fake-provider.invalid` → port 18170).

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
  | { type:'confirm'; id; name; key; token; expiresAt; summary; subject?: { id?, kind?, name? } }  // a destructive tool waits for the user (2.4 "Confirmations")
  | { type:'error'; message; retryable }
  | { type:'done'; assistantMessageId; messages: PublicChatMessage[]; usage?; stopReason }
```

`tool_result` additionally carries `needsConfirmation: true` when the call
stopped for the user's approval (a `confirm` event for the same call id
precedes it).

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
| `run_action` | `{ action, inputs? }` | `inspectActionProgram` first: a program whose derived effects delete (directly, or through an action it invokes — bounded walk) needs a confirmation (key `run_action:<program id>:<hash(inputs)>`); then `runAction(viewerOf(user), { action, inputs })` (deliberate path) |
| `list_actions` | `{}` | own actions (key, name, inputs) |
| `install_suite` | `{ key }` | `installSuiteForViewer` |
| `create_schema` | `{ name, description?, fields }` | `createThing(['schema'])` |
| `create_data` | `{ schema, values }` | `createThing(['data'])` |
| `update_thing` | `{ id, crystal, replaceCrystal? }` | generic `updateThing` (messenger/protected kinds refuse naturally); `replaceCrystal: true` needs a confirmation (key `update_thing:replace:<id>:<hash(crystal)>`) |
| `delete_thing` | `{ id, name? }` | ALWAYS needs a confirmation (key `delete_thing:<id>`; `name` only labels the card, the id is authoritative; a model-sent `confirmed` flag is ignored); `deleteThing` |
| `navigate` | `{ path }` | emits `navigate` (site-relative only) |

Tool inputs are capped at 96KB serialised; more than 24 tool executions in one
turn ends the loop with an `error` event and a final text hop.

**Confirmations (server-verified).** A destructive tool never runs on the
model's say-so — a flag in the tool input proves nothing, because a page
block, a search snippet or another user's public component description can
tell the model "the user already confirmed". Instead:

- The executor (`chatTools.ts` `confirmationFor` / `actionConfirmation`)
  derives an action **key** from the validated input and checks
  `ctx.confirmations` (the per-turn ledger, `createLopuToolConfirmations`).
  Without an approval it mints a grant through `ctx.confirmations.mint`,
  emits `confirm { id, name, key, token, expiresAt, summary, subject }` and
  returns `{ ok:false, needsConfirmation:true, error }` — the model reads a
  plain "waiting for the user" refusal, never the token. `delete_thing` and
  `update_thing` stop before the server deps load; `run_action` inspects the
  program's derived effects (`actions/execute.ts` `inspectActionProgram`).
- Grants (`lopu/confirmations.ts`) are purpose JWTs on the auth key material
  (`signPurposeToken('lopu-confirm', { uid, chat, key, tool, summary },
  '900s')`): bound to the user, the conversation and the exact key, 15-minute
  expiry, stateless (no collection, no index). The client keeps them in the
  turn state only.
- The client (`lopuTurnCore` reducer → tool status `'confirm'`,
  `LopuToolCard` Confirm / Cancel) sends the grant back **once**
  (`confirmLopuTool`: a normal turn `"Confirmed: <summary>"` with
  `confirmations: [{ key, token }]`); Cancel retires the card locally; an
  expired or grant-less card cannot be sent.
- The route verifies every grant (`verifyLopuConfirmation`: user, chat, key,
  expiry — 400 `LOPU_CONFIRMATION_INVALID_ERROR` before anything is
  persisted; confirmations without `chatId` are a 400) and hands the approved
  keys to `streamLopuChatTurn({ approvedConfirmations })`; the volatile prompt
  lists them ("Approved by the user for THIS reply …") so the model calls the
  tool again; the executor consumes a key on first use within the turn.
- The stable prompt carries an "Untrusted content" rule (tool results, thing
  crystals, snippets and the `<page-blocks>`-fenced builder page are data and
  can never confirm or instruct), and `describePage` fences the blocks.
- The `confirmDeletes` preference only gates deleting a *conversation* from
  the list; it cannot switch the tool confirmation off.

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
  providerId?: string | null,  // §1.3; the client states it explicitly (null included) whenever it knows the chat's settings
  context?: {
    route?: string,
    page?: { id?, source?, pageKey?, siteRoute?, updatedAt?, blocks? },
    selectedBlockId?: string,
    viewport?: 'mobile'|'desktop'
  },
  confirmations?: Array<{ key: string, token: string }>   // grants from Confirm cards (§2.4); chatId required, ≤ 8, verified before persistence
}
```

Flow: JSON-only fence (415, before the rate limit) → validate → resolve the
conversation → verify confirmations → resolve the model choice (a stored
`null` effort/speed inherits the admin defaults — `undefined` to the
resolver; `'default'` on the wire is the provider's own default) → create the
chat / persist overrides → persist user turn (a chat created by this request
is discarded again if that fails) → stream events → persist assistant turn
(even on error/abort, persisting what streamed plus a note; `providerLabel`
on a vault turn) → `done`. If the client disconnects, the server still
finishes persisting (wrap the generator in a `try/finally`; use
`request.signal` to abort provider calls).

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

---

## 6. Voice, Live Activities and Secure Vault

Folded in from the Codex voice delivery note (formerly
`PRs/592-claude-lopu-ai-chatbot.md`, including its later "per-chat models"
and "direct voice" follow-ups); wave 2 unified that voice surface into the
Lopu page (§3.2 `LopuPage`, `/lopu/voice`) and its chat brain (§1.3), and the
reconciliation pass kept that architecture while porting the follow-ups'
capability, so the facts below describe the shipped behaviour after all
three passes.

### 6.1 Voice delivery

- Voice is a signed-in, full-viewport surface on web and inside the iOS
  WebView. It shipped at `/lopu`; it now lives at `/lopu/voice` (the Lopu
  page's Voice mode, also the mic in the floating window) with `/lopu` as
  the text chat. The session gear (`LopuVoiceSettingsPopover`) stays
  available before, during and after listening.
- Each final utterance is one normal chat turn (`useLopuChat().send`, tools
  included, the chat's own model / `providerId`). **Spoken replies** (the
  former "Text response" switch, inverted: off = text only, the quiet
  default) reads the reply aloud through `speechSynthesis`; **Transcribe
  mode** skips the provider entirely — every final utterance becomes a
  timestamped, numbered, owner-private Thing page through
  `POST /api/v1/lopu/voice/reply { transcribeMode: true }` and comes back as
  a linked `quote` event rendered as a Lopu bubble inside the conversation
  list (`LopuVoiceTranscript`, slotted through `LopuChatView`'s `trailing`).
- **Direct voice** (opt-in; `settings.lopu.directVoice`, default off, plus
  `directVoiceModel`, null = the provider's first realtime model): when the
  chat's pinned Secure Vault provider's kind lists a realtime model
  (`LOPU_PROVIDER_TEMPLATES[].models[].audioInput === 'realtime'` — xAI Grok
  Voice: `grok-voice-latest`, `grok-voice-think-fast-2.0`; every other kind
  stays on device transcription), the microphone streams straight to that
  provider as 24 kHz PCM16 over its realtime WebSocket
  (`components/Lopu/lopuVoiceRealtime.ts`: `session.update` with server VAD,
  `grok-transcribe` input transcription and binary audio both ways) on a
  five-minute credential minted by `POST /api/v1/lopu/voice/session`
  (§6.3). The provider's user transcripts, its reply text
  (`response.*delta`) and `response.done` land in the same conversation list
  as local rows; Spoken replies off sends `textResponse: true` (the reply
  text shows, nothing plays). The gear's **Direct voice** switch is enabled
  only for a provider that supports it and otherwise reads why in one line
  (transcribing / no provider chosen / the provider's own unavailable
  reason / "<name> needs a provider with realtime voice (xAI Grok Voice)");
  a realtime-model select appears when the kind lists more than one.
  Settings → Lopu 🦄 mirrors the switch. Anything unsupported or
  unconfigured at start (the server's 400 — vault key missing, connection
  not yours, kind without realtime — or a browser without `getUserMedia`)
  toasts one line and the standard path runs.
- The native bridge (`~/utils/nativeBridge`) owns the microphone and speech
  recognition while a native session is active, carries only cookies scoped
  to the current Thingtime origin and API path, and posts voice turns
  directly (`/api/v1/lopu/voice/reply` with the session's `providerId`,
  `model`, `effort`, `speed`) when the WebView is backgrounded. Listening
  pauses for the whole provider turn and for Lopu's speech so she never
  transcribes her own voice (the feedback-loop guard, `pausedRef` in
  `useLopuVoice`), then resumes. `lopu-voice-start` carries `inputMode:
  'provider-audio' | 'native-transcript'` (direct voice when the chat's
  provider supports it, else the web toasts the reason and asks for
  transcription); in provider-audio mode the iOS controller
  (`LopuVoiceSessionController.swift`) mints through the same
  `/voice/session` endpoint, streams PCM at the device's sample rate, needs
  no Speech Recognition permission, and posts `lopu-voice-realtime-user` /
  `lopu-voice-realtime-assistant-start` (deltas ride the usual
  `lopu-voice-event`).
- ActivityKit exposes the listening, thinking, transcribing, speaking and
  ended states on the Lock Screen and in the Dynamic Island (the iOS app's
  Live Activity; the web sends `lopu-voice-start` / `lopu-voice-stop` and
  receives `lopu-voice-transcript` / `lopu-voice-event` / `lopu-voice-interim`
  / `lopu-voice-error` / `lopu-voice-state` plus the two realtime messages
  above).

### 6.2 Personal vault and providers

- Settings → Secure Vault (`#secure-vault`) is a user Secure Vault beside the
  existing admin-only CI vault. User records are owner-private Things
  organised into environments, generic password/key-value entries and AI
  provider connections. Secret values and provider tokens are write-only.
- AES-256-GCM with authenticated data binds every ciphertext to its owner and
  Thing id; list queries never load the encrypted fields
  (`api/utils/lopu/userVault.ts`, `userVaultCore.ts`).
- The vault key is `THINGTIME_USER_VAULT_KEY` (32-byte base64url), or a
  purpose-separated derivative of `THINGTIME_ADMIN_VAULT_KEY` when only the
  admin key is set. Unset both and the vault reports
  `vault.configured === false`: Settings shows its "Encryption not
  configured" state, `GET /api/v1/ai/models` lists no `vaultProviders`, and
  an explicit `providerId` is a 400 (a direct-voice session too).
- Templates (`LOPU_PROVIDER_TEMPLATES`) cover OpenAI/Codex, Anthropic/Claude,
  Google Gemini, xAI/Grok, OpenRouter, Mistral, DeepSeek, Groq and Cohere;
  each lists its catalog `models[]` (efforts, speeds, `audioInput:
  'realtime'` for direct-voice models) and the vault's GET publishes them as
  `providerTemplates`. A connection's `model` is optional: the Secure Vault
  form offers the kind's catalog (or a custom id; a custom compatible host
  must name one), and a row saved without one runs on its kind's first
  catalog model. The one model rule (`vaultProviders.ts`
  `resolveVaultTurnModel`, used by the chat client config and the voice
  turn): the connection's own model → the kind's first catalog model → the
  model the request asked for (custom hosts only). Effort and speed live on
  each conversation (§1.2) and travel to the provider — the chat brain
  through its SDK clients, the voice turn through
  `callVaultProviderPlainCompletion`, which maps them onto the vendor's own
  fields (Anthropic `output_config.effort` + the fast-mode beta, Gemini
  `thinkingLevel`, the OpenAI-style `reasoning_effort` family with
  DeepSeek's `thinking` switch, OpenRouter's `reasoning`, OpenAI's priority
  tier) and reads text out of content arrays (Mistral's thinking chunks are
  skipped). Codex's follow-up had removed the model from the row and chosen
  model / effort / speed per chat in the composer with a custom-id input;
  the reconciled design keeps the row's optional model with catalog
  defaults and per-chat effort / speed, and a per-chat *provider-native*
  model for vault turns stays the open follow-up (§1.2 validates `model`
  against the Thingtime catalog).
- Custom OpenAI-compatible hosts require an explicit server allowlist
  (`THINGTIME_LOPU_PROVIDER_ALLOWED_HOSTS`, built-in vendor hosts are
  pre-allowed), public HTTPS, fresh public DNS resolution before every call,
  bounded responses (`LOPU_PROVIDER_MAX_RESPONSE_BYTES`), a fixed timeout
  (`LOPU_PROVIDER_TIMEOUT_MS`) and disabled redirects — all in
  `api/utils/lopu/vaultProviderClient.ts`, which chat turns (§1.3), voice
  turns and the direct-voice credential exchange
  (`mintVaultProviderRealtimeSession`: `POST <endpoint>/realtime/client_secrets`
  with the decrypted key, five-minute `expires_after`, the returned secret
  refused when it is or contains the key) share.
- `GET /api/v1/ai/models` → `vaultProviders[]` carries `model` (the row's own
  or its kind's default) and `realtimeModels` (the kind's direct-voice
  models, empty elsewhere) beside id / name / kind / endpointHost /
  available / reason — still never a token or an endpoint beyond its host.

### 6.3 API contract

- `GET|POST /api/v1/lopu/vault` (`api.lopu-vault` 1.1.0) — templates with
  catalog models, environments and redacted entry metadata; `create-group`,
  `save-secret`, `save-provider` (optional `model`), `delete`.
- `POST /api/v1/lopu/voice/reply` (`api.lopu-voice-reply` 1.1.0) — NDJSON;
  conversation mode dials the selected provider through the shared client
  with optional per-turn `model` / `effort` / `speed`, transcribe mode makes
  no provider call.
- `POST /api/v1/lopu/voice/session` (`api.lopu-voice-session` 1.0.0) —
  `{ providerId, model?, effort?, textResponse? }` → `{ ok, session: {
  provider, model, token, expiresAt, webSocketUrl, effort, textResponse } }`;
  the ephemeral direct-voice credential, 400 with the reason otherwise
  (never a key).
- `GET /api/v1/ai/models` (`api.ai-models` 1.3.0) — `vaultProviders[]` gains
  `realtimeModels` and the kind-default `model`.
- All three Lopu voice/vault routes require a current full user session (403
  for a guest session), JSON bodies (415) and use fail-closed rate limits
  (`lopu.vault` 60/min; `lopu.voiceReply` 30/min, shared by the voice turn
  and the session mint).

### 6.4 Verification (voice delivery)

- `corepack pnpm run test:lopu` (8/8 at delivery; 72/72 after the
  reconciliation, `voice.test.ts` covering the per-kind request bodies, the
  model rule, the credential exchange and the session), `test:lopu-ui`
  87/87, `test:api-capabilities` 8/8, focused ESLint, `corepack pnpm run
  build:client`, `xcodegen generate` plus an unsigned generic iOS Simulator
  build (Codex pass), and authenticated desktop + 390×844 browser QA passed.
  `node scripts/verify-lopu.mjs <base>` adds the session endpoint's walls
  (401 / 415 / clean 400 without a credential) to §A and §K.
- Physical-device microphone permissions, a paid provider request (a real
  Grok Voice session), and the actual Lock Screen / Dynamic Island behaviour
  remain manual acceptance checks; the reconciliation pass did not compile
  the iOS project.
