# PR #388 — Unlimited AI model waterfall with the full Claude + OpenAI catalog

- **PR**: https://github.com/lopugit/thingtime/pull/388
- **Branch**: `claude/fallback-model-selection-0281b1` → `develop`
- **Owner ask**: remove the 3-entry fallback cap on Admin → System → "AI
  workflow model order"; add all OpenAI models (with effort levels and
  normal/fast modes) and all Claude models (with reasoning levels).

## What shipped

### Core (`remix/app/api/utils/settings/prConflictResolverModelWaterfallCore.ts`)

- `PRConflictResolverModelId` widened from a closed 3-member union to a plain
  string alias over **composed option ids**: `<model>[:<effort>][:fast]`
  (e.g. `claude-opus-5:high:fast`, `gpt-5.6-sol:ultra`). Bare legacy ids
  (`default`, `claude-fable-5`, `claude-opus-5`) parse unchanged, so stored
  orders, the persisted settings key, and the endpoint contract stay
  compatible.
- New data-driven catalog `AI_WORKFLOW_BASE_MODELS` (33 base models). Adding a
  model there is the whole registration — ids, validation, the endpoint's
  catalog projection, and the Admin picker all derive from it.
  - Anthropic: Fable 5, Opus 5, Opus 4.8, Opus 4.7, Opus 4.6, Sonnet 5,
    Sonnet 4.6, Haiku 4.5. Efforts `low|medium|high|xhigh|max` where supported
    (`xhigh` arrived with Opus 4.7; Haiku has no effort tiers). Fast mode only
    on Opus 5 / Opus 4.8 (Anthropic fast-mode research preview).
  - OpenAI: GPT-5.6 Sol/Terra/Luna (`none…max` + `ultra`), 5.5, 5.4(+Mini),
    5.3 Codex(+Spark), 5.2(+Pro), 5.1(+Codex/Mini/Max), GPT-5(+Mini/Nano),
    o3(+Pro), o4-mini, 4.1 family, 4o family. `fast` = priority processing on
    models OpenAI sells it for; codex/o-series/pro are normal-only.
- `parseAiWorkflowModelOptionId` tolerates segment order and returns the
  canonical id; per-model validation of effort tier and fast support.
- **Reads forgiving per entry** (`normalizePrConflictResolverModelWaterfall`):
  unknown/malformed entries drop individually (an older deploy reading a newer
  catalog keeps the rest of the order), dedupe keeps first position, `default`
  always appended. **Writes strict** (`validate…`): unknown id, non-unique
  canonical id, or missing `default` reject; length unlimited.
- Provider-aware resolvers:
  - `resolveAiPreferredAnthropicChoice(value, providerDefault)` — first
    anthropic entry wins; OpenAI entries skipped; `default` stops the scan and
    delegates to the caller's provider-valid default.
  - `resolveAiPreferredOpenAiChoice(value)` — mirror image; `null` = keep the
    client's env default.
  - `resolveAiPreferredClaudeModel` kept as the compatibility accessor.
  - `toAnthropicEffort` / `toOpenAiReasoningEffort` clamp to what each API
    accepts (`ultra` → `max` for OpenAI API calls; Codex-only tier otherwise).

### Consumers

- **Lopu musings** (`musing.ts`): `createLopuModelChoicesResolver` resolves
  BOTH provider choices from one durable read. Claude side applies
  `output_config.effort` and fast mode (`client.beta.messages.stream` +
  `speed: 'fast'` + `fast-mode-2026-02-01` beta); OpenAI side applies
  `reasoning_effort` + `service_tier: 'priority'`. Both sides retry once bare
  (model only) when a decorated request fails before yielding text, so a knob
  a model rejects never kills the provider. Never retries after first output.
- **Claude moderation** (`claudeProvider.ts`): model + effort applied; fast
  deliberately ignored (premium pricing is wasted on a background classifier).
- **Routing contract** (`ai-model-routing-contract.mjs`): re-pinned to the new
  call shapes; also asserts `model:` never comes directly from
  `LOPU_OPENAI_MODEL`/`LOPU_CLAUDE_MODEL` env in the request path.

### Route + docs

- `_pr-conflict-auto-resolver-model-waterfall.tsx`: `models` projection now
  `{id,label,provider,efforts,speeds}` per base model; body cap raised
  16 KB → 64 KB for full-catalog waterfalls. Workflow consumers read only
  `.waterfall` (a string array, unchanged shape).
- `apiDocs.ts` entry rewritten (composed grammar, unlimited length, provider
  resolution semantics, truncated catalog example).

### Admin editor (`PRConflictResolverModelWaterfallEditor.tsx`)

- Unlimited reorderable rows (drag handle + up/down + remove; `default`
  locked). Row subtitles: `Provider · Effort · Fast mode`.
