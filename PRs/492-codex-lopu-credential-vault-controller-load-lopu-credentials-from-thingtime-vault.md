# PR #492 — Load Lopu credentials from the Thingtime vault

Branch: `codex/lopu-credential-vault-controller`

## Scope

- Replace the fixed three-name Claude credential chain with an ordered bundle fetched from Thingtime through `THINGTIME_CI_ROUTER_SECRET`.
- Support up to eight admin-ordered tokens across conflict resolution, rebase conflict rounds, continuations, Graphify refreshes, and leak scanning.
- Preserve one-time bootstrap/fallback reads from the two existing OAuth secrets only until the live vault migration is proven.
- Add `verify-credential-vault`, a no-model maintenance operation that validates the fetched bundle and its mode-`0600` runner cache.

## Safety and regression focus

- Mask every fetched value before exporting it to subsequent steps.
- Scope cache reuse to the exact GitHub run ID and attempt; reject malformed, duplicate, oversized, newline-bearing, wrong-type, or non-HTTPS bundles.
- Advance the waterfall only after classified capacity or credential failures; max-turn continuation stays on the selected account.
- Feed every raw and base64 token value into the existing post-edit leak scans.

## Validation log

- 2026-08-31: vault client, workflow control-plane, resolver routing, promotion worker, rebase ownership, and all script tests passed.
- 2026-08-31: every workflow and composite-action YAML file parsed successfully.
- 2026-08-31: Graphify hooks and the union merge driver were installed and verified before commit.
- 2026-08-31: live migration remains gated on PR #491 reaching production; the verification operation will then prove bootstrap and post-deletion fetches without invoking Claude.
