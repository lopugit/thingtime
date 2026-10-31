# 58 — Agent coordination and task reporting

**Status:** Foundation documented and locally exercised; authorized connected-host
acceptance remains open.

**Evidence checkpoint:** 2026-10-29, Australia/Melbourne. The fetched integration
tree `origin/develop` at `018233fef` contains `docs/characters.md`,
`docs/agent-overview.md`, `docs/agent-reporting.md`, the origin-bound
`characters:preflight` script, and named Character/Agent test scripts. This
supersedes the 2026-10-19 checkpoint that said the docs and preflight were
missing. The runbooks record local synthetic acceptance, but this documentation
pass did not rerun those checks or verify a live connected host, private saved
workspace, Character session, or membership.

Read the [dated evidence note](../../NOTES/agent-coordination-runtime-evidence-2026-10-29.md)
and [roadmap](../../PLAN/agent-coordination-and-task-reporting-roadmap.md)
before continuing. Current contract details live in
[`docs/characters.md`](../../docs/characters.md),
[`docs/agent-overview.md`](../../docs/agent-overview.md), and
[`docs/agent-reporting.md`](../../docs/agent-reporting.md).

## Goal

Allow an authorized agent to establish one distinct task Character and report
through the existing private saved workspace, with each boundary verified
separately: origin capability compatibility, independent reporting permission,
authenticated Character identity, saved-reference access, private-subspace
membership, and successful task-record readback. A public manifest or local
test cannot stand in for any of the later proofs.

## Completed foundation

- [x] Document Character sign-in, private coordination, and the distinction
  between public capability discovery and authenticated membership in
  `docs/characters.md` on the current integration tree.
- [x] Document the saved Thing workspace contract and explicit unknown-value
  behavior in `docs/agent-overview.md`.
- [x] Document the origin-bound reporting gateway, the independent
  `agents.report` permission, retry identity, and failure boundaries in
  `docs/agent-reporting.md`.
- [x] Add the explicit `characters:preflight` entry point and focused test
  scripts; these are present in `remix/package.json` on the current integration
  tree. Script presence is not a passing test result.
- [x] Record local synthetic read-adapter and reporting acceptance in the
  runbooks. Treat that as dated repository evidence, not production or current
  host acceptance.

## Remaining work — connected-host acceptance

- [ ] Through the intended authorized connection, negotiate
  `api.agent-reporting` 1.0.0, `api.auth-characters` 1.0.0, and
  `api.agent-overview` 2.0.0 at the selected origin. Keep discovery and
  authorization outcomes distinct.
- [ ] Verify the independent `agents.report` grant, the exact saved workspace
  references, and membership in the existing private Thingtime Agents
  subspace. Ordinary `things` access does not imply the reporting grant.
- [ ] Prepare a stable external task identity, record one actually observed
  progress update, read back the exact task/progress Things, and repeat
  preparation to confirm the same Character and binding are reused.
- [ ] Verify unknown progress, token usage, and start/end times remain unknown
  unless measured and attributable. Keep credentials, private page contents,
  account data, and private ownership links out of public docs and logs.
- [ ] In an isolated authorized fixture, verify a missing grant, inaccessible
  reference, changed origin, revoked membership, or disabled Character stops
  dependent writes without public-owner fallback. Reuse the original request ID
  and immutable inputs after an ambiguous write; read back before retrying.

## Acceptance criteria

1. The current runbooks, preflight, and test scripts remain discoverable and
   match the selected-origin capability contracts.
2. The exact source revision passes the focused preflight, Character, Agent
   overview, reporting, PAT-scope, and API-capability checks when those sources
   change; local synthetic acceptance is labeled separately from host/live
   acceptance.
3. A connected-host run proves all capability, grant, identity, saved-reference,
   membership, idempotent reuse, and exact readback gates using the intended
   authorized account and origin. Missing access is reported as a blocker; no
   fallback identity or new workspace is created.
4. Revocation and ambiguous-write cases remain safe, retries do not duplicate
   lifecycle records, and no credentials or private workspace content appear in
   public artifacts or logs.

## Next action and stop condition

Run the documented public preflight from a checkout that contains the current
script, then verify host authorization and private saved-Thing access through
the supported reporting tools. If the intended connection lacks the separate
`agents.report` permission or any exact saved reference, stop only that
dependent reporting action and keep unrelated task work moving. Do not upgrade
ordinary Things access silently, copy a credential, post as the owner, or
interpret local test success as production acceptance.

Related developer-ecosystem context: [baseline](../../NOTES/trusted-developer-ecosystem-baseline.md)
and [roadmap](../../PLAN/trusted-developer-ecosystem-roadmap.md).
