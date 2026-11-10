# Develop integration — 26 October 2026

This local checkpoint combines feature parent `385eee2a4f3218d385467eb41d628e6a4c2f606d`
and develop parent `cd6f8b8abc94270980bac216da2412ffef8578b1`. It preserves the
anonymous/offline implementation, incoming gateway/index lifecycle, notification
URL sanitizer, and both gateway and local-workspace test registrations.

- [Initial unit run](unit-initial.json): gateway 14, API capabilities 133,
  notifications 64, collections 86, workspace/offline shell 842, feed 96 and
  drafts 50 passed. There were 107 opt-in or existing skips. Schema checks were
  276 passed and one failure: the existing split-refusal timing assertion took
  27 ms against its unchanged 25 ms threshold while the build was also running.
- [Schema repeat](schema-repeat.json): after the build completed, all 277 passed.
  No threshold or production implementation was changed to obtain this result.
- [Build](build.json): the full client, platform/library/embed/draft/offline
  bundles and Node server build passed without account configuration. Existing
  WASM parser fallback warnings remain. This is a Node-server build, not a
  Vercel deployment.
- [Final built gateway acceptance](built-gateway-final.json): sandboxed backend processes,
  two disposable replica sets, synthetic identities through the real API,
  direct-IP outbound refusal, authenticated forwarding, cross-site refusal,
  promotion/rollback, independent dedicated database, and no follower Mongo
  connections. Draft preview document/script bytes match the branch build,
  retain the exact restrictive CSP and no-store policy, and public-card GET/HEAD
  return PNG/empty-body responses. Root docs work through both Nitro and Vite.
  All fixture listeners were gone after cleanup. The final source rebuild and
  acceptance passed again after type/import cleanup; [the initial run](built-gateway.json)
  remains available. Changed-source lint passes.
- [Typecheck repeat](typecheck-final.json): the incoming gateway mode diagnostic
  was fixed by explicitly returning the two valid literals before rejecting
  other values. The warning-only ratchet returns to 91 diagnostics against its
  89 baseline; this is not a clean typecheck. The initial 92-diagnostic result is
  retained in [typecheck-initial.json](typecheck-initial.json).
- [Plan browser verification](plan/verification.json): full scroll, filters,
  search and footer checks pass at 1440, 390 and 320 pixels with no horizontal
  document overflow. The copied plan ran in a task-owned network-none Chromium
  container; network and cleanup records sit beside its screenshots. The 62
  completed rows are historical checkpoints, with 13 partial and 12 planned.

The rebuilt native renderer digest remains
`d56b0a8f26925ff24f7f6df4253a50dbdffc22a471b5eae363ee9ab897275467`, matching the
[actual unified desktop-MCP artifacts](../anonymous-local-first-2026-10-26-desktop-mcp/README.md).
Those images were captured in that earlier host call; this checkpoint does not
relabel them as a new capture. Canonical content hash remains
`a251642fe58ef5b1a2f32f8414591e02d6d52ebd2a50293f6b14c12464d4a06c`.

CI and deployed preview acceptance must be checked against the pushed merge
commit separately. Installed macOS-app acceptance, the large instruction-editor
timing gate, catalogue/transfer capacity and the broader device/account matrix
remain open. No PR merge, manual deployment or existing real-account mutation
was performed. Graph refresh is structural; fresh semantic indexing of these
documents is not claimed.
