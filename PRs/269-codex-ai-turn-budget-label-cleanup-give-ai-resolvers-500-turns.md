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

The 500-turn/round/path request does not weaken byte- or trust-boundary caps.
Those limits protect workflow-command transport and prevent an untrusted PR
from turning a resolver into a broad repository editor.

Graphify received its required structural/code refresh. Semantic extraction
for the Markdown additions remains intentionally unavailable in this PR: the
local semantic pass rewrote unrelated repository-wide graph state and made
GitGuardian skip the scan, so the branch keeps the stable structural result.

## Validation

- Workflow control-plane contract self-test.
- Resolver routing contract self-test, including exact 500-round expansion.
- Promotion worker routing contract, including exact 500-round expansion and
  the 500-path limits.
- Shell syntax checks for the rebase/promotion workers.
- YAML parse checks with alias expansion enabled.
- `actionlint` with expression/workflow validation (pre-existing ShellCheck
  informational/style findings excluded).
- `git diff --check`.
