# Thingtime architecture, security, moderation, and media merge order

Recorded before any merge on 2026-08-21 after `git fetch --all --prune`, live
GitHub PR/check inspection, branch topology inspection, and a Graphify query.

## Authoritative starting state

- `main`: `440c30d738a0da37cd21d3f65aa057489f58f41d`
- `develop`: `e15ae75b50a805a8a3b73b1f78ffb7bcf78a0815`
- #90, #99, #306, #319, and #322 are merged into `develop`, not `main`.
- #310 is merged into `main` and is already an ancestor of current `develop`.
- #309's only commit has the same stable patch-id as #310. It is already
  represented semantically on both branches and must not be replayed.
- #302 is the obsolete upload-gate line. Its remaining unique useful behavior
  is the purpose-aware approval-pending composer/error presentation; preserve
  that behavior directly on `publicUploadsEnabled` / `privateUploadsEnabled`,
  without `canUploadMedia`, `meta.mediaUpload`, `secureMediaUpload`, a second
  API, or a second admin control.
- #308 contains duplicated #302 ancestry. Rebuild it from the moderation-only
  commits on current `develop`; do not merge/rebase the obsolete gate history.
- No newer open PR after #326 belongs to this scope. Closed #327 was folded
  into excluded #323 and remains excluded.

## Dependency graph

```text
#322 -> #324(main) -> live CSP/S3 proof
                       |
                       +-> #296(main) -> #297(main, after CodeQL repair)

#310(main + develop canonical scopes)
  -> reconcile/close #309 and #302
  -> moderation-only #308 -> moderation staging drill -> scoped main promotion

#320 -> scoped main promotion -> #325 -> scoped main promotion -> deploy
  -> converge indexes + relationship uniqueKeys backfill everywhere
  -> #326 -> scoped main promotion -> open-crystal coexistence proof

#306(develop) -> #311(main)
#319(develop) ----+
#312(rebased) -----+-> combined scoped media promotion after #311
                         -> #321 -> scoped main promotion -> detected-type backfill
```

## Exact execution and merge order

1. Review the AI-resolved #324 patch against #322 and current main. Merge #324
   with a merge commit. Wait for production and prove a real multipart S3
   attachment upload under the served CSP, including render/download and no
   CSP violation.
2. Review and merge #296 with a merge commit. Wait for production and prove
   scoped app/app-data indexes and `conditions:[null]` returning 400.
3. Repair the two #297 CodeQL findings in `verify-vercel-output.mjs` on both
   the current develop source and the promotion branch (end-tag matching and
   exact CSP-source URL validation). Re-run security/build/API checks, review
   the promotion against current main after #324/#296, merge #297, wait for
   production, and prove RCE removal, deterministic Date persistence, CSP,
   registration body cap/rate limiting, and S3 uploads under CSP.
4. Validate current develop/main scoped upload behavior against #309/#310.
   Preserve only #302's useful purpose-aware pending UI/error behavior using
   the two canonical scope fields. Close #309 as already represented by #310
   and close #302 as superseded; do not introduce compatibility aliases or a
   second grant.
