# Main reconciliation — 9 November 2026

Existing feature `d214a6b5a1965831febd2e5d1f2488ee3f13d1fc` plus fetched main
`c0d1ae9c4a5c047d9c7ada870dea7a5f6fa8f4a0`, in the isolated
`codex/anonymous-release` checkout. The integration is delivered to the existing
`codex/anonymous-local-first` branch and [PR #1000](https://github.com/lopugit/thingtime/pull/1000).
This is a feature-branch reconciliation, not proof of production acceptance.

## Vault and Character browser acceptance

When page blocks failed to load during a connection change, Settings used to
replace the unlocked vault's outlet. The outlet now stays mounted while the
notice changes its layout and clearance. The anonymous and account vault
browser suites passed on the corrected client at 1440, 390 and 320 pixels.
[Provider Vault evidence](acceptance/provider-vault.json)

The isolated Character runs at `7164914063d477f4817ecd84ce12a1bde2ce86fa`
passed library, nested reply links, History and anonymous quick-comment
checks. The sibling audit verified library separation, denied post and reply
reads, and independently confirmed the original reply's author, parent and
text. A follow-up on the corrected client verified a held reply across an
account switch, exact single reply on return, device storage readback and
Character-only server accounting. Direct Character sign-in passed through
the API and in a clean browser at 1440 and 320 pixels. The same-profile Add
account fixture stopped before sign-in when its composer did not list the
synthetic Character. [Character evidence](acceptance/character-baseline.json) ·
[Identity and accounting](acceptance/character-identity.json)

The combined client and server package preserved the exact browser-tested
Settings shell and API handler. The native draft runner bytes matched the
previous provider capture. The compiled smoke passed 17 contracts, and the
repository unit command completed successfully.

## Offline update recovery and hosted worker hardening

The offline worker now uses the last verified cache after an incomplete shell
update. An isolated Chromium follow-up reproduced the failure, verified the
exact cached document during a TCP outage, and reopened the normal importer
with both saved records and exact rendered text. The retained historical
traces cannot establish which mechanism caused each earlier failure.
[Controlled offline evidence](builder-import/offline-navigation-verification.json)

The hosted adapter uses a fixed non-root image identity and checks the pinned
session, privilege flags, work directory and renderer hash before writing draft
bytes. Real provider preflight passed after the worker explicitly dropped
ambient Linux capabilities. The restored snapshot produced editable JSON and
four PNGs in sandboxed Chromium, refused an invalid crop and passed cleanup
readback. [Provider receipt](final-main/hosted-provider-safe-evidence.json) ·
[Combined verification](final-main/README.md)

## Scheduled activation integration

[Final main evidence](final-main/README.md) covers the integration of main
`d82ed71557418a617e094437c6dfe1e673e08747`: scheduled activation, the combined
Things capability, and fresh isolated browser and no-login renderer checks.
Earlier importer and global/site evidence below remains tied to its tested tree.

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
canonical hashes, validated PNGs, diagnostics and account-tool refusals. This
earlier checkpoint preceded the provider pass recorded above.

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

- Historical offline traces do not establish the cause of each earlier failure.
  The two controlled reproduction paths now have focused coverage.
- Remaining identity/origin/data-plane/Character and media/provider/vault/native
  device acceptance matrix in `docs/local-workspaces.md`.
- Configure the verified snapshot for the exact intended origin and verify the
  canonical hosted MCP advertises the renderer. Complete a call that returns
  downloadable artifacts in the connected host and verify account-tool refusals.
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
