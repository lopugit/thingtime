# Global/site nested Builder acceptance — 28 October 2026

**Acceptance remains incomplete.** One native browser test executed (r2) and
failed before creating blocks: an eager visibility check waited for an inspector
opener while the inspector was already open. The retained screenshot confirms
that fixture readiness race. The corrected fixture waits for the visible block
selector or opener and then requires the selector. Lint and compilation pass;
this correction is readiness evidence until the corrected fixture runs.

The fixture also records every page-observed same-origin `/api` method/path,
asserts no API mutations or selected protected reads, and checks visible,
unobscured composed button/input hit targets. This does not capture all service
worker traffic or prove absence of every account read. No Action execution or
persisted input value is claimed.

## Retained attempts

- [r1 preflight](../anonymous-site-editable-2026-10-28-r1/preflight-result.json):
  transient Docker socket ENOENT; zero browser executions or allocated resources.
- [r2 executed fixture and proof](../anonymous-site-editable-2026-10-28-r2/site-editable/source-proof.json):
  one failed native test, zero skips. [Failure screenshot](../anonymous-site-editable-2026-10-28-r2/site-editable/failure.png),
  [test log](../anonymous-site-editable-2026-10-28-r2/site-editable/test-1.log),
  [boundary](../anonymous-site-editable-2026-10-28-r2/site-editable/boundary.json),
  [network proof](../anonymous-site-editable-2026-10-28-r2/site-editable/network-proof.json),
  [resources](../anonymous-site-editable-2026-10-28-r2/site-editable/resources.json)
  and [cleanup](../anonymous-site-editable-2026-10-28-r2/site-editable/cleanup.json).
- [r3 preflight](../anonymous-site-editable-2026-10-28-r3/preflight-result.json):
  another active runtime; zero browser executions or allocated resources. Its
  owner was left untouched.

r2 verified the network-none runtime with Chromium sandbox enabled, read-only
root, no host mounts/ports, 4 GiB memory limit, loopback app and private runtime.
OOM and OOM-kill counters were zero. Claim release removed its container, the
fixture host exited and private lease/state were removed; an independent check
found zero owned containers and host processes before r3. No personal profiles,
accounts, shared service, VM configuration or production source changed.

## Bounded capacity observer

The [six-minute observer](capacity-result.json) ended `deadline-no-headroom`
with zero additional runs. It used bounded Docker observations with 15/30/60-second
backoff and never stopped or reclaimed the other task’s runtime. Total native
fixture executions remain **one failed test**; corrected-fixture executions **zero**.

## Host-lane preflight and last external checkpoint

The [r5-host preflight](../anonymous-site-editable-2026-10-28-r5-host/result.json)
failed exclusive bind with `EADDRINUSE` at `127.0.0.1:27017`. Existing `mongod`
connections were observed read-only and left untouched. No browser, backend,
database, temporary profile or private state was allocated; no fixture executed.
The app-server safety guard in `remix/app/api/utils/agentTesting.ts:11` requires
that loopback port and a task-specific replica set. This guard supplements the
container boundary; it was preserved rather than loosened for acceptance.

The [last recorded capacity/CI checkpoint](capacity-ci-checkpoint.json) for
`48bda31698b726331d9eae050ec028b1e0134c34` found another task's runtime active,
compute selector queued (run `40676291296`, check `122782413451`) and sibling jobs
skipped. No Web CI or CodeQL pass was established. The previously reachable
[PR preview](https://pr-1000.previews.dev.thingtime.com) is not verified as serving
that commit. These are retained observations, not fresh checks of later heads.
No observer or owned runtime remains active. Next: after a concrete capacity
change, recheck headroom and run the corrected fixture once; await actual hosted
check/deployment results before claiming exact-head delivery. Checklist totals
remain 65 completed, 22 partial and 2 open.

## Final corrected source and remaining work

[Prepared source](prepared-source.ts), [compiled fixture](prepared-fixture.mjs)
and [exact hashes/compiler](source-proof.json) identify the corrected fixture.
The r2 directory retains its different exact executed fixture. Application
archive SHA-256 remains `e5ca5891e959085e7add481841f21f662bdce8da8dfa9649d11aba227a88ba12`;
its runner verified all 19 package-source hashes before execution.

Run the corrected fixture once with the documented isolated runtime variables
from [the original run instructions](../anonymous-site-editable-2026-10-27/README.md).
Keep the existing headroom gate; never reclaim another task's runtime. Nested
editing, offline save/reload and responsive composition remain unverified by
this combined fixture. Broader checklist counts remain unchanged.

The progress-plan copy receives source/parser checks only: its prior file-protocol
visual check was tool-security refused, and this update is not visually verified.
New Markdown semantic coverage is unavailable in the structural-only Graphify
refresh; no shared LLM proxy or credential is used.
