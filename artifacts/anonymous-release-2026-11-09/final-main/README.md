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
