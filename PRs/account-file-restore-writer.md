# Reviewed account file publication

The worker restores selected complete file-history graphs from independently verified portable backups into explicitly reviewed owned destinations. Existing ordinary restored folders retain their metadata. Current bytes, exact-version bytes, historical rename/move snapshots, same-file parent graphs, branch names, empty files, inert symlinks and source Trash survive source/vault loss. Canonical writes create fresh audit records as well as remapped original history; the product History UI does not yet group those audit effects.

The source seal, commands, destination and capability requirements are immutable. Private SQLite indexes keep source lookup bounded. Full bytes are verified before private expiring import staging; only trusted canonical transactions consume drafts. Session/root/hold/epoch fences bind canonical publication, receipt and checkpoint atomically. Bounded final verification and completed replay preserve later owner edits, renames, moves and untrash.

## Evidence

[Immutable final real proof](evidence/account-file-restore-final-proof.json): 23 commands, eight imported history records and 17 checks through real Request handlers, a disposable replica and local object adapter. The source hierarchy, original object store and first vault were removed; source session was revoked. Independent current/historical API byte readback, interrupted staging/committed-version replay, exact canonical attachment binding, five distinct nonempty PUTs, empty metadata, Trash/untrash preservation, missing-history refusal and final owner-edit/session-revocation races passed.

The receipt SHA256 is `bbf5d742851d47d435cdf9f6f735a866beefa6674e74224713ce43fec112eba3`. Its 11 runtime/helper/doc source hashes match final runtime. The fixture's only subsequent change replaces the erased `RequestInit` type assertion with `ConstructorParameters<typeof Request>[1]` for ESLint; runtime is unchanged. Initial earlier successful proof had no source hashes and is not represented as final revision evidence.

Independent non-helper review cleared aggregate `d1c7cf2592db1c00f0d80a19891f72eb48b9bbb74639cda86fc5e17126de4919`; the indexed-reader helper was independently reviewed by the parent. This aggregate hashes ordered shasum output for accountFileRestore, accountFileRestoreBytes, accountFileRecovery, files/files, contentExecutionGate, recordMutation, cloudTransport, accountInventory, attachmentRecords and apiDocs (all current Remix source paths).

Final focused suites: backups 149/149; Files 110/110; Timeline 250/250; capabilities 152/152; none skipped. Raw TypeScript passed. Full changed-file lint has no errors after fixture type cleanup; three warnings remain (two existing apiDocs escape warnings and an import-type style warning). Canonical build and `verify:vercel-output` passed. Compiled Vercel handlers returned JSON for both origin manifests and seven docs contracts, including all three PATCH features; the synthetic unlistened database logged an expected bootstrap warning after success. These builds preceded latest-main integration; that base delta changes only iOS/device presentation and native test harnesses, with no restore/runtime/dependency delta.

## Contracts and limits

No new endpoint or public body option. `api.files`1.12.1, `api.things-bulk`1.7.1 and `api.things-delete`1.1.1 deliberately PATCH epoch-fencing side effects. Public retained-version behavior and ordinary native-sync provenance remain covered. Moderation inventory intentionally retains safe policy status and excludes provider diagnostic timestamps. All writers sharing a database must deploy epoch-aware code together.

This is backend-phase delivery, not public restore UI/jobs, complete account/security adapters, live S3/provider durability, installed/native acceptance or measured large-scale throughput. `wholeAccountReady` remains false. Private scratch can survive process crashes; normal cancellation/close cleans it. Final combined signed native installation belongs to parent release coordination.
