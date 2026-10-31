# Resumable account instruction transfer — 26 October 2026

This checkpoint implements the account-instruction transport/storage gates from
[the workspace record](../../docs/local-workspaces.md#resumable-account-instructions--26-october-2026)
and the continuing [PR #1000](../../PRs/1000-codex-anonymous-local-first--support-anonymous-and-offline-local-workspaces.md#resumable-account-instruction-transfer--26-october-2026).

## Delivered contract

- `api.settings-lopu-prompt` 2.0.0 uses frozen attempt identity and content hash,
  immutable 48 KiB parts, a 96 KiB request cap and batches of at most 64.
- Private exact BinData accounting, compact user revision/reference,
  transactional compare-and-swap, seven-day inactive staging expiry, bounded
  64-part cleanup, retained committed generations and renewed cross-tab claims
  preserve retries, lost-ack reconciliation, identity fencing and newer edits.
- Version-2 account-content backup carries sealed instruction references/parts
  and editable recovery content; version-1 reads remain supported. There is no
  aggregate product-size cap and no new live-account restore API.
- Ordinary-reference inference has a bounded 96 KiB compatibility working set.
  Larger enabled inference remains unsupported until provider capacity and
  tokenizer limits are verified. Offline selected-record recovery rescans the
  manifest per part; throughput optimization remains open.

## Validation boundary

The focused core, manifest, inference-surface, retention/inference,
canonical-storage and sanitized client/Nitro build checks are reported by the
task runner. The detailed check names and outcomes are in [CHECKS.md](CHECKS.md).
The raw typecheck reports 91 existing diagnostics versus an 89-diagnostic
ratchet baseline and is not clean. The isolated packaged-app acceptance run
passed offline save/reload, lost-ack reconciliation and both conflict choices,
then failed at the 12,000-line paste check. The failure is preserved in
[the check record](CHECKS.md). The same-page diagnostic recheck completed the exact 12,002-line paste in 9,114 ms, exceeding the strict under-five-second requirement. The renderer responded afterward, with no OOM, JavaScript errors or offline writes; cleanup was verified. High host contention was observed during subsequent diagnosis, so the performance cause remains unresolved. The final packaged app predates the separately tested 15-second newer-edit scheduling correction. No installed macOS acceptance is established.
No new-head CI, production behavior or desktop namespace acceptance is claimed.

`instructions/boundary.json`, `instructions/network-proof.json` and
`instructions/package.json` record the isolated network-none package test
environment. They are environment metadata, not evidence that macOS installed-app
acceptance passed.


The final matched-control diagnostic produced no timing result; terminal cleanup was verified. Its severe host-contention snapshot does not identify an editor root cause. The 14-pass scheduling regression is a local source test only; the final built package predates that change and full acceptance remains open.
