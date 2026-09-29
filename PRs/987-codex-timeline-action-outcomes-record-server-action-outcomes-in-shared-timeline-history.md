# PR #987 — Record server Action outcomes in shared Timeline history

Branch: `codex/timeline-action-outcomes`, based on `main`.
PR: https://github.com/lopugit/thingtime/pull/987

## Behavior

Ordinary server Action runs persist admission before executing steps, then a
redacted completion effect. Both use the existing canonical Timeline event,
relationship and receipt records, private folder, storage ledger, data-plane
selection and local/remote sync. The captured display name and numeric execution
metadata make runs recognizable in Fable's List/Cards/Line/Frames. Activity
cannot be restored, merged or replayed. The inspector opens the same History.

Admission failure refuses execution. Completion retries the same immutable
receipt, never the Action. If acknowledgement remains unavailable, the response
preserves the result and reports incomplete History. Partial failures retain
committed Thing revisions under the same trusted Action/AI operation ID.

Canonical outcomes survive Action deletion. The legacy bounded debug cache
keeps its existing lifecycle and is explicitly supplementary. Invokers own their
history, including deliberate runs of readable public Actions. Shared read-only
runs and browser preparation create no account outcome events. Outcome snapshots
exclude input/result values, traces, exception messages and credentials.

No new collection, index, secret or migration. `api.timeline` 1.15.0 and
`api.actions-run` 1.36.0 are published on both manifests; the run client negotiates
1.36.0. The broader goal remains active: browser receipts, external delivery
verification, incomplete receipt reconciliation and legacy debug-log backfill
are not delivered here. An accepted event alone does not prove completion.

## Validation

- 152 Timeline + 92 capability tests; full unit suite; 100 existing Action API
  verification checks; targeted source and TypeScript-script lint.
- Real disposable `timeline-rs` API fixture covers exact canonical entries,
  private invoker authority, shared/prepared boundaries, no Published-head move,
  partial changes, redaction, forgery/restore refusal and deletion retention.
- Quota fixture uses the real admin subscription API: full allowance refuses
  admission before execution; admission-only room returns the actual result
  with incomplete completion recording and exactly one charged admission.
- Headed browser at 1280×900 and 390×844: all four looks, inspector navigation,
  Activity details, no compare/restore/replay controls, actual quota warning,
  logout privacy, no horizontal page overflow, zero page errors.
- Full Vite/Nitro/Vercel build passed. Full typecheck is byte-identical to the
  existing baseline; this is not a claim that existing type errors are fixed.
- The temporary synthetic admin allowlist was withdrawn and verified. No
  authenticated production writes were used for acceptance.

Screenshots: [Cards](assets/timeline-action-outcomes/cards-1280.png),
[mobile activity](assets/timeline-action-outcomes/outcome-390.png).

Delivery evidence for the exact reviewed commit, preview, merge and production
is recorded on the PR after those stages complete. A local build alone is not
production delivery evidence.