5. Rebuild #308 on current develop using the moderation-only change series.
   Omit obsolete upload-gate commits and the cleanup commit that manipulates
   that obsolete gate. Resolve current attachment/things/media conflicts by
   keeping canonical scoped permissions and protected server moderation.
   Update the cron configuration test for the moderation sweep (the current
   #308 CI failure). Merge into develop only when green.
6. Deploy #308 to a staging/preview environment backed by the configured S3
   stack. Run the mandatory deterministic-provider drill: approved upload,
   pending, clear, nsfw, blocked/quarantine/public disappearance, blur + Show
   Anyway, admin queue/overrides, sweep recovery, ACL/private behavior, and
   generic-Thing moderation-field forgery refusal. Then create/review/merge a
   scoped #308 promotion to main and repeat production-safe smoke proofs.
7. Rebase/reconcile and merge #320 into develop; run all seven squat-key tests.
   Create/review/merge its granular main promotion and wait for deployment.
8. Rebase/reconcile and merge #325 into develop. Create/review/merge its
   granular main promotion and wait for every writer deployment/database to
   boot and converge indexes. Verify old kind-blind unique indexes are absent,
   non-unique lookup indexes exist, run the home relationship-uniqueKeys
   backfill, repeat to zero work, and inspect all collision/operator notes.
9. Only after step 8 is proven everywhere, rebase/reconcile and merge #326 into
   develop, promote it granularly to main, and prove ordinary crystal values
   coexist with real relationship keys (follow plus representative member,
   dm/invite/emoji/friend names) while structural uniqueness still E11000s.
10. Review and merge #311 to main after confirming ordering already remains in
    develop and passes create/edit/reload/permalink, pointer/touch, keyboard,
    and desktop/mobile behavior.
11. Rebase/reconcile #312 onto current develop (which already contains #306
    and #319), resolve attachment/things intersections manually, and merge it.
    Rebase/reconcile and merge #321 after #312. Run the combined media, ACL,
    annotation/layout, storage-accounting, and browser matrix on develop.
12. Create a deliberate scoped main media promotion containing #319 content
    detection plus #312 UI/data semantics on top of #311, with no develop-only
    product features. Merge after full review and production smoke. Promote
    #321 separately, then dry-run and execute bounded detected-type backfill
    passes to a zero-work idempotent final pass.
13. Run the combined auth/security/Things/permission/media/moderation/storage
    suites on the final develop and final main states. Verify CI and live
    deployments; close any promotions made empty by the scoped release.

## Hard stop-gates

- Do not merge #297 before #324 production CSP/S3 proof.
- Do not promote #308 before the full staging moderation drill.
- Do not merge/promote #326 before #325 is deployed, indexes converge on every
  writer DB, and relationship backfill is verified/idempotent.
- Do not run a mutating backfill before its dry-run/count review.
- Do not use #289 or merge excluded feature branches into main.

## Execution log

- 2026-08-21: #324 merged to `main` as
  `0747e135b0831fc0a693de13ccd67dc1b1eb9ad1`; Vercel production deployment
  `dpl_5eiE1wRVVyZspN9cwZyqPtqiqwEn` is READY/PROMOTED and owns the production
  aliases.
- #324 live gate: `dev.thingtime.com` served the strict policy with the exact
  private S3 origin; two authenticated multipart drafts completed direct S3
  PUTs with HTTP 200 and reached Ready; Chrome reported no CSP or
  refused-connect diagnostics.
- #296 reconciled with current `main` at
  `4aef269b80054d1eaf8c9d2dd95bfa513b8e7f09`; its effective non-Graphify diff
  remains the three #90 files only. The full unit suite passed and the preview
  API returns 400 with `Each condition must be an object` for
  `conditions: [null]`. Fresh Web CI/Vercel checks remain queued.
- Production index baseline before #296: `things_v2` still has the legacy
  unique `crystal.clientId_1` and
  `ownerId_1_crystal.appId_1_crystal.key_1` indexes with kind-blind partial
  filters; the scoped replacements are not present yet.
- #296 merged to `main` as `bfe908466ad9a6f72cb1790c2415b11653c75c1d`;
  the production malformed-search and scoped-index proofs passed.
- #297 merged to `main` as `b046e8ead597d1b7ab49dac5ac87ce31cf4275f4`;
  production persistence, Date, CSP, registration-cap, and direct-S3 checks
  passed after #324.
- Canonical scoped upload reconciliation #330 merged to `develop` as
  `28269de8...`; promotion #331 merged to `main` as
  `52c2d499381449888...`. #302 and #309 were closed as superseded/already
  represented, leaving only public/private/all semantics.
- #308 was rebuilt without #302 ancestry at
  `dc97b8c32a6e6172be438797b4b717b82731a192`. Its exact preview is green and
  the deterministic S3 moderation drill passed clear, nsfw, blocked,
  quarantine, shield/reveal, admin override, sweep recovery, failure/refusal,
  protected-field, and refund paths.
- The three deliberately unstarted multipart cancellation fixtures were
  permanently cleaned after explicit action-time approval. A preflight census
  proved they were the only rows eligible for the preview cleanup path. The
  signed-in AWS CloudShell identity aborted each exact MPU in
  `thingtime-develop`; follow-up `ListParts` returned `NoSuchUpload` and HEAD
  returned not-found for all three keys. The app's own transactional
  `attachmentStore.removeDeleting` primitive then removed only those three
  approved rows and applied the byte refunds. Independent verification found
  all three rows absent, both synthetic owners at `storageUsedBytes: 0`, and an
  empty cleanup-eligible queue. No IAM mutation was needed.
- After #320 and #325 entered develop, #308 was reconciled again onto exact
  develop head `58f6f2e8...` and pushed at `9efd62c99015ab8f0585034d807f4a4a12ab930a`.
  The only textual conflict was the changelog, where both security entries were
  preserved. Focused moderation/attachment/schema/index/migration tests, the
  complete unit suite, and the production Vercel build/output verifier pass;
  exact-head remote CI and the exact-SHA develop preview are green.
- #308 merged to `develop` as merge commit
  `14ee574541589797b9a85d93ddd675b5b00cbe05` after the full staging drill,
  exact-SHA CI/preview proof, AWS role-policy proof, and disposable-fixture
  cancellation/refund gate all passed.
- Live AWS inspection also proved the production role
  `thingtime-vercel-s3-production` has the same complete abort/list/object
  action set on `arn:aws:s3:::thingtime-prod/objects/*`; no production IAM
  mutation is required before moderation promotion.
- A local synthetic stack of current `develop` + #308 + #320 + #325 + #326 +
  #312 + #321 was reconciled manually. Attachment/media/moderation conflicts
  preserve owner annotations, server-owned detected types, NSFW shielding,
  and all route registrations. Validation: 124 attachment tests, 52
  moderation tests, 61 schema tests, the complete unit suite, 436/436 live API
  contracts with the QA environment, lint, and the production Vercel
  build/output verifier all pass. This scratch merge is evidence only and is
  not a release branch.
- #320 merged to `develop` as
  `266becc848427734ed05a90a43fe977d155a27b9`. #325 was reconciled onto that
  exact head, revalidated, pushed, and merged to `develop` as
  `58f6f2e8bf0455444548f276169dd9b290a99c12`; its exact develop deployment
  `dpl_53eNWi3pNudHYJcaXw5ykAQXJ3Pb` reached READY.
- The deployed preview database initially had 63 `things_v2` indexes, including
  eleven stale index definitions from explicitly excluded AI-connection,
  device/Commander, and external-connector preview branches. They prevented
  the registered backfill from acquiring its migration lease with MongoDB
  `CannotCreateIndex`. After confirming every exact name was absent from
  current develop, those eleven index definitions were dropped (zero
  documents deleted; recreatable from their owning feature branches), leaving
  safe headroom for the #325 ensure pass.
- Deployed preview relationship migration: dry-run matched 6; real run stamped
  5 chat-member + 1 community-member rows with 0 skipped; verification dry-run
  matched 0. Post-run census: all seven non-unique relationship lookup indexes
  plus sparse-unique `uniqueKeys_1` present, all eight obsolete unique index
  names absent, 0 pending relationships, 0 duplicate slots, and 0 root-key
  data census entries.
- Separately reachable home database migration: dry-run matched 3 vote rows;
  real run stamped all 3 with 0 skipped; verification dry-run matched 0.
  Post-run totals are 17 follows, 107 chat members, 27 community members, 17
  DMs, 7 invites, 9 custom emojis, 8 friends, and 3 votes, all stamped. The
  operator-only census retained (never modified) 2 data Things with followKey
  and one each with memberKey, dmKey, emojiKey, friendKey, and voteKey.
- #326 remains hard-gated: production still needs granular #320 then #325
  promotion, exact deployment/index convergence, and an idempotent production
  relationship backfill before the crystal reservation may be removed.
- Read-only production baseline before #320/#325: `things_v2` has 52 indexes
  (sufficient convergence headroom), all seven legacy
  kind-blind crystal-path unique indexes (plus the obsolete follow marker)
  remain, `uniqueKeys_1` is present, and there are 9 valid string-key
  relationship rows to stamp: 1 follow, 1 friend, 6 members, and 1 DM. There
  are 0 duplicate string-key groups. Three additional chat rows carry
  non-string/null `dmKey` values and are intentionally not stamp candidates.
  Operator census is 1 non-relationship `followKey` row and 1
  non-relationship `memberKey` row; neither was modified.
- Promotion #333 is the clean/green five-file #320-only main promotion and is
  intentionally held open until the moderation production gate clears.
  Dependent promotion #334 now exists for #325; it remains blocked behind #333
  as intended and must not merge before production #320. Its current unit-job
  failure is the deliberate stack dependency: the #325 relationship test sees
  `RESERVED_CRYSTAL_ROOT_KEYS` as undefined because main does not yet contain
  #320. API, CodeQL, GitGuardian, and Vercel pass; merging #333 first supplies
  the missing transition guard and should make #334's rebased diff/test green.
- Media promotion #311 and source PRs #312/#321 remain clean, green, and
  scoped. They are reviewed/prepared but intentionally unmerged so the stated
  moderation -> relationship -> media release order is preserved.
- Read-only production media baseline before #321: 6 ready attachments total
  (4 PNG images, 1 MP4 video, 1 opaque file). Exactly 1 legacy
  `application/octet-stream` row lacks `detectedContentType`; it has a valid
  object version and 43,735,886 object bytes, so the bounded backfill has one
  concrete production candidate. No existing detected-type rows are present.
- The first post-#308 develop Build-all run exposed two release-control defects:
  Claude's doctor action cannot execute under a push event, and its cleanup
  removed the trusted nested `control-plane/` checkout between rounds. Scoped
  control-plane PR #335 preserved that exact checkout and handed push events
  to a supported `workflow_dispatch` worker; it merged to `github-actions` as
  `2d51b8b296feafedbd83194809efff987dbfed77` after its deterministic checks,
  Web build/API checks, and secret scan passed.
- The required live push proof then caught a missing declaration before it
  could be mistaken for success: `all-branch.yml` had the handoff job but no
  `push` trigger, so GitHub launched no Build-all run. Follow-up PR #336 adds
  only that protected-branch trigger plus a blocking self-test covering the
  trigger/handoff/rebuild-event contract. It must merge and pass the actual
  push -> workflow-dispatch -> rebuild/doctor survival proof before this CI
  gate is closed.
- #336 merged to `github-actions` as
  `1ef95fabf19b127850b01dfe6c39aabe95f87cfc`; the protected-branch push now
  creates Build-all run `32443985127`, proving the missing event declaration is
  repaired. Its tiny handoff job is still queued behind shared GitHub runner
  saturation, so the subsequent workflow-dispatch worker/doctor survival half
  of the live proof remains open.
- Moderation promotion #337 was published at
  `76267907ad6817b7671187a277739fd2a53b2184`. The resolver's terminal failure
  was an HTTP 502 from PR creation after the branch publication; the regular
  PR and immutable review metadata exist. An independent manual reconstruction
  of the #308-only patch onto current main resolved the same eight paths. Every
  non-Graphify code file matches the automation byte-for-byte; only changelog
  placement/wrapping differs with identical moderation entries. The scoped
  tree excludes #311 ordering, #319 detected-container UI, #320/#325
  relationship code, and unrelated features. Validation passes: complete unit
  suite; moderation 52, attachments 110, messenger 3, schemas 53, collections
  16, migrations 19; production Vercel build/output verifier.
- #337 subsequently cleared fresh JavaScript/actions CodeQL, Web CI, API,
  GitGuardian, and Vercel gates and merged to `main` as
  `2bdfef6ca74c649d806a7301e1b3136218702c3d`. Exact production deployment
  `dpl_4sYoFGzDdcdVxHMFGVdPUXZGKDBt` is READY. Signed-in production smoke
  proved the moderation queue/settings endpoint, configured media/text
  providers, strict CSP with the exact S3 connect origin, and Nitro/frontend/
  MongoDB/Vercel health at the deployed SHA.
- #333 was refreshed onto current main, passed fresh Web/API/CodeQL/Vercel
  gates, and merged as `b766eba46bf3a32891603fa8b16a7439a474cd69`.
  Exact production deployment `dpl_AAeZhQFvmE7ko4TvGSmGS24TyJnK` is READY.
  Production POST probes for all seven names (`followKey`, `friendKey`,
  `memberKey`, `dmKey`, `inviteCode`, `emojiKey`, `voteKey`) returned the
  intended 400 reservation and persisted nothing, closing phase 4A.
- The main-to-develop sync failure in run `32446270419` was a false red:
  GitHub created #338, then its GraphQL `gh pr create` call returned HTTP 502.
  Scoped control-plane PR #339 replaced list/create with bounded REST retries
  and a post-error existence check. It merged to `github-actions` as
  `ed7db072ef5b3ba2452a5deeef4b70ae03da4fa9`; live dispatch run
  `32447394051` then detected the real conflict and successfully reused #338.
- #334 was manually reconciled with current main in merge commit
  `a00a9caaad2cef59937fa4c4ca6bb1cb6f02dc4d`. Outside refreshed Graphify
  artifacts its production diff is exactly eight #325 relationship-security
  files. Local complete unit/build and focused relationship/index/migration
  suites pass; the canonical remote Web build/unit and 432-test API jobs also
  pass. Vercel is READY and protected auto-merge is armed pending JavaScript
  CodeQL. Production pre-deploy census is 50 indexes, including all seven old
  kind-blind relationship uniques plus obsolete `things_follow_unique`, and
  sparse-unique `uniqueKeys_1`.
- #334 passed fresh Web/API/CodeQL/Vercel gates and merged to `main` as
  `792267598f648dd44695e558a63d57c0a94bfe20`. Exact production deployment
  `dpl_eFVs6kWBZDc3xaUowWyR4oQNs8nJ` is READY/PROMOTED and production health
  reports that exact SHA.
- Phase 4B production convergence is complete. An untruncated 52-index census
  proves all seven non-unique relationship lookup indexes plus unique sparse
  `uniqueKeys_1`, with every obsolete unique relationship index absent. The
  relationship backfill dry-run matched 9 rows; the real run stamped 1 follow,
  5 chat-member, 1 community-member, 1 DM chat, and 1 friend with 0 skipped;
  the verification dry-run matched 0. The operator census retained one data
  Thing with `followKey` and one with `memberKey`, without modification.
- With phase 4B proven, #326 was reconciled onto current `develop` and pushed
  at `3b3b53d96bf10b94194086adae1a018219468f3c`. Its non-Graphify delta remains
  exactly ten phase-2 files. Messenger 9, schema 53, migration 19, moderation
  52, and attachment 115 tests pass; the earlier full unit suite and production
  build also pass. Fresh protected checks are running before the source merge.
- #326 merged to `develop` as
  `a64f131596615846ef7facd0c5ef3e7b4c05d3ab` after the production phase-4B
  gate. Its exact-head Vercel deployment and GitGuardian checks passed.
- That merge push exposed a Build-all reusable-workflow startup failure:
  GitHub rejected the protected `handoff` job because it requested
  `actions: write` while the thin product-branch caller allowed `actions:
  none`. Scoped PR #341 added only the caller grant, a regression contract,
  the required changelog note, and refreshed Graphify artifacts; it merged to
  `develop` as `76b499e204fc0d10e0cbb7954de23fe490e3336a`.
- #341 live proof is complete: the next develop push Build-all caller run
  `32449323228` handed off successfully, and protected worker run
  `32449333049` completed the real all-branch rebuild, union build check,
  outcome record, and push with no doctor repair required.
- #341 remains develop-only. Its caller exists because excluded CI feature
  #314 added the `all`-branch listener to develop; `main` has no such listener.
  Promoting #341 would reintroduce #314 solely to carry its permission fix, so
  it is outside this release's narrow CI-dependency closure.
- Fresh granular phase-4C promotion #342 reconstructs only source #326 on
  production base `792267598f648dd44695e558a63d57c0a94bfe20`: ten human
  files plus regenerated Graphify outputs, with no develop-only features.
  Local messenger 9, migrations 19, schemas 53, attachments 110, moderation
  52, and production build/output verification pass. CodeQL and GitGuardian
  pass; protected auto-merge is armed while Web CI and exact-head Vercel wait
  in their shared service queues.
- #342 merged to `main` as `08746683ddc2396fb8afe08a1b9fb529c73ecccd`.
  Production coexistence probes proved ordinary root crystals can reuse exact
  relationship-key values beside real relationships while forged `uniqueKeys`
  remain rejected.
- #311 merged to `main` as `62bd8429712f761daea09bf4e6484883dffcfb8c`.
  #312, #319, and #321 merged to `develop`; their scoped promotion #344 merged
  to `main` as `ea6e8b9982fe6d69eac7cc4a4e2ae199471e0527`.
  Client transport fix #345 merged to `develop` as
  `1e9bab325941d75abb2e8472557598c54aef81dd`.
- Media launch proof covered upload, inline MP4, opaque ZIP/AVI labelling,
  keyboard/pointer reorder, Grid spans, reload/edit persistence, masonry,
  lightbox previous/next, media pages, annotations, comments/reactions, mobile
  390x844 containment, and deletion/refunds. Synthetic fixtures only were used
  and all disposable posts were deleted. Storage moved from 220,683,915 peak
  to 218,656,412 bytes after cleanup. Production legacy detected-type backfill
  changed 1 candidate, then converged to an idempotent zero-work dry run.
- Scoped reconciliation #346 merged to `develop` as
  `3f0c045d33e57e61bd5237bb00a566426d063e9f`; standing sync #343 was satisfied
  by its reviewed merge commit. `main` is now an ancestor of `develop` without
  importing the excluded develop-only product set into production.
- The release QA exposed a Vercel control-plane invariant: assigning the stable
  domain to the shared custom environment allowed a PR build to advance it,
  while branch pinning alone did not automatically advance native develop
  custom-environment builds. #347 merged to `github-actions` as
  `a8be000fc14049e1f536ae8d64b73cd5763cef0e`, keeping
  `dev.thingtime.com` branch-pinned with no custom-environment ownership. #348
  merged as `0e6b0d701a1240b385881fa5ba52e1f9d72b872b`, adding identity-fenced exact
  native-develop alias promotion and scheduled recovery. Live manual promotion
  to `dpl_DcBW8mVHcZi7wNhcD67UKAAFFd8R` preserved that domain binding.
- Docs-only #349 is the final live controller probe. Its first GraphQL create
  returned HTTP 502 after GitHub had already created the PR; the REST recheck
  found and reused #349, independently reproducing the #339 repair invariant.
  Its protected pre-merge controller run `32463594775` selected exact source
  SHA `4ecf39c68ea4a06b763e5c8fbc1248100ae18bfd`, kept the stable develop
  domain on `dpl_DcBW8mVHcZi7wNhcD67UKAAFFd8R`, published only
  `pr-349.previews.dev.thingtime.com`, and passed the develop-bucket CORS and
  final PR/SHA fences. Web build/typecheck/unit/API and Vercel checks passed.
- #349 merged to `develop` as
  `7761416c8ceb5ee26352a33c0f55eb98096a2053`. Post-merge controller run
  `32466305297` removed the PR alias, waited for native develop deployment
  `dpl_Erg9KLyHWnFmLTEzjBw3SCEXKY1h`, revalidated `ref=develop`, exact merge
  SHA, `prId=null`, and promoted `dev.thingtime.com` only after READY. The
  domain remains verified and branch-pinned (`gitBranch=develop`, no custom
  environment ownership); live HTML and CSP return 200 with the develop S3
  connect origin. The new develop head's Web build/typecheck/unit/API,
  all-branch caller, rebase, resolver, and promotion-control checks pass.
- Automated promotion #350 was closed as superseded. It contained no unique
  runtime code: only stale/conflicted changelog replay plus generated Graphify
  churn, including duplicate and explicitly deferred iOS/all-branch notes.
  The scoped production media runtime remains #344 at main
  `ea6e8b9982fe6d69eac7cc4a4e2ae199471e0527`; production deployment
  `dpl_6NvD7HRDQ4aZQYF98YUecpWu7b6o` is READY, serves HTTP 200, and retains
  the exact production S3 CSP origin.

## Explicitly excluded

#291, #295, #315, #323 (including folded #327), #263, Components, Action
Things, Connections, polls/Explore/saves/memories/hashtags, theme gallery/worn
themes, shareable/growing algorithms, Commander desktop, Circles, branding,
generic delight, unrelated tooling/performance, geo-distribution, and new
social/feed experiments.
