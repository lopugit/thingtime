# PR 771: Reusable AI waterfall selection for stack merges

App PR: https://github.com/lopugit/thingtime/pull/771 (develop).
Controller PR: https://github.com/lopugit/thingtime/pull/770 (github-actions).

## Delivered contract

The shared `AiWaterfallSelector` accepts the current portable config and a
redacted endpoint catalog. Apply returns an ordered config; Cancel discards
edits. The component performs no network calls or persistence. Both stack
selection and the existing Admin model-order editor consume it. See
[the reusable contract](../docs/ai-waterfall-selector.md) for adoption details.

Stack overrides support mixed Anthropic, OpenAI and owned Secure Vault HTTP
endpoints. Each dispatch freezes the config and actor. The protected gateway
resolves current credentials, checks active run identity and ownership, and
returns an explicit unavailable receipt before the runner advances. Invalid
output and rejected authorization stop. Inherited stacks retain the CLI route.

## Verification on 11 September 2026

- 64 CI-control tests, 38 capability tests, 64 AI utility tests passed.
- Client/embed and Nitro server builds passed; built manifest smoke passed.
- Typecheck remains at the pre-existing 108-error baseline.
- Controller required verify lane passed locally and on GitHub; routing/plan
  self-tests and four waterfall tests passed, including a real Git conflict.
- Chrome desktop and 390 CSS-pixel mobile checks exercised the real shared
  components in an isolated fixture: mixed endpoints, Apply, Cancel, reorder,
  focus restoration and scrolling to the bottom of the modal. Fixture removed.
- The available local account was not an administrator. Full authenticated
  stack save/restart and paid-provider/publication acceptance remain unverified.

## Rollout

Deploy controller PR 770 before exposing version-4 selections from PR 771.
Configure the existing router secret on both sides and server API keys or owned
Secure Vault endpoint connections. No credentials appear in the config or
runner. This implementation does not merge either PR or change a live stack.
Text-conflict size/time limits and unsupported binary/deleted/symlink conflicts
are documented in the reusable contract; the independent verifier still gates
publication.

Local development: http://localhost:13310/admin/ci-control (PM2 worktree stack).
Tailscale/Funnel could not be verified: the CLI wrapper points to a missing
Tailscale application. Branch preview availability is tracked by the PR checks.
