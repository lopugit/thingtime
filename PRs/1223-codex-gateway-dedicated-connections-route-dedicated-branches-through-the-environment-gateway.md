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

The protected deployment publisher was updated separately on its canonical
controller branch and merged as PR #1232 at `9ff9d033`. Future ordinary PR
previews must use a controlled master preview build, never whichever arbitrary
PR deployed most recently. A preview
master must be compiled with preview target settings; production-built client
output must not be relabelled as a preview build. Ordinary PR deployments retain
their existing custom develop credential target with explicit logical preview
gateway overrides. An in-memory configuration audit found different sensitive
settings in standard preview, so changing the whole runtime target would expand
branch authority unnecessarily. The preview master itself uses the standard
preview target. Historical PR alias names remain compatible.

## Verification and rollout

The runtime implementation passed 14 gateway tests, the capability suite,
focused lint, a Nitro server build, and built transport acceptance under an
OS-enforced local network boundary. Two independent MongoDB replicas proved the
dedicated branch executed its own backend and used independent test data; the
ordinary follower made zero MongoDB dials. Authentication, writes, promotion,
rollback, and the dedicated root-shell metadata path passed final acceptance.
The build log is `/tmp/thingtime-gateway-dedicated-build.log`; the acceptance
log is `/tmp/thingtime-gateway-dedicated-acceptance.log`. The portable Graphify snapshot was refreshed through the repository wrapper
with AST extraction and HTML export (65,227 nodes, 188,279 edges). Its AST cache
miss scanned 3,659 code files; five files had syntax warnings and 380 yielded
no symbols. Semantic extraction was not run, so the changed Markdown/docs are
not represented in this refresh. The earlier semantic path classified the full
corpus as changed (4,122 code files, 641 docs, 384 images) and was stopped before
dispatch; this update retained the documented structural-only limitation.

The branch now includes freshly fetched `origin/main` at
`78f5c843828a284b9efe25e8d561ef06ef729c9c`, preserving the drawer/shared-select
changes and the Things/files/devices single-click browsing update. The post-integration gateway suite passed 14/14 and API capability
suite passed 115/115. Gateway test fixtures explicitly choose the mode under
test, so both the normal proxy policy and a dedicated branch policy exercise
the same assertions. The develop counterpart was merged as PR #1224 at
`cd6f8b8abc94270980bac216da2412ffef8578b1` after its build, API and both CodeQL
checks passed on the exact head. No live gateway activation is implied by that
integration.

The intended canonical origins are `thingtime.com` (production),
`dev.thingtime.com` (custom develop), and `master.previews.thingtime.com`
(standard preview). Publisher implementation, gateway activation and live
acceptance remain pending. Do not merge the default-proxy runtime before the
required canonical owners and publisher configuration are ready.

## Embed acceptance follow-up — 2026-10-26

Fresh authenticated production readback reported zero pending
`subspace-messaging-spaces` migrations. Posts/Messages switched successfully,
the selected Messages view survived reload, and its channel/composer remained
usable at a 390px mobile width. The existing private coordination embed still
displayed raw Thing fields, revealing a missing explicit-renderer adapter.

Ordinary Thing embeds now use `crystal.renderComponent`, either an accessible
saved Component reference or an embedded definition. The reusable adapter binds
the source Thing's editable content into the canonical Component renderer,
retains Component/Webpage rendering, validates definitions with the same bounded
validator as saved Components, and makes raw-data inspection an explicit choice.
Referenced Components are fetched and revalidated with actor/data-plane fences;
an embed grants no access or Action authority. An independent review checked
the normal Things ACL, stale-identity fence, ownership and Action confirmation
paths. Malformed/ambiguous definitions have regression coverage.

Focused renderer tests passed 9/9, the full feed suite passed 81/81, the schema
sanitizer suite passed 275/275, and gateway tests passed 14/14. The final local
typecheck ratchet exits successfully but reports 92 errors versus its baseline
of 89; no errors are in the owned renderer, schema validator or gateway files.
Targeted lint has no errors and retains one existing registry warning. Actual
deployed Builder selection/edit/save/reload, both embed placements, and remaining
message/comment controls still require acceptance after gateway activation.
