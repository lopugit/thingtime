# PR #269: Give AI resolvers 500 turns and harden stale-label cleanup

## Scope

- Raise every protected Claude conflict, rebase, and promotion-advisory
  invocation to 500 turns.
- Expand both the stack-rebase and synthetic-promotion retry chains to 500
  sequential rounds using GitHub-supported YAML aliases.
- Raise resolver job/Graphify-step runtime ceilings to the GitHub-hosted
  maximum of 360 minutes and conflict-count intake to 500 paths.
- Preserve byte, scope, secret, symlink, immutable-ref, and force-with-lease
  checks.
- Retry and verify stale resolver-label removal, use the configured resolver
  PAT only as a fallback, surface sanitized failures, and stop before dispatch
  when ownership labels remain ambiguous.
- Resume the exact runner-local Claude session whenever its terminal subtype
  is `error_max_turns`; reject every other failed subtype instead of retrying
  an unrelated authentication, permission, or model error.
- Move deterministic workflow/topology contracts out of required unit tests
  and live resolver/deploy/promote paths into non-blocking PR-comment advisory
  lanes. Build, typecheck, unit, API, security, exact-ref, scope, and
  post-model verification remain hard gates.

## Live evidence

Run `31950173335` for PR #201 ended with `error_max_turns` after 81 reported
turns and 570,163 ms. The action's terminal error was `Reached maximum number
of turns (80)`. It was one model session working across 14 conflicted files,
not 80 separate rebase rounds.

## Implementation notes

GitHub Actions does not provide a dynamic loop around `uses:` steps. The
workflows therefore define one first-round step, one anchored retry step, and
498 aliases of that retry step. The composite action maintains a trusted
one-based round counter through `GITHUB_ENV`, records completion and audit
state for the caller, and independently refuses round 501.

Within each model invocation, the pinned Anthropic action remains the first
request. If and only if its private execution JSON ends in
`error_max_turns`, the workflow validates the exact UUID from the result or
`system.init` message and calls `claude --resume <uuid>` with the same model,
500-turn budget, tool allowlist, path denials, and a narrow continuation
prompt. The loop ends on success, a different error, or GitHub's 360-minute
job ceiling; no transcript or stderr is printed.

The 500-turn/round/path request does not weaken byte- or trust-boundary caps.
Those limits protect workflow-command transport and prevent an untrusted PR
from turning a resolver into a broad repository editor.

Graphify received its required structural/code refresh. Semantic extraction
for the Markdown additions also completed through the local private proxy,
followed by a portable report/community rebuild. Control-plane CI checks out
only the current `.github` snapshot so neither required syntax checks nor
warning-only contracts download the repository's full Graphify history.

## Validation

- Workflow control-plane contract self-test.
- Resolver routing contract self-test, including exact 500-round expansion.
- Promotion worker routing contract, including exact 500-round expansion and
  the 500-path limits.
- Shell syntax checks for the rebase/promotion workers.
- YAML parse checks with alias expansion enabled.
- `actionlint` with expression/workflow validation (pre-existing ShellCheck
  informational/style findings excluded).
- Exact-session classifier fixtures for success, `error_max_turns`, malformed
  JSON, invalid session IDs, and unrelated failures.
- Advisory contract jobs and marker-comment behavior; no contract command is
  part of a required unit-test or live automation path.
- Shallow sparse control-plane checkouts validated against the pinned
  `actions/checkout` inputs.
- `git diff --check`.
