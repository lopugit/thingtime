# Native mutations, discovery and token management — 12 November 2026

This checkpoint extends shared Thingtime services with SQLite persistence. MongoDB remains an optional desktop provider; it is not a requirement for the local account/token path. Base commit: `860ebaf315b40c0b79cb069a2f239d986fc61149`; integrated main: `f2538e19257bcfdf35ba050e7b187c94ea2252c0`.

## Implemented and reviewed

- Trusted create/update lifecycle callbacks run inside the exact native transaction. Failed callbacks roll back content, storage accounting and History; History records the actual actor while storage is charged to the owner.
- Delegated workspace writes reuse canonical workflows, with live membership, owner, reference and folder-ancestry checks in that transaction. Multi-write folder workflows still use per-write transactions, not one workflow-wide transaction.
- Discovery receipts use a protected home repository, canonical identity/link semantics and current revocation checks. Ordinary Builder reads do not invent receipts. Hidden-post positives are protected SQLite unit fixtures, not end-to-end native post creation.
- Owner-library counts preserve canonical selection, authorization and token visibility. Unsupported selectors/content families still return unavailable.
- Typed PAT persistence supports transactional admission, finite-use consumption, expiry, revocation and profile reopen. Native token HTTP operations are enabled explicitly; generic Things and workspace HTTP remain unavailable.
- Token responses use private/no-store caching. Both manifests advertise deliberately patched token contracts: `api.tokens` 1.1.1, `api.tokens-revoke` 1.0.1 and `api.tokens-self` 1.0.1.

Independent read-only reviews of the token adapter and transaction/workspace integration found no actionable issue. Those reviews are distinct from executed tests.

## Verification

All 13 combined checks passed: 1,253 reported test passes, three intentional opt-in skips and zero failures. The separately repaired moderation suite adds 85 passes (1,338 reported passes across those command results). TypeScript and its ratchet pass; full lint reports zero errors and 376 warnings. All 5,631 other inventoried files remained unchanged; the sole test-only change preceded typecheck, ratchet and lint. The three skipped checks are the opt-in native permalink UI, 513 MiB Blob and 4 GiB ZIP64 fixtures; none is claimed as acceptance here.

[Combined source checks and inventory](verification-final/verification.json) and [packaged checks](verification-packaged/verification.json) retain exact commands, times and logs. Review logs remove ANSI/trailing whitespace; any modified original is preserved alongside as `.raw.gz` with its original hash. The packaged Electron web build and integrity check passed. Actual compiled MongoDB and SQLite HTTP fixtures passed with isolated synthetic accounts and fresh-process restarts. SQLite exercised mint/list/introspection, account-bound revoke, PAT management refusal, bearer redaction, no-store headers, retained use count and persisted revocation. It used real Electron safeStorage and verified fixture cleanup. This does not establish an installed full Builder UI or iOS runtime.

Compiled Nitro SHA-256: `17fac19e0155d5465242c12ec6acd05957af3904edb6d6a2665b9efef49f28e9`.

Focused service logs are also retained. The initial mutation-hook test omitted its subscription repository binding; the fixture was corrected without changing the product failure behavior. The prior-head CI failure in notification shutdown tests is retained separately; its source extractor now follows the real hoisted callback while preserving execution and shutdown assertions. The complete moderation suite passes 85/85 with zero skips; focused lint has zero errors and one existing warning. This is the only source-inventory change during combined verification and does not change the packaged runtime.

Before the combined checks, disk exhaustion was resolved by removing only 105 inactive, ignored Graphify scratch generations after verifying their writer PIDs were gone and no files were tracked. Portable snapshots, source, prior evidence and user data were retained. No shared service was changed.

## Remaining acceptance and boundaries

1. P0: finish the full native Things/catalog/resolve contracts and their dependencies before HTTP activation; verify actual offline Builder nested editing, save, reload and export.
2. P0: complete iOS protected-key/runtime launch and physical-device acceptance. Compilation is not runtime acceptance.
3. P0: prove downloadable JSON/PNG artifacts through the connected canonical Thingtime MCP host; preserve the existing deployment/merge hold.
4. P1: finish native app namespaces, broader creation coordinators, managed adapters and Maps vault access. Unsupported behavior must remain explicit.
5. P1: finish update/release trust and final installed acceptance without replacing the stable app with this unmerged branch.

No production deploy, main merge, stable app replacement, existing product-account mutation or shared proxy/key change is authorized by this checkpoint. Private task coordination remains separately authorized. Semantic Graphify extraction remains unavailable under the existing bounded recovery record; the final structural refresh is not a claim of new full semantic indexing.
