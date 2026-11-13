# PR 1499: Protected deployment checks and reviewed preview retirement

This controller change targets `github-actions`, whose workflows execute directly
for product listeners. It must not be merged into `main` or include product code.
The task branch starts at `44429c6bf68ac14a47e268217bc0bb075ab476ae` and applies
the prepared scoped diff onto that freshly fetched controller base.

## Result

- Shared HTTPS deployment checks resolve the selected project and destination
  through Vercel before using its automation bypass. Both lookups expire; foreign
  projects, redirects and credential-bearing diagnostics refuse.
- Manual PR-0 retirement accepts an exact bounded JSON ID list and a dry-run flag.
  Its protected job reads the canonical saved policy through its existing secret,
  then saves sanitized candidate decisions and provider status/endpoint evidence.
- Reviewed execution preserves active builds, all aliases/current targets,
  stable/gateway owners, open or unverified PRs, and saved PR-close grace. Default
  automatic reconciliation retains its prior behavior.
- The admin preparation contract recognizes the existing exact policy HMAC while
  continuing to reject Vercel/unrelated credentials and all build-job secrets.

## Verification and limits

The deployment/authentication/retirement family passed 83 tests after integrating the concurrent gateway-lease admission update; the develop
publisher passed 318 self-tests; the admin publisher and workflow control-plane
contract passed. All other deterministic verify-step commands passed locally.
Changed JavaScript syntax and workflow YAML checks passed. The first CI run
exposed missing sparse-checkout import closure and invalid job-level runner
context; both were corrected with executable sparse-tree/initializer regressions.
Negative coverage includes foreign-project/redirect header delivery, expired
lookups, failed provider/policy reads, exact dry-run selection, reopening and
alias/target races, and secret-free diagnostic output.

Graphify was structurally refreshed and its new source nodes/manifest entries
checked. Markdown semantic extraction was not rerun in this pass. Query freshness
cache files remain local and are excluded from tracked portable snapshots.

Hosted acceptance remains separate: this PR changes neither project protection
nor aliases and dispatches no retirement. Publish the protected controller first,
then add the optional forwarding inputs to the thin main listener. Run the exact
selection in dry-run mode, review its current-policy artifact and recent usage,
and execute only the reviewed selection through the same protected workflow.
Existing immutable previews require updated source before they can acquire new
server gateway behavior; rebuilding an old exact PR head does not merge main.
