# PR #842 — Remove Lopu task caps and auto-continue saved progress

2026-09-17 · branch `codex/lopu-auto-continue` · target `main`

Lopu previously stopped after 24 tool executions, 12 model steps or four minutes.
The background worker and browser observer added further fixed lifetime cutoffs.
These task-wide caps are removed. Hosted requests save checkpoints between fully
settled tool batches, and the open app resumes saved work without a continuation
count cap. Local tool execution can continue without an elapsed-time deadline.

Completed receipts are stored across bounded relational message segments rather
than discarded after twenty tools. Anthropic pause_turn resumes the original
assistant content. Worker/accounting leases renew while work is alive. Polling
transient failures keeps the accepted task identity and output offset.

Stop, account changes, confirmations, unsaved replies and ambiguous failures
prevent automatic continuation. Continuations retain their original chat/model,
remove spent confirmation grants and attachments, and omit stale builder blocks.

## Validation

- 27 streaming tests, 178 Lopu UI tests, 59 Messenger tests and 65 capability
  tests pass. Background worker and Lopu/accounting suites pass.
- Regressions exceed the old tool, step, four-minute and observer lifetimes;
  parallel-tool failure waits for remaining writes and preserves their receipts.
- Production build, Vercel output verifier and built-server manifest smoke pass.
  Contracts: reply 1.11.0, background tasks 1.1.0, chat messages 1.2.0.
- Changed TS/TSX ESLint passes. The existing parser does not support the .mts
  tests; those pass through the Node runner.
- Full typecheck reports 116 errors versus the tracked baseline of 108; no
  reported errors are in changed files. Baseline was not weakened.
- Chrome desktop and 390px mobile synthetic fixture completed 17 consecutive
  parts; mobile Stop prevented further continuation. Top/bottom scrolling and
  model popover inspected. No production messages were sent for testing.
- Graphify code and changed docs refreshed; HTML regenerated. Semantic extraction
  reported one fixture HTML/TSX same-name node collision; AST maps the code.

## Runtime and rollout scope

Local UI: http://localhost:16650/lopu (API 16652, HMR 16651).
Synthetic fixture: http://localhost:16650/scripts/lopu-continuation.browser.html.
The configured Tailscale CLI points at a missing Tailscale app executable, so a
Funnel URL could not be established or verified.

Continuation remains browser-orchestrated while the app is open. Closing every
tab can leave a persisted checkpoint awaiting return; this is not a durable
cross-window workflow runner. External provider/hosting constraints, model
context sizes, account credits/admission and payload bounds remain. A single
provider call or tool that outlives the hosting invocation can still need manual
recovery; uncertain writes are never blindly replayed. Main was not merged and
production behavior is unchanged until release.
