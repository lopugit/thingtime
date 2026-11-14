# Graph Report - thingtime  (2026-11-14)

## Corpus Check
- 123 files · ~302,191 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 4, .jq 1)

## Summary
- 1560 nodes · 3892 edges · 76 communities (68 shown, 8 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 53 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `15497e8b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- promote-features-to-main.mjs
- deploy-admin-pr-previews.mjs
- deploy-vercel-prebuilt.mjs
- graphify-cas.mjs
- NativeCompileBoundaryTests
- preview-maintenance.test.mjs
- lopu-cooperative-review.mjs
- promotion-pr-changelog.mjs
- deploy-develop-pr-preview.mjs
- preview-fallback.mjs
- build-all-branch.mjs
- runSelfTest
- lopu-model-waterfall.mjs
- orphan-preview-cleanup.mjs
- ref_node_assert
- resolve-pr-conflicts-routing-contract.mjs
- reconcile
- lopu-pr-status.mjs
- workflow-control-plane-contract.mjs
- extract-vercel-prebuilt.py
- Control-plane changelog
- refresh-promotion-graphify.sh
- native-compile-ci.py
- codeql-open-pr-backfill.mjs
- deploy
- ref_node_os
- lopu-pr-lifecycle.test.mjs
- preview-environment-refresh.test.mjs
- `github-actions` — the CI control plane
- deploymentIdentityIssue
- merge-main-develop-sync-pr.mjs
- promotion-worker-contract.sh
- Control-plane regression checklist
- feature-stack-waterfall.test.mjs
- supervise
- ref_node_child_process
- rebase-related-edits.test.mjs
- prepare-round.sh
- promotion-worker.sh
- CHANGELOG.md
- promotion-worker-routing-contract.mjs
- Thingtime AI instructions
- Thingtime AI instructions
- control-plane-events.test.mjs
- stage-graphify-snapshots.mjs
- Prebuilt-only deployments (2026-10-23)
- codeql-polling.test.mjs
- cleanup
- Protected unsigned native compilation
- codeql-upload-recovery.test.mjs
- codeql-quota-diagnostics.test.mjs
- start.sh
- classify-claude-credential-failure.mjs
- verify-promotion-source-authority.sh
- PR #1294 — Remove orphan Vercel previews and reject pre-gateway source
- PR #609 — Restore Lopu and preview admission
- preview-publication-timing.mjs
- PR #506 — Auto-merge resolved main to develop sync PR
- PR #603 — Admin preview publisher controller
- PR #637: Safe cooperative handover for Lopu reviews
- PR #643 — Missing-build page for unassigned PR preview URLs
- Prebuilt-only Vercel deployments
- vercel.json
- preview-pr-summary.test.mjs
- PR #492 — Load Lopu credentials from the Thingtime vault
- PR #534 — Feature Stack progress heartbeat controller
- PR #642: Discoverable preview status and missed-build repair
- [Unreleased]
- previewRetirementRequest
- rebase-ownership-routing-contract.sh
- resolve-canonical-instruction-type-conflicts.sh
- PR 1499: Protected deployment checks and reviewed preview retirement
- 1225-codex-gateway-publisher-policy-publish-controlled-environment-gateway-owners.md
- 781-codex-stack-progress-chat-controller-answer-feature-stack-status-questions.md
- codex-gateway-alias-propagation-standard-preview-target.md

## God Nodes (most connected - your core abstractions)
1. `runPromotion()` - 64 edges
2. `runSelfTest()` - 54 edges
3. `selfTest()` - 53 edges
4. `NativeCompileBoundaryTests` - 48 edges
5. `reconcile()` - 40 edges
6. `deploy()` - 37 edges
7. `prepareBuildPlan()` - 29 edges
8. `main()` - 29 edges
9. `publish()` - 28 edges
10. `failureDetail()` - 28 edges

## Surprising Connections (you probably didn't know these)
- `classify()` --calls--> `classifyClaudeCredentialFailure()`  [EXTRACTED]
  .github/scripts/lopu-model-waterfall.mjs → .github/scripts/classify-claude-credential-failure.mjs
- `publishAdminStatus()` --calls--> `publishPreviewNotifications()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/preview-comments.mjs
- `publishAdminStatus()` --calls--> `syncPreviewLabels()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/preview-labels.mjs
- `retentionSweep()` --calls--> `reconcileOrphanPreviews()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/orphan-preview-cleanup.mjs
- `deployPrebuiltOutput()` --calls--> `assertPreviewGatewaySource()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/preview-gateway-source.mjs

## Import Cycles
- None detected.

## Communities (76 total, 8 thin omitted)

### Community 0 - "promote-features-to-main.mjs"
Cohesion: 0.05
Nodes (130): applyPicks(), attestationMatches(), botCommentsByLatestEvent(), buildPromotionDispatchRequest(), buildPromotionPlanContext(), cancelPromotionRetirement(), CFG, checkoutRemoteBranch() (+122 more)

### Community 1 - "deploy-admin-pr-previews.mjs"
Cohesion: 0.06
Nodes (73): ACTIVE_STATES, assertCurrentPullRequest(), assertPrebuiltOutput(), assignAlias(), boundedInteger(), cleanupDeploymentIssue(), cleanupEnvironment(), commentBody() (+65 more)

### Community 2 - "deploy-vercel-prebuilt.mjs"
Cohesion: 0.07
Nodes (66): applyOutputPolicy(), visit(), assertGatewaySource(), assertPreviewOpen(), compatibilityAliasCandidates(), context(), deploymentArgs(), deploymentIssue() (+58 more)

### Community 3 - "graphify-cas.mjs"
Cohesion: 0.09
Nodes (60): activateSnapshot(), artifactHash(), baselineNodeCount(), compareSnapshotQuality(), computeSourceFingerprint(), copyPortableFiles(), DEFAULT_SNAPSHOT_RETENTION, dropNestedRepositories() (+52 more)

### Community 5 - "preview-maintenance.test.mjs"
Cohesion: 0.11
Nodes (38): assertPreviewGatewaySource(), code(), gatewaySourceIssue(), gatewaySourcePaths, leasedSources(), sources(), ancestor(), assertMaintenanceIncumbent() (+30 more)

### Community 6 - "lopu-cooperative-review.mjs"
Cohesion: 0.09
Nodes (31): checkpoint(), completedReport(), continuationNumbers(), finalize(), git(), HANDOVER_INSTRUCTIONS, initialize(), numbers() (+23 more)

### Community 7 - "promotion-pr-changelog.mjs"
Cohesion: 0.13
Nodes (38): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+30 more)

### Community 8 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.08
Nodes (33): ACTIVE_STATES, assertPrebuiltOutput(), assertWildcardFallbackRuntimes(), CLEANUP_ACTIONS, developRefSha(), execFileAsync, expectedReadyAt(), expectedReadyForRun() (+25 more)

### Community 9 - "preview-fallback.mjs"
Cohesion: 0.09
Nodes (26): abortable(), createGithubMaintenanceRead(), endpointClass(), failure(), integer(), providerFailure(), fixture(), FALLBACK_BRANCH (+18 more)

### Community 10 - "build-all-branch.mjs"
Cohesion: 0.16
Nodes (36): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), completeRefspecs, countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode() (+28 more)

### Community 11 - "runSelfTest"
Cohesion: 0.10
Nodes (37): assertCustomDevelopEnvironment(), assertPreviewMaster(), assertTrustedPullRequest(), assertVercelConfiguration(), choosePreferredDeployment(), chooseStableDevelopDeployment(), classifyPullRequest(), createVercelDeployment() (+29 more)

### Community 12 - "lopu-model-waterfall.mjs"
Cohesion: 0.15
Nodes (31): models, exportBundle(), fetchBundle(), legacyCredentials(), main(), required(), safeCache(), validate() (+23 more)

### Community 13 - "orphan-preview-cleanup.mjs"
Cohesion: 0.15
Nodes (26): ACTIVE, assertPreviewHasOpenPullRequest(), completeInventory(), deploymentLane(), idOf(), missing(), openBranchPullRequests(), previewIdentity() (+18 more)

### Community 14 - "ref_node_assert"
Cohesion: 0.10
Nodes (15): allowed, workflow, assertPrReleaseContract(), count(), here, workflow, allowed(), evaluate (+7 more)

### Community 15 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.13
Nodes (26): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertCapturedStdoutStaysClean(), assertRoute(), assertWorkflowSource(), CALLS_HELPER(), decodeBatch() (+18 more)

### Community 16 - "reconcile"
Cohesion: 0.18
Nodes (26): assertCurrentPullRequest(), assertPreviewBundle(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequestStack(), boundedInteger(), dispatchPullRequestIssue(), EligibilityError (+18 more)

### Community 17 - "lopu-pr-status.mjs"
Cohesion: 0.17
Nodes (25): argument(), branchCode(), classifyInventory(), count(), dateParts(), desiredFactLabels(), escapeHtml(), FACT_LABEL_ORDER (+17 more)

### Community 18 - "workflow-control-plane-contract.mjs"
Cohesion: 0.13
Nodes (26): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertAdminWaterfallGrammar(), assertBareControlPlaneTree() (+18 more)

### Community 19 - "extract-vercel-prebuilt.py"
Cohesion: 0.14
Nodes (5): extract_archive(), main(), _member_path(), self_test(), _validate_link()

### Community 20 - "Control-plane changelog"
Cohesion: 0.08
Nodes (26): 2026-09-05 — Cooperative review handover and preview recovery, 2026-09-05 — Desktop and Recovery cloud release repair, 2026-09-05 — Signed Commander releases and Recovery pairing, 2026-09-05 — Visible previews and conflict detector recovery, 2026-10-18 — Correct reusable workflow context, 2026-10-18 — Diagnose OpenAI preflight failures safely, 2026-10-18 — Execute the saved admin AI waterfall, 2026-10-23 — Build every Vercel deployment on GitHub Actions (+18 more)

### Community 21 - "refresh-promotion-graphify.sh"
Cohesion: 0.14
Nodes (24): assert_control_metadata_unchanged(), assert_tool_boundary(), current_grafts_state(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT (+16 more)

### Community 22 - "native-compile-ci.py"
Cohesion: 0.12
Nodes (11): acquire_cleanup_lock(), arm_native(), drop_identity(), extract_candidate(), kernel_groups(), main(), native_deadline(), preflight_failure() (+3 more)

### Community 23 - "codeql-open-pr-backfill.mjs"
Cohesion: 0.21
Nodes (23): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), analysisSnapshotForPullRequest(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp() (+15 more)

### Community 24 - "deploy"
Cohesion: 0.19
Nodes (24): cleanupClosedPrResources(), cleanupComment(), cleanupDeployments(), cleanupPrResources(), createGithubDeployment(), dashboardUrl(), deploy(), deploymentComment() (+16 more)

### Community 25 - "ref_node_os"
Cohesion: 0.16
Nodes (17): answerCommand(), answerQuestion(), CHAT_SYSTEM_PROMPT, safeRunContext(), serveRunChat(), githubJobs(), githubStackPullRequests(), postProgress() (+9 more)

### Community 26 - "lopu-pr-lifecycle.test.mjs"
Cohesion: 0.18
Nodes (17): approved(), eligible(), identity(), managed(), pauses, redundant(), selectPulls(), settle() (+9 more)

### Community 27 - "preview-environment-refresh.test.mjs"
Cohesion: 0.21
Nodes (17): executeRefreshPublisher(), fail(), reconcilePublicationRetention(), refreshAutomationCredential(), refreshRequest(), refreshRetentionCanBeSkipped(), binding(), config (+9 more)

### Community 28 - "`github-actions` — the CI control plane"
Cohesion: 0.11
Nodes (19): Commander signed releases, Desktop and Recovery release pipeline, Discoverable preview status and recovery, Environment gateways for future product builds, Fork setup: Vercel develop previews, `github-actions` — the CI control plane, Known trade-off, Lopu principal repository manager (+11 more)

### Community 29 - "deploymentIdentityIssue"
Cohesion: 0.21
Nodes (18): admitMaintenanceRecovery(), assertNoProtectedAlias(), assignAliasVerified(), deploymentDetail(), deploymentIdentityIssue(), deploymentListParams(), deploymentUrl(), getAliasBinding() (+10 more)

### Community 30 - "merge-main-develop-sync-pr.mjs"
Cohesion: 0.22
Nodes (15): assertHeadContainsMain(), assertSyncPullRequestShape(), exactSha(), EXPECTED_MERGE_REJECTIONS, githubRequest(), GitHubRequestError, headContainsMain(), mergeStandingSyncPullRequest() (+7 more)

### Community 31 - "promotion-worker-contract.sh"
Cohesion: 0.14
Nodes (17): BASE_REF, BASE_SHA, compute_plan_hash(), GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay() (+9 more)

### Community 32 - "Control-plane regression checklist"
Cohesion: 0.11
Nodes (18): CodeQL quota diagnostics (2026-11-14), Configured cross-provider waterfall, Control-plane regression checklist, Cooperative review handover, Durable CodeQL SARIF upload (2026-11-14), Event feedback and CI cancellation, Exact configured workflow model orders, Explicit stack model and endpoint waterfall (+10 more)

### Community 33 - "feature-stack-waterfall.test.mjs"
Cohesion: 0.32
Nodes (14): canonicalFeatureStackPlan(), decodeFeatureStackPlan(), exactKeys(), featureStackId(), git(), selfTest(), validateWaterfall(), verifyFeatureStackHistory() (+6 more)

### Community 34 - "supervise"
Cohesion: 0.17
Nodes (14): admit_runner(), build_environment(), firewall_rules(), phase(), require_hosted_runner(), run(), supervise(), as_build() (+6 more)

### Community 35 - "ref_node_child_process"
Cohesion: 0.22
Nodes (10): checkDisposition(), publishMerge(), baseSha, fixture(), head, success, rawIndexHash(), runGit() (+2 more)

### Community 36 - "rebase-related-edits.test.mjs"
Cohesion: 0.28
Nodes (14): actionPath, copyTrustedTree(), extractVerifierScript(), filesUnder(), hashNamedFiles(), hashRebaseState(), hashTrustedTree(), makeStoppedRebase() (+6 more)

### Community 37 - "prepare-round.sh"
Cohesion: 0.28
Nodes (14): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_index_entries(), hash_rebase_state(), rebase_in_progress() (+6 more)

### Community 38 - "promotion-worker.sh"
Cohesion: 0.37
Nodes (13): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+5 more)

### Community 39 - "CHANGELOG.md"
Cohesion: 0.14
Nodes (10): 2026-11-14 — Align retained artifact download authority, 2026-11-14 — Bound refresh receipt compatibility and retention work, 2026-11-14 — Fresh preview runtime environment publication, PR 1017: GitHub Lopu admin model waterfall, Behavior, Evidence and scope, PR #634: Lopu comment admission and idempotent preview writes, Rollout (+2 more)

### Community 40 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.14
Nodes (13): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, featureStackMergeIf, featureStackMergeJob, graphify, lopuAgent (+5 more)

### Community 41 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 42 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 43 - "control-plane-events.test.mjs"
Cohesion: 0.24
Nodes (5): ci, workflow, classifyConversation(), classifyQueuedConversation(), hasAutomationMarker()

### Community 44 - "stage-graphify-snapshots.mjs"
Cohesion: 0.36
Nodes (11): addExisting(), filesUnder(), git(), LEGACY_ROOT, missingFromWorktree(), PORTABLE, removeFromIndex(), restoreTrackedFromHead() (+3 more)

### Community 45 - "Prebuilt-only deployments (2026-10-23)"
Cohesion: 0.17
Nodes (12): Environment gateway publication, Existing workflow preflight verification, Maintenance provenance HTTP reads, Native control continuity and bounded bootstrap, Passive preview publication stage timing, Prebuilt artifact acceptance, Prebuilt-only deployments (2026-10-23), Preview receipt runner context (2026-10-26) (+4 more)

### Community 46 - "codeql-polling.test.mjs"
Cohesion: 0.24
Nodes (7): analysis(), defaultJobs, execute(), iso(), sha, shellStep(), workflow

### Community 47 - "cleanup"
Cohesion: 0.22
Nodes (7): cleanup(), command(), detach_watchdog_io(), process_inventory(), publish_watchdog_evidence(), record_remaining(), start_watchdog()

### Community 48 - "Protected unsigned native compilation"
Cohesion: 0.25
Nodes (6): Admission and entry point, Darwin credential verification and trusted failures, Enforced network policy and cleanup, Protected unsigned native compilation, Trust boundary, Validation and acceptance

### Community 49 - "codeql-upload-recovery.test.mjs"
Cohesion: 0.22
Nodes (5): helper, observedBuiltinTokenQuota, program, sha, workflow

### Community 50 - "codeql-quota-diagnostics.test.mjs"
Cohesion: 0.32
Nodes (7): execute(), names, sample, shell(), step(), unknown, workflow

### Community 51 - "start.sh"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 52 - "classify-claude-credential-failure.mjs"
Cohesion: 0.48
Nodes (6): CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest()

### Community 53 - "verify-promotion-source-authority.sh"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 54 - "PR #1294 — Remove orphan Vercel previews and reject pre-gateway source"
Cohesion: 0.29
Nodes (6): Activation and remaining acceptance, Delivered controller behavior, Parent-reported one-time operational cleanup, PR #1294 — Remove orphan Vercel previews and reject pre-gateway source, Saved retention policy, Verification and evidence boundaries

### Community 55 - "PR #609 — Restore Lopu and preview admission"
Cohesion: 0.29
Nodes (6): Follow-up acceptance repair, Live diagnosis, Outcome, PR #609 — Restore Lopu and preview admission, Security boundary, Validation

### Community 57 - "PR #506 — Auto-merge resolved main to develop sync PR"
Cohesion: 0.33
Nodes (5): Operational proof gate, PR #506 — Auto-merge resolved main to develop sync PR, Problem, Resolution, Validation

### Community 58 - "PR #603 — Admin preview publisher controller"
Cohesion: 0.33
Nodes (5): Compatibility fix, Outcome, PR #603 — Admin preview publisher controller, Security boundary, Validation

### Community 59 - "PR #637: Safe cooperative handover for Lopu reviews"
Cohesion: 0.33
Nodes (5): PR #611 recovery, PR #637: Safe cooperative handover for Lopu reviews, Protocol, Scope and evidence, Validation

### Community 60 - "PR #643 — Missing-build page for unassigned PR preview URLs"
Cohesion: 0.33
Nodes (5): Cause and scope, PR #643 — Missing-build page for unassigned PR preview URLs, Protected rollout, Root response decision, Verification before merge

### Community 61 - "Prebuilt-only Vercel deployments"
Cohesion: 0.33
Nodes (6): Clean native release test prerequisites, Prebuilt-only Vercel deployments, Preview publication diagnostics — 14 November 2026, Refresh a retained preview runtime environment, Reviewed retained-source preview maintenance, Verified PR alias promotion

### Community 62 - "vercel.json"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 64 - "PR #492 — Load Lopu credentials from the Thingtime vault"
Cohesion: 0.40
Nodes (4): PR #492 — Load Lopu credentials from the Thingtime vault, Safety and regression focus, Scope, Validation log

### Community 65 - "PR #534 — Feature Stack progress heartbeat controller"
Cohesion: 0.40
Nodes (4): Outcome, PR #534 — Feature Stack progress heartbeat controller, Safety and cost, Validation

### Community 66 - "PR #642: Discoverable preview status and missed-build repair"
Cohesion: 0.40
Nodes (4): Changes, Evidence and cause, PR #642: Discoverable preview status and missed-build repair, Validation and rollout

### Community 67 - "[Unreleased]"
Cohesion: 0.50
Nodes (4): Added, Changed, Fixed, [Unreleased]

### Community 69 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 70 - "resolve-canonical-instruction-type-conflicts.sh"
Cohesion: 0.83
Nodes (3): resolve-canonical-instruction-type-conflicts.sh script, stage_record(), tree_record()

### Community 71 - "PR 1499: Protected deployment checks and reviewed preview retirement"
Cohesion: 0.50
Nodes (3): PR 1499: Protected deployment checks and reviewed preview retirement, Result, Verification and limits

## Knowledge Gaps
- **28 isolated node(s):** `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR`, `BASE_REF`, `BASE_SHA` (+23 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 470 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `selfTest()` connect `promote-features-to-main.mjs` to `ref_node_assert`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR` to the rest of the system?**
  _28 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `promote-features-to-main.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05194805194805195 - nodes in this community are weakly interconnected._
- **Why does `NativeCompileBoundaryTests` connect `NativeCompileBoundaryTests` to `extract-vercel-prebuilt.py`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Should `deploy-admin-pr-previews.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.06234567901234568 - nodes in this community are weakly interconnected._
- **Why does `Control-plane changelog` connect `Control-plane changelog` to `[Unreleased]`, `CHANGELOG.md`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Should `deploy-vercel-prebuilt.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.07205452775073028 - nodes in this community are weakly interconnected._