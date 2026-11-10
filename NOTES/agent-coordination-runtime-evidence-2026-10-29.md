# Agent coordination runtime evidence

**Evidence snapshot:** 2026-10-29, Australia/Melbourne

**Repository revision checked:** `origin/develop` at
`018233fef` (the integration tip fetched for this review)

**Scope:** repository docs, package scripts, and recorded acceptance for
Character coordination and private Agent overview reporting. This note does
not establish access to a particular account, saved workspace, Character, or
private subspace, and it is not a production acceptance report.

## What the current integration tree contains

The 2026-10-19 checkpoint in [TODO 58](../TODO/claude-todo/58-agent-coordination-and-task-reporting.md)
said the Character and Agent overview runbooks and preflight command were
missing. That observation is now stale for the integration target. The current
`origin/develop` tree contains:

| Evidence | Current repository state | What it proves |
| --- | --- | --- |
| [`docs/characters.md`](../docs/characters.md) | Character sign-in modes, task identity, private coordination, and separation between public capability discovery and authenticated membership are documented. | A discoverable runbook exists; it does not prove a Character session or subspace membership is available to a particular agent. |
| [`docs/agent-overview.md`](../docs/agent-overview.md) | The 2.0.0 read adapter, saved-Thing workspace contract, measurement provenance, and authored-Thing boundary are documented. | Framework/API behavior and saved-page ownership boundaries are described; the adapter does not create the private dashboard Things. |
| [`docs/agent-reporting.md`](../docs/agent-reporting.md) | The gateway requires `api.agent-reporting` 1.0.0, `api.auth-characters` 1.0.0, `api.agent-overview` 2.0.0, and an independent `agents.report` grant. | Authorization is deliberately separate from ordinary `things` access and public capability discovery. |
| `remix/package.json` | `characters:preflight`, `test:characters-preflight`, `test:characters`, `test:agent-reporting`, and `test:agent-overview` scripts are present. | There are named local checks to run; script presence is not a passing test result. |
| [`docs/agent-overview.md`](../docs/agent-overview.md), Developer acceptance | Records a local 2026-10-19 acceptance using externally authored synthetic Things, including saved views, streaming, readback, and editable Builder blocks. | This is a dated repository record, not a rerun in this review or proof of production/host acceptance. |

The reporting gateway is explicit about recovery: missing capability,
permission, private reference, membership, and Character liveness are distinct
failures. It refuses a different origin, public identity, or replacement
workspace. A repeated task identity is intended to reuse the same binding;
write retries reuse the original request identity and immutable inputs.

## Evidence boundary and open questions

- A public capability manifest establishes only that an origin advertises a
  compatible feature. It does not establish current authentication, an
  `agents.report` grant, saved-Thing ownership, Character identity, or private
  membership.
- The local acceptance recorded by the runbook and the actual connected
  ChatGPT/Codex host path are separate gates. Host tool refresh, account scope,
  the selected origin, and private saved Things can change independently.
- A missing reporting scope must remain a specific access blocker. Do not
  silently upgrade a `things` grant, act as the public owner, or infer private
  access from an ID.
- The next runtime check should use the intended authorized account and
  origin, verify current capability versions and exact saved references, then
  prove one task prepare/report/readback/reuse cycle. Keep private IDs,
  workspace contents, credentials, and personal account scope out of public
  notes.

## Related planning

- [Agent coordination and task reporting roadmap](../PLAN/agent-coordination-and-task-reporting-roadmap.md)
  sequences local regression evidence and separately gated connected-host
  acceptance.
- [Trusted developer ecosystem baseline](./trusted-developer-ecosystem-baseline.md)
  and [roadmap](../PLAN/trusted-developer-ecosystem-roadmap.md) cover adjacent
  origin, grant, revocation, and developer-trust foundations.
- [TODO 58](../TODO/claude-todo/58-agent-coordination-and-task-reporting.md)
  tracks the remaining authorized connected-host acceptance.

Refresh this note after changes to the capability manifest, reporting
permission, runbooks, named test scripts, saved workspace contract, or selected
host integration. Recheck the exact `origin/develop` revision before repeating
any status claim.
