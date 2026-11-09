# Main reconciliation — 9 November 2026

Existing feature `d214a6b5a1965831febd2e5d1f2488ee3f13d1fc` plus fetched main
`c0d1ae9c4a5c047d9c7ada870dea7a5f6fa8f4a0`, in the isolated
`codex/anonymous-release` checkout. The integration is delivered to the existing
`codex/anonymous-local-first` branch and [PR #1000](https://github.com/lopugit/thingtime/pull/1000).
This is a feature-branch reconciliation, not proof of production acceptance.

## Follow-up integration and hosted foundation

The same branch also incorporates fetched main `f36da5c032251270c0b24a754c61a4e510633c59`,
including current-page Builder controls. The merge preserves workspace identity
isolation, the explicit cloud incoming-share path and the existing local UI.
Full app compilation passes; the draft renderer bytes are unchanged from the
accepted render below. Independent merge review found no source regression and
the settings-document suite passed 12 checks.

The canonical hosted `thingtime` MCP now contains an optional anonymous renderer
adapter. It stays unavailable until a pinned, isolated provider snapshot passes
the exact-origin preflight and is configured through the existing operator vault.
Source tests cover effective sandbox policy, admission, cancellation, cleanup,
canonical hashes, validated PNGs, diagnostics and account-tool refusals. A real
provider snapshot and a file-returning call in the intended host remain unverified.

The draft regression now supplies the browser/identity context used by incoming
shares and verifies their explicit cloud scope (52 passed, nine opt-in skips).
The three import-order errors are fixed. The isolated Linux runtime lock now
matches the app's bcrypt 6.0.0; five native packaging tests pass. No installed app
was replaced, and a rebuilt canonical runtime still needs native acceptance.

[Normal importer and nested editing](builder-import/README.md) passed on `e67c4e475f`,
including offline reload, dependency remapping, three viewport widths and zero
account writes. Earlier intermittent `/things` offline navigation failures are
retained with no established root cause. The additional main update also passes
the [combined global/site browser check](builder-import/current-main/): both
offline reloads and composed checks at 1440/390/320 pixels. Final full lint has
zero errors and 359 warnings; the TypeScript ratchet stays at zero, and the
compiled handler smoke verifies 17 contracts plus safe unconfigured MCP refusal.

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

- Diagnose the retained intermittent offline navigation failure.
- Remaining identity/origin/data-plane/Character and media/provider/vault/native
  device acceptance matrix in `docs/local-workspaces.md`.
- The current one hosted `thingtime` connection advertises 37 tools and no renderer.
  Local SDK resources do not prove a downloadable artifact call from that host.
  Activate/verify the canonical hosted adapter and its isolated worker boundary;
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
