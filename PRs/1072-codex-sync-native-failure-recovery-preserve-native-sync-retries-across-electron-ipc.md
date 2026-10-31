# Preserve native sync retries across Electron IPC

Native identity verification already returns a fixed retry marker, but its `ThingtimeNodeBridgeError` name survives Electron43.1's `error.toString()` serialization. The renderer recognized the ordinary `Error` wrapper only, so a temporary native identity failure could become terminal attention. Normalize that exact native code/message before IPC. This is a source-proven boundary gap; the recurring installed failure's actual code remains unconfirmed.

Only the existing `node_timeout` and `node_unavailable` codes from native dispatch gain resumable classification. Current authority wins over a concurrent interruption; auth/grant/source, protocol, capability and cancellation failures remain terminal. Existing journal admission/backoff and receipt-first reconciliation preserve operation identities and unknown effects. No HTTP/native wire schema or lease policy changes.

Folder-request failures now persist a closed action/step/code record in the existing bounded, mode0600 folder-sync diagnostic file. Error messages, paths, account/device IDs and secrets never enter that projection. Temporary cloud errors expose only fixed operation/code/proxy-origin categories, using at most4KiB of response data; task waiting UI preserves those safe reasons.

## Verification

- Regression failed before the patch for custom native identity Error names and unclassified native transport interruptions. Host/diagnostic tests:33/33 pass.
- Full shared fileSync suite:498/498 pass, including original-operation automatic discovery, durable backoff, uncertain-write receipts, terminal refusals and safe cloud diagnostics.
- Actual existing AppleFileSync tests:4/4 pass: interrupted publication without repeating swap; multipart staging reopen; stream checkpoint/tail recovery; interrupted Trash preserving a recreated source.
- Existing JS staging reply-loss, publication/Trash immutable receipt, pending-operation refusal and original-ID tests also pass. No redundant recovery models were added.
- ESLint:0errors, two existing loop-closure fixture warnings. Diff checks pass.
- Real isolated Electron fixture could not load Chromium because sandbox initialization returned EPERM. No permissive fallback was used; its process and ports were cleaned up. The host-to-renderer regression uses the pinned Electron43.1 serialization algorithm.
- Incremental graph refresh is structural/AST only; Markdown semantic freshness is unverified.

## Remaining acceptance

Review/merge, final signed build and installed automatic-retry acceptance remain separate gates. The existing Home job, grants, receipts and versions must survive; sustained payload progress and independent downloaded-byte equality are still required. This patch does not claim the upload-start503 cause is solved.
