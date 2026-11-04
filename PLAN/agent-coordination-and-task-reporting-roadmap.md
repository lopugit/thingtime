# Agent coordination and task reporting roadmap

**Status:** Proposed; repository foundations are present, connected-host
acceptance remains separately gated.

**Evidence:** [2026-10-29 runtime evidence note](../NOTES/agent-coordination-runtime-evidence-2026-10-29.md)

## Outcome

An authorized agent can establish one distinct task Character, report measured
work through the existing private saved workspace, and verify readback without
borrowing owner identity, widening an ordinary Things grant, or exposing
private workspace data. A missing permission or saved reference stops only the
dependent reporting action; independent task work remains possible.

## Current foundation

The current integration tree contains the Character, Agent overview, and Agent
reporting runbooks, an origin-bound Character preflight, and named test scripts.
The docs also record local synthetic acceptance for the read adapter and
reporting gateway. These repository artifacts are not proof that the selected
deployed origin, connected host, account grant, saved Things, or private
membership are available now.

## Milestones

### M0 — Contract and local regression foundation

**Status:** Present in the checked integration tree; rerun the relevant checks
on the exact source revision before relying on them for a release.

- Keep the selected-origin capability contract aligned across
  `docs/characters.md`, `docs/agent-overview.md`, and
  `docs/agent-reporting.md`.
- Run the focused Character preflight, Character, Agent overview, Agent
  reporting, PAT-scope, and API capability checks when their source changes.
- Use synthetic saved-Thing fixtures outside the repository and disposable
  identities for HTTP acceptance. Do not commit authored workspace Things.

**Gate:** the exact tested revision passes the focused checks, and the recorded
test scope distinguishes local API/Builder evidence from production behavior.

### M1 — Connected-host authorization and reuse

Run only through the intended authorized Thingtime account and selected origin.

1. Negotiate `api.agent-reporting` 1.0.0, `api.auth-characters` 1.0.0, and
   `api.agent-overview` 2.0.0 at that origin.
2. Verify the independent `agents.report` permission, the current private
   workspace references, and membership in the existing private coordination
   subspace. Treat each as a separate proof.
3. Prepare one stable task identity, report one measured/observed milestone,
   read back the exact saved task/progress records, and repeat preparation to
   prove idempotent reuse.
4. Confirm unknown measurements remain unknown and credentials, account data,
   and private page contents are absent from public output.

**Gate:** the same authorized Character and private task binding are reused;
readback agrees with the submitted lifecycle fields; no write occurs when any
capability, grant, reference, membership, or liveness check fails.

### M2 — Revocation and failure recovery

- In an isolated authorized fixture, remove or revoke one dependency at a time:
  capability compatibility, `agents.report` authorization, saved reference,
  private-subspace membership, and Character liveness.
- Verify later work fails at the specific boundary, does not fall back to the
  owner/public identity, and preserves unrelated independent task work.
- For ambiguous writes, reuse the original request ID and immutable inputs;
  verify readback before any retry.

**Gate:** each refusal is attributable to its exact dependency, private data is
not exposed, and safe recovery requires no blind duplicate writes.

## Measures and stop conditions

| Measure | Acceptance signal | Privacy boundary |
| --- | --- | --- |
| Authorization | All three origin capability versions and independent `agents.report` grant are current. | Record only pass/fail and tested revision; never persist tokens. |
| Identity/reuse | One stable external task identity resolves to the same Character and task binding on retry. | Retain only permitted task identifiers in private workspace records. |
| Readback | The exact progress/todo/task records show the observed values submitted. | Unknown, unmeasured values stay null/absent; do not infer token or runtime counts. |
| Failure isolation | Revocation or missing access blocks dependent reporting without owner/public fallback. | Do not probe unrelated accounts or private workspaces. |

Stop the connected-host milestone when the intended account lacks the specific
reporting grant, the selected origin is incompatible, or any saved reference or
private membership cannot be verified. Report the smallest missing
authorization/access dependency and continue work that does not need private
reporting. Never create a public replacement workspace, copy credentials, or
turn a local test pass into a production claim.

## Dependencies and links

- Contract: [`docs/characters.md`](../docs/characters.md),
  [`docs/agent-overview.md`](../docs/agent-overview.md), and
  [`docs/agent-reporting.md`](../docs/agent-reporting.md).
- Local manual checks: [`TESTING.md`](../TESTING.md#agent-overview-and-task-reporting)
  and the test scripts in `remix/package.json`.
- Evidence: [runtime evidence note](../NOTES/agent-coordination-runtime-evidence-2026-10-29.md)
  and [trusted developer ecosystem baseline](../NOTES/trusted-developer-ecosystem-baseline.md).
- Actionable acceptance: [TODO 58](../TODO/claude-todo/58-agent-coordination-and-task-reporting.md).
