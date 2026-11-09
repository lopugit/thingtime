# Final main integration — 9 November 2026

Feature parent `e3171457b6f6eb4df792e977c0bc9c055fb1634b`; selected main parent
`d82ed71557418a617e094437c6dfe1e673e08747`. The reconciled workspace keeps
scheduled page activation on the verified owning-account server route. A
pending or unverified device page cannot activate, and the canonical no-login
draft validator refuses saved activation and passive sources. Main’s ordered
ensure batches use the shared Action interpreter, rechecking authority between
writes. The combined generic Things capability is 1.58.0, above both divergent
1.57.0 builds.

- The full Vercel build, TypeScript, zero baseline ratchet and full lint passed
  (0 errors, 359 warnings). All 184 capability tests passed; both compiled
  Vercel manifests and route documentation agreed on 17 contracts, and the
  unconfigured hosted render adapter and anonymous account read refused safely.
- The compiled Nitro server and a disposable loopback MongoDB replica passed
  all 130 real HTTP Action checks, including concurrent and repeated ordered
  ensures, stale/revoked cutoff refusal and scope checks. Focused activation,
  account transport, Action policy, schema and draft tests passed separately.
- Isolated Chromium exercised [desktop](activation-browser/desktop-daily-open.png)
  and [mobile](activation-browser/mobile-daily-open.png) civil rollover, reload,
  pinned selection, inert unverified device/preview/shared/branch modes and
  [retry](activation-browser/mobile-activation-retry.png) in the real Builder
  renderer with a synthetic API. The fixture and replica test are separate
  evidence; neither uses live account data.
- A fresh canonical MCP SDK stdio run used the pinned isolated Chromium image.
  The [new renderer proof](render-verification.json) identifies the rebuilt
  runner. Its editable JSON, three viewport PNGs and card crop exactly match
  the [retained, visually checked bytes](../render/README.md). The SDK suite
  also exercised no-crop output, concurrency and refusal paths.

Earlier combined global/site and normal importer Chrome results are linked
[from the evidence index](../README.md) and apply to their tested revisions.
Intermittent cold offline `/things` navigation remains undiagnosed. Hosted
provider snapshot and intended-host downloadable-file delivery remain
unverified; this test does not establish hosted configuration, installation
or release. Graphify refresh is structural; the bounded semantic attempts
timed out and changed documents were not semantically reindexed.

## Installer follow-up — 10 November 2026

The branch incorporated main `cc248ed5336b21948bccfd9b6ebe486239421189`
over `ab72a52a9760e2098d8325387d853414b9704c80`. The imported installer waits
up to two seconds for the stopped managed Node service and its Electron child
before replacing a bundle. It preserves the prior bundle and restarts its
service when either process stays open. Syntax validation and all 21 local
and cached installer fixture tests passed. A live signed installation remains
unverified. The source trees under `remix` and `MCP` are byte-identical to
`ab72a52a9`, so the earlier build and renderer results apply to those files.

## Offline shell and hosted worker — 10 November 2026

The offline worker can serve a previous complete build after a failed update.
Five offline-shell tests passed. Isolated Chromium reproduced the incomplete
replacement cache, recovered the exact cached document during a TCP outage
and reopened the normal importer with two anonymous records and the exact
rendered text. The older failures lacked the cache and worker traces needed
to determine their cause. [Controlled Chromium evidence](../builder-import/offline-navigation-verification.json)

The hosted image declares a locked non-root renderer. The adapter verifies
the session, Linux identity, privilege flags, clean paths and pinned runner
hash before writing a mode-0600 draft. The connector suite passed all 55 tests,
the navigation suite passed all 36 tests, and the combined Vercel build, zero
TypeScript ratchet and full lint passed with zero errors and 359 warnings.
The compiled smoke exercised 17 contracts and confirmed that the unconfigured
hosted adapter refuses safely. The emitted offline worker matches the tested
module, and the rebuilt renderer hash matches the earlier real isolated SDK
capture.

The initial live Vercel bootstrap verified the exact ready image and a
nonpersistent session with deny-all networking, no routes or ports, one vCPU,
2048 MiB and a 120-second bootstrap deadline. The guest exited 1 during the fixed identity
guard without returning the proof hash or the failed predicate. It stopped
before transferring draft bytes, creating a snapshot or running a render.
Independent provider reads returned HTTP 404 for all three disposable
bootstrap sessions, and the project snapshot inventory was empty at that
checkpoint.

A diagnostic showed that the provider's non-root process retained ambient
Linux capabilities. The corrected adapter drops the inheritable, ambient and
bounding sets before running either shell and checks all five sets plus the
kernel's no-new-privileges flag. The disposable Linux regression verified
that the same UID could write a protected fixture with the injected ambient
capability, then lost that access after the production prefix dropped it.
The corrected source passed the 55 connector tests, targeted lint and the
zero-error TypeScript ratchet. The recompiled Vercel server passed output
verification and the 17-contract smoke. Both the packaged renderer and
offline worker match their previously tested bytes.

The corrected real Vercel preflight passed. A restored deny-all session
verified the exact non-root identity, empty capability sets and pinned
runner before both jobs. Sandboxed Chromium returned the canonical editable
JSON, three viewport PNGs and the card crop. The negative job refused an
invalid crop. Independent provider reads returned HTTP 404 for the bootstrap
and both render VMs. The team repeated both jobs on a fresh 30-day
candidate, retained that verified snapshot and confirmed deletion of the
superseded 24-hour snapshot. The sanitized receipt contains status and hashes.
The activation descriptor stays private.
[Provider receipt](hosted-provider-safe-evidence.json)

The CI home-workspace test had left catalogue transports active when it
went online. The corrected fixture stops the unrelated workers, waits for
the permitted theme pass, and retains the no-network and generic authority
assertions. The local workspace suite passed 915 tests with 110 opt-in
skips. Its five offline-shell tests passed separately. The repository's
configured `test:unit` command completed with exit status 0.

Hosted configuration and a downloadable-file call through the connected
MCP host remain open.
