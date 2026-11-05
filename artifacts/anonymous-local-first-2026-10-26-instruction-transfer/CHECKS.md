# Check record

| Check | Result | Evidence boundary |
| --- | --- | --- |
| Account instruction transfer core | 42 passed | Parent-run focused core suite; task-local log [core log](checks/core-tests.log). |
| API capability manifests | 133 passed | Parent-run manifest suite; [manifest log](checks/manifest-tests.log). |
| Inference surface | 126 passed | Worker-reported focused suite; [surface log](checks/inference-surfaces.log). |
| Retention and inference | 63 passed | Worker-reported focused suite; [retention log](checks/retention-tests.log). |
| Logical inference byte accounting | 9 passed | Canonical row metadata is counted once across fragments; exact boundary and split Unicode coverage in [metering log](checks/inference-metering.log). |
| Canonical storage | 18 passed | Worker-reported focused suite. |
| Sanitized client and Nitro build | Passed | Parent-run build; `/tmp/thingtime-instructions-build.log`. |
| Typecheck ratchet | Not clean | 91 diagnostics versus 89-diagnostic ratchet baseline; [ratchet log](checks/typecheck-ratchet.log). |
| Native packaged-app instructions acceptance | Failed/open; performance cause unresolved | Real MongoDB and fresh Chromium with network disabled passed offline save/reload, lost-ack reconciliation, and both conflict choices. The subsequent 12,000-line paste timed out; [failure](instructions/failure.json), [resource counters](instructions/resources.json), and [cleanup](instructions/cleanup.json) are retained. This run is not a full acceptance pass. |

The linked focused logs are retained artifacts. The complete sanitized build log
remains task-local; its phase/result summary is recorded separately. The final server rebuild also passed after the inference byte-accounting correction. The same-page diagnostic recheck completed the exact 12,002-line paste in 9,114 ms, exceeding the strict under-five-second requirement. The renderer responded afterward, with no OOM, JavaScript errors or offline writes; cleanup was verified. High host contention was observed during subsequent diagnosis, so the performance cause remains unresolved. The final packaged app predates the separately tested 15-second newer-edit scheduling correction. No installed macOS acceptance is established. The retained recheck is [here](../anonymous-local-first-2026-10-26-instruction-transfer-recheck/instructions/failure.json).

Changed-file lint passed with zero errors and 14 existing warnings across 41 files; see [lint log](checks/changed-file-lint.log). Prior pushed MCP revision [14394ee6](checks/prior-head-ci.json) passed Web CI and CodeQL and is served by the branch preview.

The final matched-control diagnostic launched an isolated network-none runtime but produced no paste measurements under severe host contention; its [contention snapshot](../anonymous-local-first-2026-10-26-instruction-paste-comparison/paste-compare/host-contention.json), [boundary](../anonymous-local-first-2026-10-26-instruction-paste-comparison/paste-compare/boundary.json), and [empty cleanup](../anonymous-local-first-2026-10-26-instruction-paste-comparison/paste-compare/cleanup.json) are retained. This attempt is not an acceptance pass and does not identify an editor root cause. The measured scheduling regression summary in that snapshot reports 14 passed, zero failed/skipped; the tested package predates that source correction.

The bounded [host readiness observer](checks/host-readiness.json) ended at its 180-second deadline with load1 between 876 and 935 on 14 CPUs. Current `memory_pressure -Q` reported 34% system-wide memory free. No browser review or rebuild was started under that contention; the updated static plan has not received a fresh rendered check. Documentation/image semantic indexing is not freshly verified.
