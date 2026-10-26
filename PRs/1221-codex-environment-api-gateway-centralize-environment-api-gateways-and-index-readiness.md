# PR 1221: Centralize environment API gateways and index readiness

PR: https://github.com/lopugit/thingtime/pull/1221
Branch: `codex/environment-api-gateway`
Implementation source: `a375627c1357384d612f16dc5de4cb368fee9792`
Date: 2026-10-26

## Result

Explicit environment configuration selects the deployment behind a stable alias
as the database/API gateway. Followers negotiate compatible semantic features
and exact operations, forward signed one-hop requests with original origins,
and refuse direct home/custom MongoDB dials. API/root data and public dynamic
routes use the gateway; static branch shells stay local. Missing discovery,
environment mismatch, forged hops and incompatible APIs fail closed. Streams,
notifications and detached Lopu work retain admission until final persistence;
client caches clear after safe drain so rollback can reopen a usable pool.
Configured gateways skip eager warmup, preventing discovery cold-start recursion.

Index plans use a fingerprint and durable ready receipt under a fenced renewable
lease. Changed plans use two DDL slots, serialized within each collection.
Authentication reads stay available after DDL failure; constrained writes wait
for readiness, shared once per request. Authenticated admin recovery and index
rebuilds share the coordination boundary. Rebuild twins preserve unique
constraints, including when the collection has no free index slot. Foreign
custom databases receive awaited data-index setup without home settings records.

Deployment-pinned Workflow callbacks never switch to an unsafe cross-build RPC.
New admissions store their gateway identity; demoted callbacks refuse DB work.
An authenticated current-gateway task read reconciles expired old-deployment
roots through the existing finalizer, keeps uncertain worker reservations, and
shows needs-attention without replaying provider/tool actions.

## Verification

[Machine-readable built acceptance](evidence/1221-environment-gateway-acceptance.json)
records actual Mongo command tracing against a disposable replica set, with
application data created only through real APIs. The backend ran inside a
verified OS network boundary with synthetic test credentials.

- First plan: 138 createIndexes commands, 51 dropIndexes commands; peak DDL 2.
- Unchanged second cold gateway: 0 creates, 0 drops, peak 0.
- Follower: 0 MongoDB dial attempts despite its own configured trap endpoint.
- Real registration, session cookies, root-data reads, post writes, cross-site
  refusal, forged-hop refusal, alias promotion and rollback passed.
- Collections: 81 tests plus 5 module-mock recovery/lifecycle tests passed.
- Gateway: 11; API capabilities: 113; background/Workflow: 42;
  notifications: 12; root/desktop-fallback: 53; SEO: 12 tests passed.
- Focused migration/index regression batches passed; source lint had no errors.
- `NITRO_PRESET=node-server npm --prefix remix run build:server` passed.
- Full-project TypeScript remains non-passing on pre-existing unrelated errors;
  there were no diagnostics in changed implementation files. This is not a clean
  full-project typecheck claim.

Full local diagnostic logs were retained under `/tmp/thingtime-gateway-*.log`;
those paths are local evidence, not CI or deployed acceptance.

## Rollout and limitations

No production/Vercel configuration, alias or Atlas tier changed in this PR.
See [the deployment runbook](../docs/environment-api-gateway.md) for suggested
production/develop/preview assignments, credential scopes and promotion policy.
Separate gateway IDs do not prove separate physical databases. Preview frontend
branches use the selected canonical backend and reject unsupported branch APIs.

Old immutable deployments and future pre-gateway branches ignore gateway env
variables. They need supported credential scoping and retirement/routing controls
before the fleet-wide requirement can be accepted. Removing credentials alone
may leave old frontends nonfunctional, so it is not a complete compatibility
rollout. Do not promote an arbitrary PR as the shared preview backend. Drain and
reconcile pinned continuations before moving aliases; pre-feature tasks without
a deployment tag require explicit preflight. Multiple instances of the selected
deployment still have individual pools and monitoring sockets.

Default DDL timeout is 15 seconds with a five-minute renewable lease and bounded
two-minute contention wait. Supervised maintenance can select a longer safe
policy. MongoDB cancellation occurs at interrupt points; timeout is not proof of
instantaneous server termination. The ready receipt does not audit out-of-band
manual DDL or partial restores: force/invalidate through the supported utility.

Graphify AST refresh completed (65,065 nodes) with five existing partial-parser
warnings and 379 files yielding no symbols. A real local-proxy completion
succeeded, but the incremental semantic detector requeued 639 docs and 384
images; the bounded 120-second attempt did not finish. Changed documentation
is not fully semantically indexed. The usable structural graph and inherited
semantic nodes are retained; this is not a complete corpus audit.

Preview at the implementation head: https://thingtime-91eb7nm4v-lopugits-projects.vercel.app
The public manifest returned HTTP 200, matching origin and api.environment-gateway
1.0.0, with gateway:null (configuration not yet activated). CI was pending at
publication; exact-head required checks still need review before integration.
