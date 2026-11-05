# Account Home protected deletion recovery — 27 October 2026

Passed one account Home native browser acceptance test (anonymous variant deliberately skipped by ACCOUNT_ONLY), plus all 12 protected recovery unit tests. No product code changed. Source is the retained `remix/app/local-workspace/protectedRecovery.browser.{fixture,test}.ts` pair.

The real History UI recovered a deleted theme and feed algorithm offline after their dedicated account deletions were acknowledged. Assertions preserve stable IDs, design content, library titles, recorded folder, private audience, cleared active selection, and canonical deletion/recovery lineage through cold offline reloads. No writes were attempted offline. Reconnect issued exactly one dedicated save per profile; fresh authenticated snapshots retained both profiles, anonymous exact-ID reads returned 404, and a post-sync reload retained local content. Screenshots and measured geometry cover 1440, 390 and 320px, full top-to-bottom scrolling, the open recovery confirmation, hit testing and recovered lists. Representative narrow confirmations and desktop list were visually inspected.

`protected-account/account/verification.json` is the passing evidence. `source-equality.json` records actual archive source-map parity for protectedRecovery, accountThemes, accountAlgorithms, accountTimeline, things, themes and algorithms. The sanitized application archive SHA-256 is `0a847337609cd760c3188d784375f57a2d1eadb495ccad86b1c2799429d3a0d5`. `acceptance-source-hashes.json` binds the retained test/fixture to the executed bundles and runner. `run.cjs` preserves the executed harness with only archive/bundle lookup paths made relative to the repository root.

The manager-owned runtime was network-none, read-only with tmpfs state, sandboxed Chromium and disposable replica-set/account fixtures. `protected-account/network-proof.json` proves backend/browser direct-IP, mapped IPv6, DNS and redirect denial. `boundary.json`, `resources.json` and `cleanup.json` record the boundary, zero OOM kills and no remaining owned containers. No installed-app, provider, real-account, Character or custom-data-plane recovery acceptance is claimed. Existing explicit refusal coverage remains unchanged. Agent Overview reporting is parent-reported local-only; authentication was unavailable.

## Reproduction

From the repository root with the existing sanitized archive at `tmp/continuation/post-draft-app.tar.gz`, the recorded manager runtime image and MCP esbuild/Playwright dependencies available:

```sh
node artifacts/anonymous-protected-account-recovery-2026-10-27/prepare.cjs
node artifacts/anonymous-protected-account-recovery-2026-10-27/run.cjs
```

The retained browser test explicitly enables CDP Network, models the initial online signal using Network.overrideNetworkState with positive throughput and ethernet, then verifies navigator.onLine and the authenticated Home identity before seeding. OS network-none remains enforced: this models browser connectivity only and does not add any external route. Browser transport and the online signal are switched together for offline/reconnect testing. Only the disposable fixture identity's cookies pass in memory from its API jar into its own isolated browser context; no credentials are logged or saved.

Attempts 1–8 retain bounded setup/assertion failures: initially absent online signal, responsive geometry that incorrectly included unrelated mounted root dialogs, then a test assertion reading algorithm description at the wrong nesting level. The final run scopes geometry to the affected History overlay and reads the canonical top-level description. These are test-harness corrections, not product fixes. Every attempt released its runtime.
