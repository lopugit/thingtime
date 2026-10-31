# Shared Apple file synchronization

`AppleFileSync` is the native folder grant, bounded reader and recoverable
publication core used by the iOS host. It also builds and runs on macOS 13+.
The existing `MobileFolderStore`, `MobileFolderReader` and `MobileSyncStaging`
names remain to keep callers and persisted v1 records compatible. iOS pairing
aliases the same `FileSyncOwnerScope`; its JSON and Keychain account key are unchanged.

The core is not an authorization service. A host must verify the current account,
origin, device, saved connection and native grant before every operation, and
obtain separate native consent for writes. Only native picker results may enter
`MobileFolderStore.add`; never pass a web-supplied absolute path. Bookmarks and
credentials stay native. Shared configuration Things, cloud APIs, fingerprints,
run journals and Timeline receipts continue to own synchronization semantics.

macOS creates/resolves security-scoped bookmarks; iOS keeps its existing minimal
bookmarks and data-protection attributes. Mac callers must supply an explicit,
private staging directory isolated to their app identity. Publication currently
requires the staging and destination to be on the same filesystem. Writes use
verified immutable staging and conditional rename/swap; replacements and races
retain prior bytes. The library does not grant deletion authority.

From the repository root:

```sh
swift test --package-path apple/FileSync
apple/FileSync/scripts/test-publication-process.sh
swift build --package-path apple/FileSync --configuration release --target AppleFileSync
```

The first command exercises real temporary-directory bytes, grant separation,
path/version refusal, concurrent staging and receipt recovery. The process script
creates its own temporary directory, exits only its child fixture immediately
after publication, then uses fresh processes to verify create, replacement and
post-exit-edit recovery. It requires Python 3 for checking the persisted proof.
The helper and support targets are test-only and are not dependencies of the
library or the iOS app. The script removes only its own fixture directory.

XcodeGen links this local package from `iOS/project.yml`. The same core tests and
process fixture are compiled into the iOS test target; its WebKit bridge checks
remain in `iOS/ThingtimeTests`. Use the existing iOS simulator runbooks and
`iOS/scripts/test-mobile-publication-process.sh` for the separate iOS process run.
No package download, new secret, service, or entitlement is needed for these tests.

Mac package tests use disposable native-selected fixture URLs and an in-memory
grant store. They do not prove a signed app's picker, Keychain, TCC or sandbox
access, cloud transport, or desktop bridge integration. Those host integration
steps remain required before Mac folder sync is available. Background scheduling,
Photos, peer transport, rename/delete convergence and the full release acceptance
remain in [the delivery ledger](../../docs/mobile-file-sync.md).
