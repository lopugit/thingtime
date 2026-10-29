# PR 1272: iOS share destination for all offered content types

Date: 2026-10-29. Branch: `codex/ios-all-share-types`. Base: `main`, explicitly authorized for this task. Initial base: `66dabb6034646db3901641cede2d1a4dd3a080d7`.

## Result and boundaries

The native app previously had no Share extension. `ThingtimeShare.appex` now makes Thingtime eligible for any extension item containing attachments or attributed text, without a UTI allowlist or item-count ceiling. The sending app and iOS still control offered representations, excluded activities and favourites. A new native installation is required; web deployment alone cannot add a share destination.

Shares become atomic, local batches in the existing App Group. Opening or foregrounding Thingtime copies complete batches into Documents/Shared with an idempotent receipt. The ordinary Files/upload picker can select them. There is no automatic account selection, upload or publication. Unreadable items fail the batch explicitly, Cancel rolls it back, and Retry starts a fresh attempt. Completed files are not automatically deleted.

## Review findings retained as regressions

- Provider callback URLs expire: copy them while the callback is alive, including file-URL items.
- Keep native type preference ahead of representation fallbacks; preserve arbitrary/custom UTIs.
- Actual UIActivityViewController image transport can contain a secure UIImage archive even when typed-load availability is false. Decode only the known UIKit class and save a usable image.
- Actual Photos advertises a Live Photo while typed-load availability is false. A small public Objective-C completion bridge preserves the concrete PHLivePhoto class metadata that Swift's generic legacy handler loses. Both still and motion resources are exported with cancellation. Do not silently fall back to JPEG when an advertised Live Photo cannot be imported.
- Hold source descriptors and recurse with openat/O_NOFOLLOW. A checked directory can otherwise be replaced by a symlink during traversal. Nonblocking opens reject FIFOs/special files without hanging.
- An unavailable App Group is not proof that pending batches exist. Avoid a false startup alert; report failures for actual accessible pending batches. Signed release verification still requires the group.

## Verification

- Full ordered native suite: **223 passed, 8 explicitly skipped, 0 failures** (231 tests) before the final descriptor-copy hardening. The eight skips cover existing opt-in/live-account tests, installed publication acceptance, simulator file protection, unavailable ActivityKit and the exact unsigned-simulator Keychain missing-entitlement status.
- Final targeted sharing suite: **19 passed**, covering legacy class coercion, exact paired resources, temporary-file lifetime, native representation preference, custom types, 250-item activation, directory traversal swap, FIFO rejection, cancellation and idempotent/atomic handoff.
- Real iPhone simulator system sheet: text, URL, UIImage, PDF, ZIP, audio, video, custom UTI, mixed items, 25 attachments and directory. Exact source-byte comparisons for file payloads; decoded image dimensions for UIImage. Actual Photos sharing matched both original JPEG and MOV SHA-256 hashes. The final descriptor-copy revision also passed a scoped readback of exactly three fresh batches: PDF, a nested directory and both Photos resources together. Older batch results were excluded from that final comparison.
- Real iPad simulator sheet: progress, On My iPad success text, provider failure, Retry and Cancel; exact imported text and no partial failed batch. Screenshots inspected for clipping and overlap.
- Release/profile Python tests: 7 passed. Credential-tool Node tests: 3 passed. Ruby version tests: 2 passed / 7 assertions. Ruby syntax and staged diff checks passed.
- Final device Share extension built with canonical variable-based entitlements; signature verified, and signed entitlement plus embedded development profile both contain the existing App Group. This is signing evidence, not a physical-device install or App Store distribution result.

Two baseline test assumptions were independently reproduced on unchanged main: case-sensitive alias creation on a case-insensitive simulator filesystem, and unsigned-simulator Keychain access without its entitlement. Fixtures now preserve original bytes, test persisted/account/origin/removal behavior independently, and skip only the measured missing-entitlement integration. Native bridge tests request activation of their own scene and still enforce the real foreground/origin gate. The Process-dependent git oracle remains macOS-only; portable cases stay active on iOS.

## Release and remaining evidence

The new share App ID is associated with the containing app's existing App Group. Initial Xcode automatic provisioning required a temporary resolved entitlement file on this machine; the source remains configurable. Fastlane registers/enables the App ID, creates a separate distribution profile and refuses a missing group before archive. Archive verification checks the embedded extension, predicate, versions, identity and group.

Merge triggers the canonical automatic TestFlight workflow on main. Upload, Apple processing, internal tester availability and installation are separate states. The physical iPhone was unavailable during this task, and iCloud-only original hydration is not covered by local synthetic fixtures.

## Graph indexing

Attempted the semantic incremental extraction through the local Codex proxy. The existing manifest had 563 Markdown entries without semantic hashes, so this expanded into pre-existing documentation indexing and exceeded the bounded 180-second attempt. The final structural refresh retains usable code relationships, manifest, report and HTML; this task does not claim completed semantic indexing of the changed documents.
