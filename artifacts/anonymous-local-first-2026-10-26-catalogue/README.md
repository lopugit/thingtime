# Streamed account catalogues — 26 October 2026

This checkpoint integrates negotiated authenticated catalogue reads into the
normal account theme and algorithm transports. It preserves the completed
unified Thingtime MCP milestone and does not change anonymous render isolation.

The new read path uses bounded NDJSON framing, ordered entry chunks, transcript
SHA-256 and clean EOF. The server holds one home snapshot across bounded modern/
legacy pages. The client stages entries in the scoped workspace and admits them
in one lease/signal/read-ticket/local-epoch fenced IndexedDB transaction.
Pending edits, dependent Things and conflict review keep their existing rules.
Acceptance creates disposable synthetic profiles through the normal API only.
No existing account data or public content is changed.

## Verification scope

- Shared codec and pinned-source deterministic suites: 23 passed.
- Full manifest/capability suite: 134 passed after correcting one stale exact
  version assertion. The initial failure remains recorded in `unit-initial.json`.
- Staging/admission regressions: 11 passed, including more than the previous
  count/8 MiB limits, interrupted/malformed streams, superseding reads, concurrent
  local edits, dependents, platform quota, cancellation during final admission
  and retired-lease cleanup.
- [Real Chromium storage acceptance](../anonymous-local-first-2026-10-26-develop-integration/catalogue-browser/README.md):
  145 themes and 60 algorithms (the algorithm stream alone is 9,486,361 serialized bytes), pending edits, cold
  reload, cancellation before/during admission, injected native quota failure
  after an earlier write, atomic rollback and no leftover staging. This uses
  the actual storage/account adapters with synthetic streams, not a live server.
  Browser/backend network-none boundary and owned runtime cleanup were verified.
- [Client and Node-server build](build.json) passed with a sanitized environment and no
  account configuration. This is not a deployment.

The first broader workspace run had 853 passes, 97 skips and one reconnect
fixture failure: it still replaced the legacy snapshot method while production
now invokes catalogue streaming. The fixture now uses the actual stream codec,
and the focused reconnect regression passes. [The corrected full repeat](workspace-final.json) passed 856 workspace tests
plus four offline-shell checks (860 total), with 98 opt-in skips. Neither the
initial failure nor opt-in skips count as acceptance.

## Remaining acceptance and implementation

[Built HTTP acceptance](../anonymous-local-first-2026-10-26-develop-integration/built-gateway-catalogue-final.json) passed through the owner and gateway follower using disposable replica sets: 65 themes across a page boundary, two algorithms, both capability manifests, exact content/versions, canonical integrity and clean EOF, plus anonymous/cross-site/wrong-owner refusal. Existing gateway, renderer, dedicated-storage and promotion/rollback checks also passed; no fixture listeners remained. Two earlier acceptance assertions confused the public and route manifest envelopes; they were corrected against the canonical schema without changing runtime behavior. Initial failures are retained.

Live concurrent mutation and legacy-precedence proof, and the complete native product UI journey, remain unverified. Remote creation still has the old 100-theme/50-
algorithm limits; individual write and larger transfer contracts remain bounded
by existing validation. Legacy JSON snapshots retain their compatibility limits.
This checkpoint does not claim all remote capacity work is complete.

Web CI and CodeQL passed for preceding integration commit
`2ced7219977adcfa42608f571ad44414305eb357`; they do not prove this later source.
The preview workflow for that commit failed without exposed jobs/check-run
diagnostics. The reachable branch preview served older `7f4803f9` at the last
verified read. No manual deployment, PR merge or existing account-data mutation
was performed.

The updated [HTML progress plan](../../docs/progress/anonymous-local-first.html) passed full-scroll/control checks at 1440, 390 and 320 CSS pixels in a task-owned isolated browser. See [plan verification](plan-final/verification.json); its source hash and cleanup record identify the exact copied document.

Raw TypeScript checking retains 91 diagnostics, matching the pre-catalogue count, with no diagnostics in the changed catalogue/storage/account adapter files. This is not a clean typecheck or a normalized-signature comparison. See [typecheck result](typecheck.json). Changed-source lint passes.

The updated plan retry passed after an initial container-operation timeout; the first runtime was released with no owned container left. The [failed attempt record](plan-final-attempt1.json) is retained separately from the passing page result. A focused independent source review found no actionable catalogue security or correctness defect; it did not rerun the tests.

Graphify uses the structural incremental path for this checkpoint. Changed-document semantic freshness is not claimed.
