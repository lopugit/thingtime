# PR #969 — Preserve completed tool results when Lopu resumes

The live acceptance of #967 got through all six JSON pages without rereading
from zero. It exposed a separate continuation gap: a checkpoint immediately
after an Action or inspection discarded the structured result. The next model
hop repeated its diagnosis or reran the Action to retrieve that output.

Verified continuations now reuse completed tool results from the exact existing
private background transcript. The read requires the current first-party
account, chat membership, deployment/data scope, original request identity,
retained output and a safe completed boundary. It selects at most eight results
and 64 KiB, excludes inputs, confirmation events and message payloads, and never
runs a tool. Paged Thing reads keep the fresh ACL/revision restoration introduced
by #967. Ordinary user messages do not receive this context, and caller-supplied
checkpoint results are ignored. Historical results are explicitly evidence of
completed operations, not current state or permission to repeat them.

No new collection, index, result store, credential or permission is introduced.
The browser remembers terminal 404/410 output responses (bounded to 512 IDs),
preventing repeated fetches on each task-list refresh. Account or deployment
changes clear that memory; transient failures remain retryable. Reply capability
is 1.19.2.

## Validation

- Full `test:unit` passed; focused Lopu suites also passed after the final
  route-injection and terminal-polling regressions were added.
- 61 real provider-transport tests pass, including a checkpointed Action followed
  by a resumed provider request containing its result with exactly one Action
  execution.
- Private transcript tests reject another owner, chat, request or deployment,
  revoked membership and expired output; parser tests reject incomplete calls,
  approval boundaries and truncated frames.
- Actual reply-route tests prove only a validated continuation can load results;
  caller-supplied result objects never reach the provider.
- Production build and Vercel output verification pass. Changed production files
  pass ESLint. Raw TypeScript still reports existing repository diagnostics;
  none concern changed production files.
- Live acceptance of #967 continued the chat, executed a diagnostic Action, and
  established that the current-day data has the expected shape. A subsequent
  provider request failed. This PR's hosted acceptance follows deployment;
  local tests are not evidence that the user's planner edit has completed.

Graphify AST outputs, exact-head CI/review, merge and production version are
verified before delivery. The user authorized main merges and explicitly asked
to continue the live chat after deployment.
