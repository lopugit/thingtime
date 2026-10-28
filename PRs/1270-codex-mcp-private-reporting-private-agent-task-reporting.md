# PR 1270: Private agent task reporting through MCP

## Behavior

Four MCP tools prepare a stable task Character, execute existing saved reporting
Actions, read exact records back, and maintain one private coordination post.
`agents.report` is a separate explicit grant; existing `things` credentials are
not expanded. The gateway accepts same-origin owner authorization and a closed
set of saved workspace roles. It preserves private saved pages, schemas,
Components and Actions instead of committing account-specific definitions.

Children and grandchildren use distinct Characters while inheriting the verified
project. Their records link to the immediate parent task and shared root task.
Parent roots are read-only for delegates. Receipt identities and task locks
prevent duplicate work, changed-payload replay and stale pre-lock state.

Private coordination follows the canonical subspace audience behavior. The
reporting gateway never changes visibility and refuses further operations if the
subspace becomes non-private. Every post has an explicit render component.

## Verification on 2026-10-28

- Node-server Nitro build passed.
- Reporting: 24 checks passed (20 API regressions and 4 pure contract checks).
- MCP: 40 passed; Characters: 13; PAT scopes: 6; capabilities: 118.
- Schemas: 284; subspaces: 69; existing Action regressions: 159 passed, 1 skipped.
- Focused source lint and `git diff --check` passed. The test runner syntax passed.
- Isolated built-server acceptance passed 11 scenario groups using a disposable
  replica set, synthetic identities and memory-only credentials through real
  registration, saved Things, OAuth DCR/PKCE and MCP HTTP calls. It covered stable
  preparation, private coordination create/retry/update, child/grandchild links,
  saved lifecycle/progress/todo/question Actions, exact ownership/readback,
  anonymous/outsider denial, visibility changes and token revocation.
- OAuth Advanced was expanded and scrolled at desktop and 390px widths. Saved
  screenshots were inspected with credential fields masked; no overflow or
  clipping was observed. Task-owned server, database and browser were cleaned.

The source was authored in this PR; no feature commits were imported. No native
app bundle or production data was changed by local acceptance.

## Delivery boundaries

Full-project typecheck is unverified: a resource-heavy no-output run was stopped.
The `.mts` test file runs under Node but is not supported by the current lint
parser. HTTP `readOverview` Actions are deliberately outside the write gateway;
use exact reporting readback or the separately authorized overview adapter.
Ambiguous writes retain a visible receipt/lock and candidate IDs; they are not
blindly replayed or presented as complete.

Production deployment and actual connected-host acceptance remain pending.
Existing connections require the independent reporting permission and refreshed
host tool discovery. No real-account Character or reporting records have been
claimed as initialized by the local test.
