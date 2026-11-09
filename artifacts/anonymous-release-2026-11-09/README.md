# Main reconciliation — 9 November 2026

Existing feature `d214a6b5a1965831febd2e5d1f2488ee3f13d1fc` plus fetched main
`c0d1ae9c4a5c047d9c7ada870dea7a5f6fa8f4a0`, in the isolated
`codex/anonymous-release` checkout. The integration is delivered to the existing
`codex/anonymous-local-first` branch and [PR #1000](https://github.com/lopugit/thingtime/pull/1000).
This is a feature-branch reconciliation, not proof of production acceptance.

## Accepted local checks

- `corepack pnpm --dir remix run typecheck`: exit 0, no diagnostics.
- `corepack pnpm --dir remix run build`: exit 0, complete Vite/client, draft,
  library/embed/offline shell, Nitro/Vercel, packaged runtime and output verification.
- `corepack pnpm --dir remix run test:local-workspace`: 914 passed, 110 explicit
  browser/environment opt-in skips, zero failures; then four offline-shell checks passed.
- `test:api-capabilities`: 184 passed. Focused account transport, linked media,
  public copy and audio-cache checks: 38 passed. Counts overlap other suites.
- Compiled `smoke-built-content-execution.mjs`: both origin manifests, registered
  routes/methods and 16 endpoint docs contracts pass. Its synthetic loopback DB
  deliberately has no listener; the startup selection error is not real-account evidence.
- Focused server merge checks: 171 attachment/backup/Timeline/transfer passes;
  43 Action-policy/transfer passes; final Timeline/backup regression batch 84 passes.
  These are overlapping targeted batches, not an aggregate test count.
- Focused UI checks: 26 passes, 14 Mapbox/source follow-up passes, and two public
  cache compatibility checks. Scoped lint: zero errors, 24 warnings.
- Vercel configuration checks: 16 passed. Artifact extraction checks: six passed.
- [Fresh isolated SDK renderer evidence](render/README.md) identifies its exact
  final draft bundle and wrapper, output resources, input refusals and cleanup.

## Defects corrected during reconciliation

Preserve main's server-projected execution hold through cached account content,
local Action execution and older public catalog entries. A verified same-revision
release can enable execution without erasing pending edits; stale reads cannot.
Cloud-scoped incoming shares retain originals until a cloud receipt is observed.
Receipt/stream clients require distinct combined semantic feature versions.

The initial complete check exposed a duplicate backup import, an obsolete
Mapbox scope identifier and three Timeline assertions for limits removed on main.
The final checks above include the corrections. The Timeline tests now retain
large legitimate content while refusing corrupt indexes and oversized individual
event envelopes. No validator or security boundary was relaxed to get them green.

The renderer's copied runtime snapshot now supports restrictive host umasks
without widening its private host parent directory. The runtime stays non-root,
network-none and read-only with its existing sandbox, seccomp and cleanup.

## Remaining acceptance and delivery

- Normal importer round-trip and the corrected combined global/site nested
  Builder editing fixture on the reconciled source; historical results do not close these.
- Remaining identity/origin/data-plane/Character and media/provider/vault/native
  device acceptance matrix in `docs/local-workspaces.md`.
- The current one hosted `thingtime` connection advertises 37 tools and no renderer.
  Local SDK resources do not prove a downloadable artifact call from that host.
  Implement/verify the canonical hosted adapter and its isolated worker boundary;
  do not add another feature-specific MCP or bypass account-tool authentication.
- Final-head CI, reachable preview functional acceptance, and authorized release
  plus installed-native verification. No production feature acceptance is claimed here.
- Private lifecycle reporting still lacks the independent `agents.report` grant.
  This does not prevent local checks. No account data or shared LLM service was changed.

## Knowledge graph scope

The scoped semantic refresh used the healthy local proxy but exceeded its
180-second attempt budget while indexing ten changed documents. It did not
activate incomplete output. The structural/code graph is refreshed separately;
new semantic coverage of those documents is not claimed. The shared proxy and
its credential were left unchanged.