- Add-fallback picker: model select (optgroups per provider) + effort select
  (only that model's tiers, `Default effort` first) + speed select (only when
  the model has a fast lane) + Add with duplicate guard. Replaces the three
  fixed quick-add buttons.
- Aria labels/announcements carry the full variant name ("Claude Opus 5 ·
  High effort · Fast").

## Verification

- Unit: settings 15 ✓, lopu 5 ✓, moderation 52 ✓, routing contract ✓.
  Typecheck ratchet: changed files contribute zero new errors (repo baseline
  drift +7 is in unrelated files: things.ts, Commander, MagicInput, etc.).
- Live browser on the worktree stack (`TT_WEB_PORT=13330`, throwaway admin
  via `ADMIN_USERNAMES`): built the order
  `claude-opus-5:high:fast, default, gpt-5.6-sol:ultra, gpt-5.3-codex:xhigh,
  claude-haiku-4-5` through the picker (5 entries > old 3 cap), verified
  per-model gating (Haiku hides effort+speed; Codex hides speed; Codex effort
  list is exactly low/medium/high/xhigh), reordered via arrows, saved, and
  confirmed the exact composed ids via GET and a full-reload repaint.
  Desktop 1280px and mobile 375px checked top-to-bottom — no clipping,
  overlap, or horizontal scroll. `/api/v1/lopu/musing` smoke streams.

## Known limitation / follow-up

- The `github-actions` control-plane workflow (`model_config` job) still
  validates a "unique 1..3 array from the closed allowlist"
  (`default|claude-fable-5|claude-opus-5`) and **fails closed to
  `["default"]`** with a `::warning::` for anything else. A saved legacy-trio
  order keeps working end-to-end today; expanded orders are safely ignored by
  workflows (never misapplied) until the control plane learns the composed
  grammar. That change belongs on the `github-actions` branch: parse
  `<model>[:effort][:fast]`, filter to Claude-capable entries for the Claude
  Code CLI args, keep the injection-safe closed charset, and decide the
  effort/fast mapping for headless Claude Code. Tracked as a follow-up task.

## Gotchas learned

- Local `graphify update` in this worktree produced the known 1M-line
  version-drift rebuild; discarded per convention (commit source-only).
- Local usernames containing "admin" are rejected at register with
  "Username already taken" — throwaway admin users need a neutral name, then
  `ADMIN_USERNAMES=<that name>` at dev boot.
- The Browser pane's mobile preset swallows wheel scrolls (touch translation);
  `scroll_to` a ref instead. Tall viewports (1500px) confuse the pane's
  screenshot compositor on this app's inner scroll container.

## Review round 1 — musing output budget (Lopu, 2026-08-24)

Opening the catalog to reasoning models exposed the musing call's output cap
as a second, unwidened constant. Two defects, both reproduced against the PR
head with stubbed provider endpoints before fixing:

1. **`max_tokens` is incompatible with OpenAI's reasoning models.** The OpenAI
   SDK marks it deprecated and "not compatible with o-series models"; GPT-5 and
   o-series reject the request outright. `streamOpenAI` sent it in *both* the
   decorated attempt and the bare retry, so the retry could not rescue it —
   selecting any OpenAI reasoning model as the first entry silently removed
   ChatGPT from the musing waterfall. Fixed by sending `max_completion_tokens`,
   which every current Chat Completions model accepts.
2. **200 output tokens starves a reasoning entry.** Both providers bill
   internal reasoning against this same budget (Anthropic counts thinking
   tokens inside `max_tokens`, OpenAI counts reasoning tokens inside
   `max_completion_tokens`), so an entry that pins an effort tier spends the
   whole cap thinking and streams no text. The provider loop then committed to
   that empty attempt and emitted `meta` + `done` with zero deltas — a blank
   musing rather than a fallback. Fixed with one shared
   `MUSING_MAX_OUTPUT_TOKENS = 4096` ceiling on both providers, plus a
   fall-through when an attempt finishes without a single text delta so a
   starved provider degrades to the next provider and then the canned library.

`ai-model-routing-contract.mjs` now pins all three invariants (the shared
constant, `max_completion_tokens` on the OpenAI call, and no numeric
`max_tokens:` literal anywhere in the musing path).

Reproduction/validation harness: a scratch copy of `remix/app` with the
Mongo-backed settings module stubbed, the real `streamLopuMusing` driven
against local HTTP stubs speaking Anthropic SSE and OpenAI SSE, with the
OpenAI stub returning the real `unsupported_parameter` 400 for `max_tokens`.
Before the fix: two rejected OpenAI attempts and `source: 'claude'` for
scenario 1, `["meta:claude","done"]` with empty text for scenario 2. After:
18/18 checks pass, including that Claude still carries
`output_config.effort` + `speed: 'fast'`, OpenAI carries `reasoning_effort` +
`service_tier: 'priority'`, and `ultra` still clamps to `max`.
