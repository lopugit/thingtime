# Dedicated MongoDB connections and environment gateway defaults

## Scope and decisions — 2026-10-26

- Continue the environment gateway work from PR #1221. The gateway forwards
  HTTP API operations; it does not multiplex the MongoDB wire protocol.
- Default deployed branches to their environment gateway. Offer an explicit,
  server-only build policy and runtime override for dedicated connections so
  backend changes can run on their own branch.
- Dedicated pools do not imply a separate database. Preserve the selected
  environment's database and authentication authority; use independent test
  data for destructive or isolation-sensitive checks.
- Production uses the production cluster. Preview and custom develop currently
  share a different development cluster, verified by comparing configuration
  in memory without recording credential values or connection strings.
- Leave older immutable previews to age out naturally, as requested. Do not
  revoke their credentials, change the Atlas tier, or claim immediate reduction
  to a single socket. Every warm gateway instance still owns its own pool.

## Workspace and ownership

Branch: `codex/gateway-dedicated-connections`.
Worktree: `/Users/lopu/.codex/worktrees/subspace-messages-views/thingtime`.
Base: freshly fetched `origin/main`, starting SHA
`ad0868db5698b5cbe3803a8595879f784ad1a0c2`.
The task branch started at that exact SHA with no tracked modifications or
unmerged paths. Existing generated, untracked Graphify snapshots were preserved.
The dirty primary checkout is not used for edits.

The protected deployment publisher requires a separate change on its canonical
controller branch. Future standard previews must use a controlled master
preview build, never whichever arbitrary PR deployed most recently. A preview
master must be compiled with preview target settings; production-built client
output must not be relabelled as a preview build.

## Verification and rollout

The runtime implementation passed 14 gateway tests, the capability suite,
focused lint, a Nitro server build, and built transport acceptance under an
OS-enforced local network boundary. Two independent MongoDB replicas proved the
dedicated branch executed its own backend and used independent test data; the
ordinary follower made zero MongoDB dials. Authentication, writes, promotion,
rollback, and the dedicated root-shell metadata path passed final acceptance.
The build log is `/tmp/thingtime-gateway-dedicated-build.log`; the acceptance
log is `/tmp/thingtime-gateway-dedicated-acceptance.log`. The portable Graphify
snapshot was refreshed with AST extraction and HTML export. Semantic indexing of
Markdown was not refreshed: the incremental semantic path classified the whole
corpus as changed (4,122 code files, 641 docs, and 384 images, with zero
unchanged), so it was stopped before semantic dispatch to avoid an unnecessary
full-corpus run.

The intended canonical origins are `thingtime.com` (production),
`dev.thingtime.com` (custom develop), and `master.previews.thingtime.com`
(standard preview). Publisher implementation, gateway activation and live
acceptance remain pending. Do not merge the default-proxy runtime before the
required canonical owners and publisher configuration are ready.
