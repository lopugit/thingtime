# PR #1462: Drain retired gateway connections

Branch: `codex/mongodb-leader-handover`
Product PR: <https://github.com/lopugit/thingtime/pull/1462>
Product production branch: `main`

## Behavior

Each environment's stable gateway origin identifies its current database owner.
On an alias promotion, retired deployments stop admitting new database work,
finish work admitted under an explicit lease, close cached MongoDB clients, and
relay subsequent authenticated HTTP operations to the current owner. Static
requests and follower relay traffic no longer keep old pools alive. Streaming
reads, cancellation, social metadata work and detached saves retain the correct
lease scope. Rollback waits for client close and cache eviction before reopening.

Idle-enabled MongoDB clients also attach to Vercel's supported Fluid pool helper.
The negotiated `api.environment-gateway` contract is `1.2.2`, retaining main's
conditional ETag, GET/HEAD/OPTIONS and origin-fenced platform protection support.
Shared connect/index initialization has its own gateway lease while cancelled
HTTP callers stop only their wait; demotion cannot evict its cache or permit
rollback while initialization remains active. This preserves
normal request authorization, signed origin-bound forwarding and environment
isolation. It does not introduce raw database RPC or a boot-time leader election.

## Validation and regression evidence

The isolated built-server acceptance uses a disposable MongoDB replica set and
synthetic identities through the real API. The November 11 run verified
authenticated reads/writes, CSRF refusal, promotion, rollback, dedicated mode,
metadata and index readiness. It observed zero follower MongoDB dials and actual
client closure by both the retired owner and the successor during rollback.

Focused gateway, collections/lifecycle, installed pool-adapter and capability
tests passed. Required build, zero-baseline typecheck, full unit tests and the
headless API suite passed on `6365b2e441da36b88de9d5853ac8b21a18591529`.
The background-task concurrency regression now waits for the asynchronously
admitted worker before counting handler calls and always releases its test gate;
the original 202/409 mutual-exclusion assertions are retained.

Both CodeQL analyses on that revision completed their analysis but failed while
publishing results because of GitHub's installation API quota. A successful
retry on an older revision is not evidence for the current head. Branch
protection remains unchanged; required checks must pass on the final revision.

For a fresh validation, run the gateway, collections and API-capability package
scripts and the opt-in built `test:environment-gateway:acceptance` runner described
in `TESTING.md`. Rebuild the handler before built acceptance. Preserve explicit
fixture database/identity selection and clean up only the fixture's resources.

## Release sequencing and acceptance

The deployment controller is independently released from `github-actions`.
Its source-admission guard must recognize the new lease implementation while
retaining the database-connect fence and legacy gateway recognition. The user
authorized that scoped controller PR and merge on November 13. Release it
through its own protected process, then validate the product preview, merge
this PR through the required checks, and verify the production source,
origin-scoped gateway capability and actual MongoDB request path.

The November 13 main integration preserves the incoming changes and both
changelog histories; the gateway implementation files are unchanged by that
merge. The November 13 API-capability suite passed, and full lint passed with zero errors (457 existing warnings). New-head CI and deployed acceptance remain release gates. Exact
run/deployment links belong in the PR's current validation record rather than
being inferred from this historical note.

## Measurement limits

One gateway deployment can contain multiple warm processes and connection pools.
Driver monitoring sockets and clients in older frozen instances are distinct
from observed application sockets. Do not sum historical deployments or modeled
ranges as a MongoDB-reported total. Successful handover tests and a healthy
deployment do not prove Atlas alert clearance; current provider measurements
must support any such claim.

Refresh Graphify structural snapshots and portable HTML for the final
source. Earlier bounded semantic extraction timed out, so its missing semantic
coverage must not be represented as completed.
