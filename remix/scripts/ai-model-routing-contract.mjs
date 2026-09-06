#!/usr/bin/env node

// Source inventory for direct application AI clients. GitHub Actions has its
// own protected control-plane contract; this catches new app runtimes that
// would otherwise choose a model independently of Thingtime Admin settings.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const remixRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const appRoot = join(remixRoot, 'app');

const sourceFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.isFile() || !['.ts', '.tsx'].includes(extname(entry.name)) || /\.test\.[^.]+$/.test(entry.name)) {
      return [];
    }
    return [path];
  });

const directClientPattern = /\bnew\s+(?:Anthropic|OpenAI)\s*\(/;
const directClientFiles = sourceFiles(appRoot)
  .filter((path) => directClientPattern.test(readFileSync(path, 'utf8')))
  .map((path) => relative(remixRoot, path))
  .sort();

assert.deepEqual(
  directClientFiles,
  ['app/api/utils/lopu/chat.ts', 'app/api/utils/lopu/musing.ts', 'app/api/utils/lopu/recordingsProvider.ts', 'app/api/utils/moderation/claudeProvider.ts'],
  'new direct AI clients must be added to the Thingtime Admin model-routing contract'
);

// Attachment moderation routes its model through the same admin waterfall;
// TT_MODERATION_MODEL is only the provider default for the 'default' slot.
const moderation = readFileSync(join(remixRoot, 'app/api/utils/moderation/claudeProvider.ts'), 'utf8');
assert.match(moderation, /getAiPreferredModelWaterfall/);
assert.match(moderation, /resolveAiPreferredAnthropicChoice/);
assert.match(moderation, /resolveAiPreferredAnthropicChoice\(await getAiPreferredModelWaterfall\(\), providerDefaultModel\)/);
assert.doesNotMatch(moderation, /model:\s*env\.TT_MODERATION_MODEL/);

// Lopu musings resolve BOTH provider preferences from one waterfall read:
// Claude runs the first Anthropic-capable entry, ChatGPT the first OpenAI
// entry; LOPU_*_MODEL env values are only the 'default'-slot fallbacks.
const musing = readFileSync(join(remixRoot, 'app/api/utils/lopu/musing.ts'), 'utf8');
assert.match(musing, /getAiPreferredModelWaterfall/);
assert.match(musing, /resolveAiPreferredAnthropicChoice/);
assert.match(musing, /resolveAiPreferredOpenAiChoice/);
assert.match(musing, /streamClaude\(SYSTEM_PROMPT, user, choices\.claude\)/);
assert.match(musing, /streamOpenAI\(SYSTEM_PROMPT, user, choices\.openai\)/);
assert.doesNotMatch(musing, /model:\s*process\.env\.LOPU_CLAUDE_MODEL/);
assert.doesNotMatch(musing, /model:\s*process\.env\.LOPU_OPENAI_MODEL/);

// Recording organization follows the same admin OpenAI choice. Audio
// transcription is deliberately an audio-capable model, not a chat alias.
const recordings = readFileSync(join(remixRoot, 'app/api/utils/lopu/recordingsProvider.ts'), 'utf8');
assert.match(recordings, /resolveAiPreferredOpenAiChoice\(await getAiPreferredModelWaterfall\(\)\)/);
assert.match(recordings, /model: choice\?\.model \|\| process\.env\.LOPU_OPENAI_MODEL/);
assert.match(recordings, /model: 'gpt-4o-mini-transcribe'/);
assert.match(recordings, /reasoning_effort: effort/);
assert.match(recordings, /service_tier: 'priority'/);

// An admin entry can pin a reasoning model or an explicit effort tier, and
// both providers bill that reasoning against the request's output budget:
// Anthropic counts thinking tokens inside `max_tokens`, OpenAI counts
// reasoning tokens inside `max_completion_tokens`. `max_tokens` is also
// deprecated and outright incompatible with OpenAI's reasoning models, so the
// OpenAI call must never use it. One shared ceiling keeps the visible musing
// from being starved by the reasoning it now pays for.
assert.match(musing, /const MUSING_MAX_OUTPUT_TOKENS = \d{4,}/);
assert.match(musing, /max_tokens: MUSING_MAX_OUTPUT_TOKENS/);
assert.match(musing, /max_completion_tokens: MUSING_MAX_OUTPUT_TOKENS/);
assert.doesNotMatch(musing, /max_tokens:\s*\d/);

// A ceiling alone is not enough: an attempt can still spend all of it on
// reasoning and complete with zero text deltas. That is a failed attempt, not
// an empty musing, so each provider must fall through to its own bare retry
// (dropping the effort/fast knobs, keeping the admin's model) before the
// provider loop gives up on it — and must never retry once text has been
// emitted, which would duplicate the musing. Both providers carry the same
// guard; pin the count so a refactor cannot quietly restore the plain `return`
// that silently skipped the admin's preferred provider.
assert.equal(
  (musing.match(/if \(yielded \|\| attempt === attempts\.length - 1\) return;/g) || []).length,
  2,
  'streamClaude and streamOpenAI must each fall through to their bare retry on a starved (zero text delta) attempt'
);

// One durable waterfall read serves every provider attempt in a musing: the
// read stays above the provider loop so a first-provider failure cannot cost a
// second settings round-trip.
assert.match(musing, /const choices = await getLopuModelChoices\(\);[\s\S]*?for \(const provider of providerOrder\(\)\)/);

// Lopu's chat brain (assistant turns with tool use) mirrors the musing
// contract: one waterfall read plans every provider attempt of a turn — the
// explicit catalog choice runs on its own provider, the fallback provider runs
// its first Admin waterfall entry — and LOPU_*_MODEL are only the
// 'default'-slot fallbacks, never inlined as a model id.
const chat = readFileSync(join(remixRoot, 'app/api/utils/lopu/chat.ts'), 'utf8');
assert.match(chat, /getAiPreferredModelWaterfall/);
assert.match(chat, /resolveAiPreferredAnthropicChoice/);
assert.match(chat, /resolveAiPreferredOpenAiChoice/);
assert.match(chat, /resolveAiPreferredAnthropicChoice\(waterfall, getDefaultLopuClaudeModel\(\)\)/);
assert.match(chat, /resolveAiPreferredOpenAiChoice\(waterfall\)/);
assert.doesNotMatch(chat, /model:\s*process\.env\./);

// A chat turn streams tool inputs and reasoning against one named output
// ceiling on both providers — Anthropic bills thinking inside `max_tokens`,
// OpenAI bills reasoning inside `max_completion_tokens` (never the deprecated
// `max_tokens`, which reasoning models reject outright).
assert.match(chat, /const LOPU_CHAT_MAX_OUTPUT_TOKENS = 16000/);
assert.match(chat, /max_tokens: LOPU_CHAT_MAX_OUTPUT_TOKENS/);
assert.match(chat, /max_completion_tokens: LOPU_CHAT_MAX_OUTPUT_TOKENS/);
assert.doesNotMatch(chat, /max_tokens:\s*\d/);

// Both chat providers keep the musing's starvation guard: a decorated
// (effort / fast) attempt that fails or completes empty before emitting
// anything retries bare on the same model, and never retries after output.
assert.match(chat, /if \(yielded \|\| attempt === attempts\.length - 1 \|\| isAbortError\(error\)\) throw error;/);
assert.equal(
  (chat.match(/if \(yielded \|\| attempt === attempts\.length - 1 \|\| isAbortError\(error\)\) throw error;/g) || []).length,
  2,
  'anthropicProvider and openAiProvider must each keep the bare-retry guard'
);

// This developer-only helper intentionally targets the local Codex proxy. It
// is not a Thingtime runtime and cannot consume Claude model aliases; pin the
// exception so it cannot silently become an ungoverned production entrypoint.
const localGraphify = readFileSync(resolve(remixRoot, '..', 'graphifyExtract.sh'), 'utf8');
assert.match(localGraphify, /OPENAI_BASE_URL=http:\/\/127\.0\.0\.1:4768\/v1/);
assert.match(localGraphify, /GRAPHIFY_OPENAI_MODEL=codex-default/);

console.log('application AI model routing contract: self-test OK');
