# PR #661: conflict scans and visible previews

PR #592 had a valid exact-head preview, but its continually edited comment was
hidden among older comments. A marked section at the top of the description
now carries the build status, persistent preview and immutable deployment.
Description-only edits are excluded from preview dispatch so publication cannot
recursively trigger itself. The author body is read fresh and preserved; stale
heads, closed PRs and malformed markers cannot be overwritten by this helper.

The primary conflict-maintenance defect was a skipped dependency: the comment
filter correctly skips non-comment events, and route explicitly tolerates that,
but five descendants inherited GitHub's implicit success condition. Live
scheduled run 33964014494 completed routing but skipped conflict detection,
rebase scanning and handoff. The regression traverses the actual YAML dependency
graph and fails on the old workflow. Each repaired job now explicitly tolerates
that skipped ancestor while requiring successful direct dependencies.

Restored scans exposed a second failure: fetching 100 PRs with nested file
inventories repeatedly returned GitHub HTTP 502 (run 33970089738 and a local
read). Ten-PR pages succeeded. The query now bounds each page while retaining
full cursor pagination, with a regression against accidentally truncating it.

The resolver also reads the authoritative target ref after pushing. GitHub's
PR base SHA was observed stale while the branch itself had advanced. A moved
target reuses the existing three-retry detector handoff with fresh admission,
pause checks and queue deduplication. Its retry notice survives instead of being
overwritten with a resolved message. Later target changes remain covered by
the repaired push and scheduled detector paths.

Validation: preview self-test 146/146; event, summary, preview recovery and race
tests; resolver routing and workflow control-plane contracts; parsed YAML and
67 shell-step syntax checks. The new summary test covers author preservation,
stale heads, ambiguous markers, idempotency and prevention of edit-trigger loops.
PR #592 was merged with current develop in isolation; 47 hook/capability tests
and 87 Lopu UI tests passed, changed-file lint passed, client build passed, and
XcodeGen preserved widget and associated-domain settings. No iOS binary was
rebuilt for this integration-only resolution.
