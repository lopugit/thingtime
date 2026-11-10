# Isolated Passwords account-identity acceptance — 2026-10-27

Final executed test: **1 passed, 0 failed, 0 skipped**, 22.45 seconds. Product sources were not changed. `source-parity.json` verifies twelve relevant packaged client sources exactly matched the worktree at execution; the runner refuses any archive other than the recorded SHA-256.

The shipped browser-manager CLI negotiated both v1 capabilities and allocated one read-only, network-none, sandboxed Chromium/backend runtime with its own replica-set database. Backend and browser egress checks cover direct IPv4/IPv6, DNS and redirects. `cleanup.json` confirms zero owned containers remain. No actual device vault, real account or shared LLM proxy was accessed.

The normal Passwords UI verifies held root-session account invalidation clears the old selected title/fields before resolving the new account; a real save delayed before native WebCrypto encryption cannot commit after its scope retires; distinct synthetic accounts open separate encrypted device vaults; cold offline reload locks the B vault; its local edit survives lock/unlock with zero offline HTTP POSTs; reconnect advances the canonical B entry from revision 1 to 2; switching back preserves A's original UI and canonical revision 1. Matching server IDs are globally owned: the other account receives 404 for read and save. This does not prove matching local IDs across account partitions.

Full scrolling at 1440×1000, 390×844 and 320×844 had no horizontal overflow. Passwords remained masked. The 320px export dialog retained keyboard focus and closed with Escape. Screenshots were visually inspected.

`executed-test.mjs`, `executed-runner.cjs` and `test.log` preserve the executed fixture and result. Original runnable fixture location is `tmp/continuation/vault-identity/{test.mjs,run.cjs}`; runner paths assume that layout. It uses `tmp/continuation/audio-search-app.tar.gz`. Test credentials and vault keys are generated only inside the disposable runtime and never retained in artifacts.

Earlier attempts remain in the corresponding `vault-identity`, `vault-identity-r2` through `vault-identity-r12` directories and task tmp logs. Setup corrections were browser fetch rather than APIRequestContext for Secure loopback cookies, a properly encoded ephemeral vault key, and explicit per-page online/offline CDP state while retaining OS network-none. Toast visibility and initial queue status were insufficient completion signals; final acceptance uses persistence and canonical API readback. No server reversion was established. The early “no pending account changes” status before asynchronous queue reads remains a separate UX gap.

Limits: one loopback origin and default data plane; no origin/plane transition acceptance, attachment deletion/conflict race acceptance, installed macOS app, AutoFill, or real provider credential integration. This closes only the tested account-identity/race packet, not the whole broader vault TODO.
