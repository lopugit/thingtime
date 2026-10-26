# Native Settings and saved Action follow-up — 26 October 2026

These are local production-build checks in separate disposable Chromium/backend environments. Both enforce Docker network-none, no host mounts or exposed ports, a read-only root and Chromium sandboxing. Runtime cleanup and zero OOM events are recorded per scenario. No existing account or public content was changed.

## Completed

- [Settings verification](instructions/verification.json): exact 120,068-byte, 12,002-line edit; actual clipboard paste 1,549 ms; completed local save 368 ms; native undo/redo, subsequent typing and exact offline cold reload. The earlier 119,104-byte paragraph remains covered. A measured 64,213 ms blocked-sync interval produced zero repeated instruction requests; shortening resumed normal sync. Lost-response recovery, both conflict choices and private guest refusal also pass.
- [320px Settings screenshot](instructions/instructions-capacity-guidance-320.png): consecutive saves leave one editor-scoped success notification. All nine guidance hit-points are unobscured at each of 1440/390/320px without dismissing notifications or waiting for expiry. The reusable keyed delivery helper preserves unrelated toasts and separate history events.
- [Saved Action verification](shared/verification.json): the normal **Run action** button executes the saved browser Action offline with zero API request events, creates/updates/activates device themes and algorithms, and retains execution details/history after offline reload. Its fixture only seeds synthetic content and reads results. [Run screenshot](shared/profile-action-offline-run.png).
- Shared Copy still retains fresh dependency IDs, an individually edited heading and the exact independent 17,825,795-byte original after offline reload. Action and shared-copy views have no horizontal overflow at 1440/390/320px, with top-to-bottom checks.

## Checks and evidence boundaries

- Production client and Node server builds pass. `test:client-errors`: [63 passed](checks/client-errors.log), including three new notification regressions registered in CI. Targeted lint passes with one existing display-name warning.
- [Raw TypeScript comparison](checks/typecheck-comparison.json): current and exact `64a53cba` baseline each report 91 diagnostics; zero added or removed. This is not a clean raw typecheck.
- [CI baseline](../anonymous-local-first-2026-10-26-followup/ci-baseline.json): exact `64a53cba` passed Web CI/CodeQL and the preview returned matching branch/SHA. Follow-up commits need their own CI. Preview identity is not deployed functional acceptance.
- Offline Action execution emits zero API requests. Cold app-shell reloads emit 23 read-only root/health/publication/account-hint request events and no mutations. These events do not prove successful backend traffic; both the browser offline setting and container network boundary remain enforced. Wider offline shell behavior remains separate coverage.
- The account instruction endpoint still has its existing 96 KiB atomic request boundary. Larger resumable account transport and the broader matrix remain open.
- The unified MCP is installed as `thingtime` and real CLI-host JSON/PNG delivery passed. This desktop chat still exposes the earlier `thingtime-drafts` namespace; unified desktop loading remains unverified. [MCP artifacts](../anonymous-local-first-2026-10-26/README.md).

## Retained failures and diagnosis

[Initial failed Settings capture](../anonymous-local-first-2026-10-26-followup/instructions/failure.png) exposed three overlapping save notifications; the final test above passes with a production fix. The first saved-Action check used a case-sensitive heading locator despite uppercase CSS; the second incorrectly treated cold-shell read events as Action requests. Both failures and cleanup remain under the [failed-attempt directory](../anonymous-local-first-2026-10-26-followup/).

Static [CDP insertion](../anonymous-local-first-2026-10-26/instruction-capacity-diagnostic/observed-tool-output.json) and [trusted clipboard paste](../anonymous-local-first-2026-10-26/instruction-capacity-paste-diagnostic/observed-tool-output.json) diagnostics separate the browser automation bottleneck from native paste. Their stdout was recovered from recorded tool output with provenance, not rerun or fabricated. The normal Settings proof above is independent.

Graph outputs are structurally refreshed; new documentation/images are not freshly semantically indexed because the prior semantic path expanded into an unbounded full-corpus extraction.

[Progress-plan acceptance](plan/verification.json) checks the exact HTML source at 1440/390/320px, all filters/search states and full scroll. The plan retains 61 complete, 14 partial and 12 todo items; completing a subcase does not close its broader workstream.
