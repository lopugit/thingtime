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
rollback, and the dedicated root-shell metadata path passed that transport
acceptance. This does not replace the outstanding deployed runtime or Builder
acceptance. The build log is `/tmp/thingtime-gateway-dedicated-build.log`; the
acceptance log is `/tmp/thingtime-gateway-dedicated-acceptance.log`.

The final portable Graphify snapshot was refreshed through the repository
wrapper with AST extraction and HTML export (65,339 nodes, 188,624 edges).
Semantic extraction was not run, so changed Markdown/docs are not
represented in this refresh. The earlier semantic path classified the full
corpus as changed (4,122 code files, 641 docs, 384 images) and was stopped before
dispatch; the code-only limitation remains.

The branch now includes freshly fetched `origin/main` at
`3a5b10d538ba0ef9996f004492fe2dd1d8c1454c`, preserving the zero-TypeScript-diagnostic update, drawer/shared-select,
Things/files/devices single-click browsing, canonical Component rendering and
password updates. The integration baseline is `b63b591aa414ab662e86fd3bd9cd0a8ba89888a8`.
At that head the typecheck ratchet reported zero errors, gateway tests passed
14/14, capability and MongoDB health coverage passed 116/116, and the smarts
regression suite passed 7/7. Earlier focused integration checks passed for the
canonical renderer (11/11), schemas (276/276), Feed (89/89), and final delegated
assertions (2/2). Gateway test fixtures explicitly choose the mode under test,
so both the normal proxy policy and a dedicated branch policy exercise the same
assertions. The develop counterpart was merged as PR #1224 at
`cd6f8b8abc94270980bac216da2412ffef8578b1` after its build, API and both CodeQL
checks passed on the exact head. PR #1223's four required CI checks passed on
`b63b591`; the complete source review found no issues. These results establish
source and build readiness, not deployed feature acceptance.

### Current deployment state

The selected origins are `thingtime.com` (production), `dev.thingtime.com`
(custom develop), and `master.previews.thingtime.com` (standard preview).
Production is configured on deployment `dpl_48sQnkSRs5BFuKhsUxncyGwFyxXS`,
source `main` `3a5b10d`; its receipt is
`/tmp/thingtime-bootstrap-artifact-QPhoHI/receipt.json` for attempt
`dd774aba-727f-45e3-af4b-906fd38c94a6`. Develop is configured on deployment
`dpl_5qkujMBNFHMaDBbaD8KEHnQRRD7i`, source `cd6f8b8`; its receipt is
`/tmp/thingtime-bootstrap-artifact-kif5p6/receipt.json`. Develop adopted the
existing scoped secret unchanged.

The first preview owner, `3JG`, on main `789980d2e` was normally promoted by
canonical workflow run `40307943198` (publisher
`1b2496105f61d004c5b2d2c3543704cb51cf73dd`) to `master` deployment
`dpl_5AXh1dSsDDiRy1FLqLV9Dxm34my3`, source main `3a5b10d`. The PR #1223 branch
preview for head `b63b591` is successful at
https://thingtime-73mdoazx5-lopugits-projects.vercel.app.

Production, develop and preview manifests were independently read from their
exact origins and deployments and returned HTTP 200. The negotiated gateway
features are production/preview `1.0.1` and develop `1.1.0`; `/api/root-data`
returned HTTP 200 on all three origins. Configuration readback confirmed the
singleton scope, type and value in memory; credential values were not recorded.
Existing deployments, the Atlas tier and MongoDB credentials were preserved.
The `.com.au` alias remains with its previous owner, and `devcompat9BAF` and
wildcard aliases remain unchanged.

The protected controller fix was merged in PR #1235 at `1b249610`; redundant
PR #1234 was closed. Dedicated canary PR #1229 then published exact head
`d36956c9` at `https://pr-1229.previews.dev.thingtime.com`: the manifest correctly
advertised no shared gateway ownership, root-data returned 200, and a forged
incoming relay was rejected with 403. Its custom develop credential target was
preserved. The ordinary PR #1223 deployment's direct URL returned 200, but its
friendly PR alias returned 421 because that origin was absent from the
deployment's allowlist. Controller PR #1236 adds only the exact assigned alias
to the deployment's source-origin setting, with a new upload policy to prevent
reuse of older builds. Historical deployments remain untouched.

The PR conversation records subsequent exact-head rollout and browser results.
Do not treat HTTP readbacks or passing CI as Builder acceptance: release checks
also cover Thing editing, save/reload, both embed placements and message/comment
controls. Earlier attempts with stale assets or mismatched static shells do not
establish acceptance of this branch.

The initial production/develop configuration preserved legacy continuations.
Their unconfigured gateway paths leave database access intact, and continuation
steps invoke local handlers without fetching through the moved public alias.
Keeping database/origin/task scope and old deployments intact preserves worker
acknowledgments and shared locks. Production's authenticated Tasks UI showed no
running root workflows but one running-status row; the API omits reservation
fields, so no zero-reservation or fleet-drain claim is made. This
first-activation allowance does not apply to later configured-owner promotions.
The user subsequently reported a successful live production Tasks check with
no running server tasks or reservations. This is user-reported evidence, not an
independent inspection of reservation fields omitted from public projections.

## Embed acceptance follow-up — 2026-10-26

Fresh authenticated production readback reported zero pending
`subspace-messaging-spaces` migrations. Posts/Messages switched successfully,
the selected Messages view survived reload, and its channel/composer remained
usable at a 390px mobile width. The existing private coordination embed still
displayed raw Thing fields, requiring explicit Component rendering.

PR #1227 now supplies the shared `ThingView` / `ThingRenderComponent` path on
main. This branch adopts that canonical contract: a displayed data object has
`renderComponent: { id: "<Component ID>" }` or an embedded Component crystal.
Fields bind directly and through `thing`; saved references keep their own ACL
and identity fences. Sources and Actions are inert in this display context.
The earlier parallel adapter and its alternate authoring shape are removed.

Fresh isolated browser testing found another first-load failure: the browser
reported `navigator.onLine === false` while its same-origin API remained
reachable. The shared refresh scheduler skipped the initial embed request.
Initial subscriptions and foreground returns now probe the API despite that
connectivity hint; offline background polling remains paused, and existing
throttling, request coalescing and failure backoff remain intact. Both regions
rendered after a diagnostic refresh, which identified the cause but is not a
substitute for natural first-load/reload acceptance of the fix.

The refresh scheduler's seven tests pass, including offline initial-load,
foreground revalidation and deferred-subscription regressions. The complete
hooks, Lopu UI/store, Messenger and root-data suites passed 779 tests; targeted
lint and `git diff --check` passed. Final browser receipts must use a newly built
client, synchronized Nitro shell and matching node-server image, and cover
natural loading plus actual Builder selection/edit/save/reload.
