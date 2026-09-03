# PR #598 — Lopu voice chat, Live Activities, and personal Secure Vault

## Delivery

This branch starts from `claude/lopu-ai-chatbot-358029`, preserves its Lopu
design note, and integrates the current `develop` line. It adds `/lopu` as a
signed-in, full-viewport voice surface on web and inside the iOS WebView. The
session gear remains available before, during, and after listening. Text
response suppresses speech playback, while Transcribe mode skips the provider,
creates a timestamped numbered owner-private Thing per final utterance, and
returns a linked quote event.

The native bridge owns microphone and speech recognition while active, carries
only cookies scoped to the current Thingtime origin and API path, and posts
voice turns directly when the WebView is backgrounded. Listening pauses during
the provider turn and Lopu speech to avoid a self-transcription loop, then
resumes. ActivityKit exposes listening, thinking, transcribing, speaking, and
ended state on the Lock Screen and Dynamic Island.

## Personal vault and providers

Settings now includes a user Secure Vault beside the existing admin-only CI
integration vault. User records are ordinary owner-private data Things split
into environments, generic password/key-value entries, and AI provider
connections. Secret values and provider tokens are write-only. AES-256-GCM
authenticated data binds ciphertext to both owner and Thing ID, and the browser
metadata query does not load encrypted fields.

The vault uses `THINGTIME_USER_VAULT_KEY` when configured, or derives a
purpose-separated user-vault key from the existing
`THINGTIME_ADMIN_VAULT_KEY`. Built-in templates cover OpenAI/Codex,
Anthropic/Claude, Google Gemini, xAI/Grok, and OpenRouter. Custom compatible
hosts require `THINGTIME_LOPU_PROVIDER_ALLOWED_HOSTS`, public HTTPS, fresh
public DNS resolution, bounded responses, a fixed timeout, and disabled
redirects.

## API contract

- `GET|POST /api/v1/lopu/vault`
- `POST /api/v1/lopu/voice/reply` as NDJSON
- capability contracts: `api.lopu-vault` 1.0.0 and
  `api.lopu-voice-reply` 1.0.0
- both routes require the full current user session and use fail-closed rate
  limits

## Verification

- `corepack pnpm run test:lopu` — 8/8 passed
- `corepack pnpm run test:api-capabilities` — 5/5 passed
- focused ESLint for all added and touched Lopu/vault/API files — passed
- `corepack pnpm run build` — passed, including Nitro and Vercel output checks
- `xcodegen generate` — passed
- generic iOS Simulator build with the embedded widget extension — passed
- authenticated browser QA at desktop and 390×844 mobile — passed for the
  entire Lopu surface and the full Secure Vault section, including settings
  interaction, transcribe/provider state, scroll boundaries, overlays, and
  overflow

Device microphone permission, an actual paid provider request, and physical
Lock Screen / Dynamic Island behavior remain manual checks. The Graphify
structural snapshot is current. Semantic extraction used the healthy local
proxy and populated the content-addressed cache, but two oversized existing
corpus chunks exceeded its request-body cap; Graphify retained the usable
partial semantic result and regenerated the report and aggregated HTML.
