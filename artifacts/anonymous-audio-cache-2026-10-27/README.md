# Audio cache identity and lifetime acceptance — 27 October 2026

The scoped repair is ready for parent integration. Product source was frozen before the parent's canonical client/template/server build. No product edits followed that build. The accepted isolated runtime used `tmp/continuation/audio-search-app.tar.gz`, SHA-256 `aea7f888d84c7976add09f1d1c5dff646677f086ff2d499ac39e3b466f7a4217`.

`evidence-manifest.json` records current file hashes, exact executed fixture and bundle hashes, source-map parity, attempts, evidence paths and limitations. `before-reproduction.json` preserves the old validator's acceptance of mismatched attachment metadata; it is a local cache defect reproduction, not a remote authorization bypass.

## Accepted evidence

Attempt 11 passed the real API/UI test with independent synthetic author/viewer accounts, actual uploads and public post, version-negotiated original audio bytes, delayed track/save completion, equivalent root refresh, real cross-tab logout with the main root response held, late save completion, ordinary anonymous public saving, cold offline reload and native WAV decoding/playback, account cache separation and removal. The test scrolled the page and scroll roots at 1440/390/320 pixels, exercised player/queue/offline controls and captured screenshots. Zero page errors occurred. The scoped unit/core/runtime suite passed 16 tests; current four-file lint and diff whitespace checks are clean.

The pending-root UI actually said “Refreshing your session / Your previous view is hidden while we check your current session.” It unmounted the player. The old element was disconnected and paused, had no `src` attributes, `readyState=HAVE_NOTHING` and `networkState=NETWORK_NO_SOURCE`, and emitted no new playing events. Its historical `currentSrc` remained populated. A separate real-WAV native API diagnostic in the same image/Chromium reproduced that behavior. Empty-source `play()` stayed pending until cleanup caused `AbortError`; these are observed Chromium outcomes, not authorization requirements. Late saved bytes did not revive a native source. Releasing the root response recovered the normal anonymous public player without bypassing app state.

The runner asserted the reviewed archive hash, product hashes and audio module bytes before claiming a runtime. The archive's audio source-map contents exactly match the two current product files. All 401 loaded JS/CSS response bodies matched their packaged files. This establishes scoped client parity, not whole-package source equivalence. Font inspection found the declared Hanken Grotesk/system stack, no declared font faces loaded in the network-none runtime; screenshots show the system fallback, not proof of a custom font download.

The installed Thingtime browser allocator created a task-owned sandboxed Chromium runtime with enforced browser/backend network-none boundaries. IPv4/IPv6/DNS/redirect denial was verified. Accepted session `406e4c41-4d5a-4649-8c07-64adb4706e6a` was released; `audio/cleanup.json` records no remaining owned container. No personal account, VM/proxy configuration, installed app bundle or external deployment was changed.

## Fixture provenance and failed attempts

The exact accepted source is `attempt-11.browser.test.ts`; its executed bundle is `attempt-11.test.mjs`. After execution, the current test changed only three promise-outcome assertions: it now rejects successful playback without requiring a specific pending/rejection class. Resource/event security invariants stayed identical. The exact diff is `current-fixture-after-execution.diff`. The current relaxed fixture is linted but is not claimed executed; the parent explicitly requested no rerun solely for promise wording.

Attempts 1–4 used an obsolete runner archive path and are nonacceptance. The runner mistake is preserved in `wrong-archive-attempts.json`; it was not a build defect. Correct-package attempts 5–10 preserve grounded fixture/diagnostic failures and cleanup under `attempts/`: hidden logout footer on `/things`, per-page navigator state, incorrect mounted-player/currentSrc assumptions, and the native pending-play diagnostic. None constitutes acceptance of an older archive. Attempt 11 is the complete accepted run.

## Remaining boundaries

V1 localforage bytes are retained but ignored. They are not counted as authorized; a current ordinary authorized save is required. Known structured save refusal retires the exact selected copy. Cache hits do not revalidate every remote ACL/version, so unobserved offline revocation or byte changes cannot be inferred. Transient/edge failures preserve existing data.

This native fixture covers ordinary remote account/anonymous public audio. Device resolver behavior, delegated Character scope and shared-key exclusion are source/unit evidence here, not claimed native acceptance. Production, Vercel preview and installed application UI acceptance remain separate parent-level delivery concerns. The parent owns shared docs, final graph refresh and GitHub publication.

Parent integration normalized trailing whitespace in retained `.log` copies before committing. Executed sources, bundles, JSON and PNG bytes remain unchanged; integration artifact hashes cover these normalized log copies.
