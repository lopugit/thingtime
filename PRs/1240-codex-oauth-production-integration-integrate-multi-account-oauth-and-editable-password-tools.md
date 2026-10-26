# PR #1240 — Multi-account OAuth and editable password tools

PR: https://github.com/lopugit/thingtime/pull/1240
Branch: `codex/oauth-production-integration`
Base: `main` at `d7cca44373ac42bf014ea5949e99d67d296b54ec`

The integration applies the feature changes from PRs #992 and #996 without
importing unrelated develop history. It preserves main's password generator,
icons, passkey guide, editable drawer and explicit render-component persistence.
The original worktree started at `d4d885c`; its parent was advanced to `d7cca443`
while preserving the reviewed application files. Both main graph histories remain.

## Security and compatibility

- Each provider account has independent encrypted credentials and removal.
- Selected desktop APIs must satisfy passwords 1.3 and all six Connections 2
  contracts before credential request bodies are forwarded, in both proxy modes.
- Uncapped data writes negotiate Things 1.43 / update 1.14. Render-only writers
  retain the already-deployed 1.42 / 1.13 floors.
- Private icons use transient image slots. Authored layouts cannot persist their
  `src`/`srcSet`, and private URLs clear on suspension, editing and account changes.

## Verification on 27 October 2026

The reviewed application source passes TypeScript with zero errors, lint, focused
service/password/schema/settings/gateway suites, five client builds, both Nitro
presets, Vercel output verification, compiled manifests and synthetic HTTP OAuth
and gateway checks. The independent compatibility matrix passes 296 assertions.

Task-owned, network-isolated Chromium passes 27 password-manager milestones and
nine service-catalog groups with no page errors. This includes desktop/mobile,
Builder editing, transfers, account switching, generator/icons/passkey controls
and a synthetic QR image exceeding 14 MiB. Browser timeouts and nonterminal reports
fail verification. No personal browser profile or production credential is copied.

Swift core passes 17 tests with two opt-in skips, Electron bridge passes nine,
and navigation fencing passes four. Native bridge typechecks pass. Full Xcode
builds remain unverified because the local environment refuses the compiler's
nested sandbox; compile-only hosted recovery is being prepared separately.

At revision `6b672f9e24f1971913aa3163957eb2157cc49066`, hosted Web CI
(build/typecheck and API suite), both CodeQL analyses, and GitGuardian pass.
The [PR preview](https://pr-1240.previews.dev.thingtime.com) serves the expected
origin manifest with passwords 1.3 and Connections 2. Its selected shared master
API remains older, so root-data correctly refuses with
`409 ENVIRONMENT_GATEWAY_CAPABILITY`. This is not hosted account acceptance.
The receipt and GitHub deployment associate the feature revision with the preview;
the separate generic Vercel status URL points to a different deployment.

Independent review rejected the initial native CI proposal before publication:
candidate-owned code would have run with runner/root privileges before isolation.
The replacement uses independently reviewed control-plane code; candidate source
must remain data until unprivileged isolated execution. No privileged operation
from the rejected proposal ran on the user machine or a hosted runner.

## Remaining acceptance

Hosted checks and previews must match the latest pushed revision. Real provider
consent/callbacks, the additional Google secret in the encrypted production vault,
hosted ChatGPT client approval, production rollout, and signed installed-device
passkey/AutoFill/TOTP ceremonies remain distinct gates. No native installation or
real-account authentication is established by the synthetic tests.

Graph structural outputs and history are preserved. Changed documentation was
not semantically reindexed: the incremental extractor attempted to revisit the
whole non-code corpus, so that attempt stopped before semantic dispatch.
