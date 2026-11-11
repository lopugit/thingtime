# iOS protected account bootstrap checkpoint

This is source, simulator-target compilation and focused contract evidence.
It is not successful application launch, account HTTP or real Keychain retention.

The isolated full target built successfully from the recorded native input hashes
with frozen Nitro `5617e642b47a394b354effc21c3f36e0acfb00ccbdc24db421b4d25a204c058f`.
`verification.json` records five passing Node tests and an in-memory Swift profile
contract. Their original stdout logs were not retained; those outcomes are
worker-reported, with no real Keychain success claimed. The actual compile outcome
is retained in `native-build.json` and `build-result.log`; inventory summaries
record digest/count/bytes, not full per-file app manifests.

All five bounded simulator control receipts are retained. Attempt 04 reached the
real Keychain and refused with missing entitlement; attempt 05 verified its unique
simulator entitlements but failed to obtain a process handle. All owned simulator
cleanup operations returned zero. No further launch retries or full app launch
were performed. These failures remain unresolved acceptance dependencies.

Independent source review found no actionable issue in the default-off account
selection, app-private Keychain binding, private-pipe bootstrap, environment filter
or ordered shutdown hook. Review is not runtime evidence. Physical signing,
moved-container/reinstall recovery, actual account HTTP and graceful process
shutdown remain unverified. No stable app or real account data was changed.
