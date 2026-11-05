# 26 October local verification

- MCP build passed; final unit suite: 52 passed, 0 failed, 3 explicitly gated skips. Read-only capability annotations are included.
- Unified SDK/native suite: 1 passed, 1 unrelated running-web-app test skipped. Uses the normal `MCP/dist/index.js`, configured network-none child, real fixture, repeat canonical hash, concurrency refusal, invalid JSON/dependencies/assets/crops, invisible text and overflow rejection.
- Artifact extractor: 5 passed after adding native-host provenance and explicit server selection; exclusive output and complete artifact integrity checks retained.
- Nav: 18 passed, including 160 combinations evaluated from actual visibility initializers. Only the stale source-shape test changed.
- All 88 configured web unit groups were covered. The initial full command stopped at group 42 because macOS Graphify CAS compared `/var` and `/private/var` for the same snapshot. The exact suffix was resumed with canonical TMPDIR: 47 groups, 3,880 passed, 108 skipped, zero failures (one overlapping CAS group). This is not an uninterrupted full-chain pass; full private logs remain local.
- First unified CLI host attempt stopped before rendering because capability discovery lacked read-only metadata. The capability is read-only and now declares this accurately; the host approval policy was unchanged. The repeated actual host test passed all three intended calls.
- Actual Docker lifecycle passed stdin EOF, process-group SIGKILL and runtime hard expiry. Cleanup is scoped to exact task-owned resources.

CI is separate: pushed head `389950164021e915691911862d65b583619ac817` passed CodeQL and preview identity but failed the stale Nav assertion. These local fixes still require their own pushed-head CI.

Design references: UI/UX Pro Max guidance was used for progress/status and mobile inspection. `inspo` is registered and enabled, but no tools from that server are exposed in this chat after supported inventory/config discovery; no inspiration lookup is claimed. The existing plan style and Thingtime design were preserved.

Graph freshness: a final structural/CAS refresh accompanies this source checkpoint. The prior semantic attempt could not produce an incremental delta and selected the entire corpus; that expensive unchanged path was not repeated. New documentation and images are not freshly semantically indexed.
