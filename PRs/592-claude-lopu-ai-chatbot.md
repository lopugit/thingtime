# PR #592 — Lopu AI assistant, voice sessions, and personal Secure Vault

## Voice delivery

The existing `claude/lopu-ai-chatbot-358029` branch now includes `/lopu` as a
signed-in, full-viewport voice surface on web and inside the iOS WebView. The
session gear remains available before, during, and after listening. Text
response suppresses speech playback, while Transcribe mode skips the provider,
creates a timestamped numbered owner-private Thing for each final utterance,
and returns a linked quote event.

The native bridge owns microphone and speech recognition while active, carries
only cookies scoped to the current Thingtime origin and API path, and posts
voice turns directly when the WebView is backgrounded. Listening pauses during
the provider turn and Lopu speech to avoid a self-transcription loop, then
resumes. ActivityKit exposes listening, thinking, transcribing, speaking, and
ended states on the Lock Screen and Dynamic Island.

The follow-up adds a second, explicit provider-audio mode on web and iOS. It
streams PCM microphone frames to xAI Grok Voice and plays streamed PCM replies;
Thingtime exchanges the write-only vault token server-side for a five-minute
ephemeral credential. Device-transcription mode remains available for every
seeded text provider, and Text response suppresses playback in both paths.

## Personal vault and providers

Settings includes a user Secure Vault beside the existing admin-only CI vault.
User records are owner-private Things organized into environments, generic
password/key-value entries, and AI provider connections. Secret values and
provider tokens are write-only. AES-256-GCM authenticated data binds ciphertext
to the owner and Thing ID; list queries never load encrypted fields.

The vault uses `THINGTIME_USER_VAULT_KEY`, or a purpose-separated derivative of
`THINGTIME_ADMIN_VAULT_KEY`. Provider records no longer contain a model; model,
reasoning, and speed live on each Lopu conversation. Templates cover
OpenAI/Codex, Anthropic/Claude, Google Gemini, xAI/Grok, OpenRouter, Mistral,
DeepSeek, Groq, and Cohere. Custom compatible hosts require an
explicit allowlist, public HTTPS, fresh public DNS resolution, bounded
responses, a fixed timeout, and disabled redirects.

Ordinary `/lopu` text turns can now select one of the caller’s provider
connections directly in the composer. Model and reasoning are always managed
dropdowns, with a custom provider-native model ID input exposed only when the
user explicitly chooses it. Advertised effort and fast/priority options map to
the respective Anthropic, Google, OpenAI, OpenRouter, Mistral, DeepSeek, Groq,
xAI, and Cohere request fields; provider tokens are decrypted only for the
server-side call and never enter the chat payload, event stream, or message
metadata. The deployment-managed catalog retains Lopu’s full Thingtime builder
tool loop, while user-vault providers run as conversational backends.

## API contract

- `GET|POST /api/v1/lopu/vault`
- `POST /api/v1/lopu/voice/reply` as NDJSON
- `POST /api/v1/lopu/voice/session` for an ephemeral direct-audio credential
- `GET|POST /api/v1/lopu/chats`, `/update`, and `/reply` persist an optional
  owner-scoped `providerId` plus per-chat model, effort, and speed
- capabilities `api.lopu-vault` 1.1.0, `api.lopu-voice-reply` 1.1.0, and
  `api.lopu-voice-session` 1.0.0; chat create/reply contracts are 1.2.0/1.1.0
- both routes require a current user session and fail-closed rate limits

## Verification

- `corepack pnpm run test:lopu` — 49/49 passed
- `corepack pnpm run test:api-capabilities` — 6/6 passed
- focused ESLint — passed
- `corepack pnpm run build` — passed, including Nitro/Vercel output checks
- `xcodegen generate` and an unsigned generic iOS Simulator build — passed
- authenticated desktop and 390×844 browser QA — passed

Physical-device microphone permissions, a paid provider request, and actual
Lock Screen / Dynamic Island behavior remain manual acceptance checks. No
credential supplied in chat was used for automated testing.
