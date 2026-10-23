# 58 — Agent coordination and task reporting

**Status:** Proposed; requires owner review of capability, privacy, and tool
boundaries.

**Evidence checkpoint:** 2026-10-19 (Melbourne). The public manifest at the
selected Thingtime origin advertised `api.auth-characters` 1.0.0 and
`api.agent-overview` 2.0.0. The checked PR head and `origin/develop` did not
contain `docs/characters.md` or `docs/agent-overview.md`, and
`remix/package.json` had no `characters:preflight` script. This is a repository
workflow/documentation gap, not evidence that the private workspace, a
Character, or membership is unavailable. Public capability discovery alone
does not establish Character identity or private-subspace access.

## Goal

Give agents one supported, auditable way to establish task identity and report
progress in the authorized private workspace. Make each proof explicit:
public capability compatibility, authenticated Character identity, private
subspace membership, and successful task-record readback are separate checks.
Never infer one from another.

## Phase A — Document the actual contracts

- [ ] Add `docs/characters.md` from the current Character capability and API
  contracts. Explain origin selection, compatible-version checks, Character
  authentication, private-subspace membership, supported controls, and the
  difference between public discovery and authenticated authorization.
- [ ] Add `docs/agent-overview.md` for the private saved-Things workspace:
  describe task/agent/project relationships, idempotent lookup and reuse,
  lifecycle/status semantics, measurement provenance, and the supported saved
  Actions. Treat IDs as runtime references, not grants; do not publish
  account-specific IDs, private page contents, or credentials.
- [ ] Cross-link both runbooks to the feature/capability documentation and
  relevant identity and trusted-developer ecosystem notes. Record any behavior
  the live contract cannot confirm as an open question, not an implementation
  claim.

## Phase B — Provide a safe preflight

- [ ] Implement the documented
  `npm --prefix remix run characters:preflight -- --origin <origin>` entry
  point only after locating the canonical manifest/capability client and its
  validation rules. Keep the origin explicit and normalized; do not accept an
  arbitrary route, spoof browser headers, read browser credentials, or fall
  back to another origin.
- [ ] Require the declared compatible `api.auth-characters` version before
  attempting supported Character operations. The public manifest result must
  say only that the feature is advertised; it must never claim a Character is
  authenticated or a private membership is present.
- [ ] Keep private workspace reads/writes on the documented saved Actions and
  APIs. Preview composed writes and honor any tool-level confirmation gate;
  never bypass it with raw HTTP or an invented endpoint.
- [ ] Add focused tests for malformed/mismatched origins, missing or
  incompatible capability versions, manifest success without authenticated
  membership, and errors that do not disclose tokens or private workspace
  data.

## Phase C — Verify durable reporting

- [ ] Search by a stable task identity before creating records; reuse existing
  project, task, and agent Things when present. Link child agent records to the
  actual parent IDs and shared task instead of inventing identifiers.
- [ ] Record a start time only when observed, progress only when measured, and
  token usage only when supplied by an authorized measurement source. Keep
  unavailable values unknown rather than writing zero or estimates.
- [ ] Read back each permitted update and distinguish submitted, saved,
  visible, and complete. Persist a final record with verification, limitations,
  and artifact links before marking the task complete.
- [ ] Add integration coverage using an isolated account/workspace fixture;
  prove an unauthorized or wrong-origin session cannot read or write the
  private Agent workspace. Do not exercise production membership mutation as
  a test substitute.

## Acceptance criteria

1. Both referenced runbooks exist, are discoverable from the docs index, and
   match the current versioned capability contracts.
2. The named preflight command works from the repository root, fails closed on
   an origin or compatibility mismatch, and makes no claim about authenticated
   identity or private membership from public metadata alone.
3. An isolated end-to-end test reuses an existing task idempotently, records
   only measured/observed lifecycle fields through the supported Actions, and
   reads back the saved state; a negative access test proves private data stays
   inaccessible across origins and identities.
4. No credential, private workspace ID/content, owner data, or browser session
   state is emitted in docs, logs, test snapshots, or public responses.

## Risks and next action

The instructions may outrun the checked-in client or change independently from
the live saved workspace. Do not duplicate private schemas or Actions in source,
and do not label a public capability check as user consent. First compare the
current API contract and the supported Thingtime tooling with the live runbook;
then ask the owner to resolve only genuine contract gaps before implementation.

Related context: [trusted developer ecosystem baseline](../../NOTES/trusted-developer-ecosystem-baseline.md),
[trusted developer ecosystem roadmap](../../PLAN/trusted-developer-ecosystem-roadmap.md),
[identity and context-safe presence TODO](35-identity-agency-and-context-safe-presence.md).
