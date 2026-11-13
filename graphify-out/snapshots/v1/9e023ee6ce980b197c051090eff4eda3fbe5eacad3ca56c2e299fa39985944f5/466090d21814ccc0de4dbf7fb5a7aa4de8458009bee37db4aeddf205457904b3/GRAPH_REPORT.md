# Graph Report - thingtime  (2026-11-14)

## Corpus Check
- 119 files · ~298,606 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 4, .jq 1)

## Summary
- 1527 nodes · 3791 edges · 78 communities (73 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 51 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a0fd97fd`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- promote-features-to-main.mjs
- deploy-admin-pr-previews.mjs
- graphify-cas.mjs
- preview-maintenance.test.mjs
- NativeCompileBoundaryTests
- deploy-vercel-prebuilt.mjs
- lopu-model-waterfall.mjs
- preview-fallback.mjs
- promotion-pr-changelog.mjs
- build-all-branch.mjs
- deploy-develop-pr-preview.mjs
- orphan-preview-cleanup.mjs
- lopu-cooperative-review.mjs
- resolve-pr-conflicts-routing-contract.mjs
- ref_node_fs
- lopu-pr-status.mjs
- workflow-control-plane-contract.mjs
- extract-vercel-prebuilt.py
- Control-plane changelog
- refresh-promotion-graphify.sh
- native-compile-ci.py
- codeql-open-pr-backfill.mjs
- reconcile
- main
- runSelfTest
- ref_node_os
- ref_node_assert
- storage-release-gate.mjs
- lopu-pr-lifecycle.test.mjs
- deploy
- merge-main-develop-sync-pr.mjs
- promotion-worker-contract.sh
- Control-plane regression checklist
- feature-stack-waterfall.test.mjs
- supervise
- vercelRequest
- rebase-related-edits.test.mjs
- prepare-round.sh
- promotion-worker.sh
- lopu-review-queue.test.mjs
- promotion-worker-routing-contract.mjs
- `github-actions` — the CI control plane
- Thingtime AI instructions
- Thingtime AI instructions
- stage-graphify-snapshots.mjs
- CHANGELOG.md
- Prebuilt-only deployments (2026-10-23)
- codeql-polling.test.mjs
- ref_node_child_process
- cleanup
- codeql-upload-recovery.test.mjs
- codeql-quota-diagnostics.test.mjs
- preview-recovery.test.mjs
- start.sh
- README.md
- verify-promotion-source-authority.sh
- PR #1294 — Remove orphan Vercel previews and reject pre-gateway source
- PR #609 — Restore Lopu and preview admission
- Protected unsigned native compilation
- electron-release-gates.test.mjs
- PR #506 — Auto-merge resolved main to develop sync PR
- PR #603 — Admin preview publisher controller
- PR #637: Safe cooperative handover for Lopu reviews
- PR #643 — Missing-build page for unassigned PR preview URLs
- vercel.json
- rebase-index-fingerprint.test.mjs
- PR #492 — Load Lopu credentials from the Thingtime vault
- PR #534 — Feature Stack progress heartbeat controller
- PR #642: Discoverable preview status and missed-build repair
- Working on it
- [Unreleased]
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
6. `deploy()` - 34 edges
7. `publish()` - 28 edges
8. `failureDetail()` - 28 edges
9. `Control-plane changelog` - 26 edges
10. `githubRequest()` - 25 edges

## Surprising Connections (you probably didn't know these)
- `deployPrebuiltOutput()` --calls--> `execute`  [EXTRACTED]
  .github/scripts/deploy-develop-pr-preview.mjs → .github/scripts/preview-maintenance.mjs
- `publishAdminStatus()` --calls--> `syncPreviewLabels()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/preview-labels.mjs
- `retentionSweep()` --calls--> `reconcileOrphanPreviews()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/orphan-preview-cleanup.mjs
- `deployPrebuiltOutput()` --calls--> `assertPreviewGatewaySource()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/preview-gateway-source.mjs
- `assertCurrentPullRequest()` --calls--> `pullRequestIsLive()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/preview-retention-policy.mjs

## Import Cycles
- None detected.

## Communities (78 total, 5 thin omitted)

### Community 0 - "promote-features-to-main.mjs"
Cohesion: 0.05
Nodes (130): applyPicks(), attestationMatches(), botCommentsByLatestEvent(), buildPromotionDispatchRequest(), buildPromotionPlanContext(), cancelPromotionRetirement(), CFG, checkoutRemoteBranch() (+122 more)

### Community 1 - "deploy-admin-pr-previews.mjs"
Cohesion: 0.08
Nodes (63): ACTIVE_STATES, assertCurrentPullRequest(), assertPrebuiltOutput(), assignAlias(), boundedInteger(), cleanupDeploymentIssue(), cleanupEnvironment(), commentBody() (+55 more)

### Community 2 - "graphify-cas.mjs"
Cohesion: 0.09
Nodes (60): activateSnapshot(), artifactHash(), baselineNodeCount(), compareSnapshotQuality(), computeSourceFingerprint(), copyPortableFiles(), DEFAULT_SNAPSHOT_RETENTION, dropNestedRepositories() (+52 more)

### Community 3 - "preview-maintenance.test.mjs"
Cohesion: 0.08
Nodes (46): abortable(), createGithubMaintenanceRead(), endpointClass(), failure(), integer(), providerFailure(), fixture(), assertPreviewGatewaySource() (+38 more)

### Community 5 - "deploy-vercel-prebuilt.mjs"
Cohesion: 0.11
Nodes (44): applyOutputPolicy(), visit(), assertGatewaySource(), assertPreviewOpen(), compatibilityAliasCandidates(), context(), deploymentArgs(), deploymentIssue() (+36 more)

### Community 6 - "lopu-model-waterfall.mjs"
Cohesion: 0.12
Nodes (36): models, CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest(), exportBundle() (+28 more)

### Community 7 - "preview-fallback.mjs"
Cohesion: 0.09
Nodes (30): FALLBACK_BRANCH, FALLBACK_HEADER, FALLBACK_MARKER, fallbackDeploymentIssue(), fallbackDomainIssue(), fallbackPage(), fallbackResponseIssue(), installFallbackAliases() (+22 more)

### Community 8 - "promotion-pr-changelog.mjs"
Cohesion: 0.13
Nodes (38): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+30 more)

### Community 9 - "build-all-branch.mjs"
Cohesion: 0.16
Nodes (36): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), completeRefspecs, countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode() (+28 more)

### Community 10 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.09
Nodes (34): ACTIVE_STATES, assertCustomDevelopEnvironment(), assertPrebuiltOutput(), assertPreviewMaster(), assertVercelConfiguration(), assertWildcardFallbackRuntimes(), CLEANUP_ACTIONS, customEnvironmentDomainNames() (+26 more)

### Community 11 - "orphan-preview-cleanup.mjs"
Cohesion: 0.15
Nodes (27): ACTIVE, assertPreviewHasOpenPullRequest(), completeInventory(), deploymentLane(), idOf(), missing(), openBranchPullRequests(), previewIdentity() (+19 more)

### Community 12 - "lopu-cooperative-review.mjs"
Cohesion: 0.16
Nodes (22): checkpoint(), completedReport(), continuationNumbers(), finalize(), git(), HANDOVER_INSTRUCTIONS, initialize(), numbers() (+14 more)

### Community 13 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.13
Nodes (26): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertCapturedStdoutStaysClean(), assertRoute(), assertWorkflowSource(), CALLS_HELPER(), decodeBatch() (+18 more)

### Community 14 - "ref_node_fs"
Cohesion: 0.11
Nodes (12): ci, workflow, assertPrReleaseContract(), count(), here, workflow, classifyConversation(), classifyQueuedConversation() (+4 more)

### Community 15 - "lopu-pr-status.mjs"
Cohesion: 0.17
Nodes (25): argument(), branchCode(), classifyInventory(), count(), dateParts(), desiredFactLabels(), escapeHtml(), FACT_LABEL_ORDER (+17 more)

### Community 16 - "workflow-control-plane-contract.mjs"
Cohesion: 0.13
Nodes (26): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertAdminWaterfallGrammar(), assertBareControlPlaneTree() (+18 more)

### Community 17 - "extract-vercel-prebuilt.py"
Cohesion: 0.14
Nodes (5): extract_archive(), main(), _member_path(), self_test(), _validate_link()

### Community 18 - "Control-plane changelog"
Cohesion: 0.08
Nodes (25): 2026-09-05 — Cooperative review handover and preview recovery, 2026-09-05 — Desktop and Recovery cloud release repair, 2026-09-05 — Signed Commander releases and Recovery pairing, 2026-09-05 — Visible previews and conflict detector recovery, 2026-10-18 — Correct reusable workflow context, 2026-10-18 — Diagnose OpenAI preflight failures safely, 2026-10-18 — Execute the saved admin AI waterfall, 2026-10-23 — Build every Vercel deployment on GitHub Actions (+17 more)

### Community 19 - "refresh-promotion-graphify.sh"
Cohesion: 0.14
Nodes (24): assert_control_metadata_unchanged(), assert_tool_boundary(), current_grafts_state(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT (+16 more)

### Community 20 - "native-compile-ci.py"
Cohesion: 0.12
Nodes (11): acquire_cleanup_lock(), arm_native(), drop_identity(), extract_candidate(), kernel_groups(), main(), native_deadline(), preflight_failure() (+3 more)

### Community 21 - "codeql-open-pr-backfill.mjs"
Cohesion: 0.21
Nodes (23): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), analysisSnapshotForPullRequest(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp() (+15 more)

### Community 22 - "reconcile"
Cohesion: 0.18
Nodes (24): assertCurrentPullRequest(), boundedInteger(), cleanupClosedPrResources(), cleanupComment(), cleanupPrResources(), createGithubDeployment(), deploymentComment(), findGithubDeployment() (+16 more)

### Community 23 - "main"
Cohesion: 0.16
Nodes (23): assertPreviewBundle(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), classifyPullRequest(), dispatchPullRequestIssue(), EligibilityError (+15 more)

### Community 24 - "runSelfTest"
Cohesion: 0.17
Nodes (23): choosePreferredDeployment(), chooseStableDevelopDeployment(), deploymentMetadata(), deployPrebuiltOutput(), guardPreviewUpload(), isManagedPreviewComment(), prebuiltDeploymentArgs(), prebuiltUploadEnvironment() (+15 more)

### Community 25 - "ref_node_os"
Cohesion: 0.16
Nodes (17): answerCommand(), answerQuestion(), CHAT_SYSTEM_PROMPT, safeRunContext(), serveRunChat(), githubJobs(), githubStackPullRequests(), postProgress() (+9 more)

### Community 26 - "ref_node_assert"
Cohesion: 0.13
Nodes (6): allowed, workflow, postPublishRefRace(), snapshot, previewSummaryBody(), publishPreviewSummary()

### Community 27 - "storage-release-gate.mjs"
Cohesion: 0.24
Nodes (19): checkRuntimeLogs(), checkStorageManifest(), checkStorageReadiness(), exec, failure(), logLimit, monitor(), productionOrigin (+11 more)

### Community 28 - "lopu-pr-lifecycle.test.mjs"
Cohesion: 0.18
Nodes (17): approved(), eligible(), identity(), managed(), pauses, redundant(), selectPulls(), settle() (+9 more)

### Community 29 - "deploy"
Cohesion: 0.25
Nodes (18): admitMaintenanceRecovery(), assertNoProtectedAlias(), assignAliasVerified(), createVercelDeployment(), dashboardUrl(), deploy(), deploymentDetail(), deploymentIdentityIssue() (+10 more)

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

### Community 35 - "vercelRequest"
Cohesion: 0.15
Nodes (12): cleanupDeployments(), deploymentListParams(), HttpError, isRetryableHttpResponse(), listDeploymentSummaries(), listStableDevelopDeployments(), parseErrorCode(), requestJson() (+4 more)

### Community 36 - "rebase-related-edits.test.mjs"
Cohesion: 0.28
Nodes (14): actionPath, copyTrustedTree(), extractVerifierScript(), filesUnder(), hashNamedFiles(), hashRebaseState(), hashTrustedTree(), makeStoppedRebase() (+6 more)

### Community 37 - "prepare-round.sh"
Cohesion: 0.28
Nodes (14): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_index_entries(), hash_rebase_state(), rebase_in_progress() (+6 more)

### Community 38 - "promotion-worker.sh"
Cohesion: 0.37
Nodes (13): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+5 more)

### Community 39 - "lopu-review-queue.test.mjs"
Cohesion: 0.20
Nodes (9): backoff, findPendingReview(), pending, readGitHub(), retryableStatus, reviewScope(), fixture(), run (+1 more)

### Community 40 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.14
Nodes (13): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, featureStackMergeIf, featureStackMergeJob, graphify, lopuAgent (+5 more)

### Community 41 - "`github-actions` — the CI control plane"
Cohesion: 0.14
Nodes (14): Commander signed releases, Desktop and Recovery release pipeline, Environment gateways for future product builds, Fork setup: Vercel develop previews, `github-actions` — the CI control plane, Known trade-off, Lopu principal repository manager, macOS signing and build identity (+6 more)

### Community 42 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 43 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 44 - "stage-graphify-snapshots.mjs"
Cohesion: 0.36
Nodes (11): addExisting(), filesUnder(), git(), LEGACY_ROOT, missingFromWorktree(), PORTABLE, removeFromIndex(), restoreTrackedFromHead() (+3 more)

### Community 45 - "CHANGELOG.md"
Cohesion: 0.18
Nodes (7): PR 1017: GitHub Lopu admin model waterfall, Behavior, Evidence and scope, PR #634: Lopu comment admission and idempotent preview writes, Rollout, Validation, PR #661: conflict scans and visible previews

### Community 46 - "Prebuilt-only deployments (2026-10-23)"
Cohesion: 0.18
Nodes (11): Environment gateway publication, Existing workflow preflight verification, Maintenance provenance HTTP reads, Native control continuity and bounded bootstrap, Prebuilt artifact acceptance, Prebuilt-only deployments (2026-10-23), Preview receipt runner context (2026-10-26), Protected native compilation (+3 more)

### Community 47 - "codeql-polling.test.mjs"
Cohesion: 0.24
Nodes (7): analysis(), defaultJobs, execute(), iso(), sha, shellStep(), workflow

### Community 48 - "ref_node_child_process"
Cohesion: 0.31
Nodes (6): checkDisposition(), publishMerge(), baseSha, fixture(), head, success

### Community 49 - "cleanup"
Cohesion: 0.22
Nodes (7): cleanup(), command(), detach_watchdog_io(), process_inventory(), publish_watchdog_evidence(), record_remaining(), start_watchdog()

### Community 50 - "codeql-upload-recovery.test.mjs"
Cohesion: 0.22
Nodes (5): helper, observedBuiltinTokenQuota, program, sha, workflow

### Community 51 - "codeql-quota-diagnostics.test.mjs"
Cohesion: 0.32
Nodes (7): execute(), names, sample, shell(), step(), unknown, workflow

### Community 52 - "preview-recovery.test.mjs"
Cohesion: 0.39
Nodes (6): previewWorkActive(), reconcilePreviewInventory(), recoveryAttempt(), recoverySourceIssue(), now, source

### Community 53 - "start.sh"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 54 - "README.md"
Cohesion: 0.33
Nodes (4): Clean native release test prerequisites, Prebuilt-only Vercel deployments, Reviewed retained-source preview maintenance, Verified PR alias promotion

### Community 55 - "verify-promotion-source-authority.sh"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 56 - "PR #1294 — Remove orphan Vercel previews and reject pre-gateway source"
Cohesion: 0.29
Nodes (6): Activation and remaining acceptance, Delivered controller behavior, Parent-reported one-time operational cleanup, PR #1294 — Remove orphan Vercel previews and reject pre-gateway source, Saved retention policy, Verification and evidence boundaries

### Community 57 - "PR #609 — Restore Lopu and preview admission"
Cohesion: 0.29
Nodes (6): Follow-up acceptance repair, Live diagnosis, Outcome, PR #609 — Restore Lopu and preview admission, Security boundary, Validation

### Community 58 - "Protected unsigned native compilation"
Cohesion: 0.33
Nodes (6): Admission and entry point, Darwin credential verification and trusted failures, Enforced network policy and cleanup, Protected unsigned native compilation, Trust boundary, Validation and acceptance

### Community 59 - "electron-release-gates.test.mjs"
Cohesion: 0.40
Nodes (5): allowed(), evaluate, expression, main, workflow

### Community 60 - "PR #506 — Auto-merge resolved main to develop sync PR"
Cohesion: 0.33
Nodes (5): Operational proof gate, PR #506 — Auto-merge resolved main to develop sync PR, Problem, Resolution, Validation

### Community 61 - "PR #603 — Admin preview publisher controller"
Cohesion: 0.33
Nodes (5): Compatibility fix, Outcome, PR #603 — Admin preview publisher controller, Security boundary, Validation

### Community 62 - "PR #637: Safe cooperative handover for Lopu reviews"
Cohesion: 0.33
Nodes (5): PR #611 recovery, PR #637: Safe cooperative handover for Lopu reviews, Protocol, Scope and evidence, Validation

### Community 63 - "PR #643 — Missing-build page for unassigned PR preview URLs"
Cohesion: 0.33
Nodes (5): Cause and scope, PR #643 — Missing-build page for unassigned PR preview URLs, Protected rollout, Root response decision, Verification before merge

### Community 64 - "vercel.json"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 65 - "rebase-index-fingerprint.test.mjs"
Cohesion: 0.80
Nodes (4): rawIndexHash(), runGit(), semanticIndexHash(), sha256()

### Community 66 - "PR #492 — Load Lopu credentials from the Thingtime vault"
Cohesion: 0.40
Nodes (4): PR #492 — Load Lopu credentials from the Thingtime vault, Safety and regression focus, Scope, Validation log

### Community 67 - "PR #534 — Feature Stack progress heartbeat controller"
Cohesion: 0.40
Nodes (4): Outcome, PR #534 — Feature Stack progress heartbeat controller, Safety and cost, Validation

### Community 68 - "PR #642: Discoverable preview status and missed-build repair"
Cohesion: 0.40
Nodes (4): Changes, Evidence and cause, PR #642: Discoverable preview status and missed-build repair, Validation and rollout

### Community 69 - "Working on it"
Cohesion: 0.40
Nodes (5): Discoverable preview status and recovery, Missing-build wildcard page, Orphan deployment cleanup (2026-10-30), Protected deployment checks and reviewed retirement, Working on it

### Community 70 - "[Unreleased]"
Cohesion: 0.50
Nodes (4): Added, Changed, Fixed, [Unreleased]

### Community 71 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 72 - "resolve-canonical-instruction-type-conflicts.sh"
Cohesion: 0.83
Nodes (3): resolve-canonical-instruction-type-conflicts.sh script, stage_record(), tree_record()

### Community 73 - "PR 1499: Protected deployment checks and reviewed preview retirement"
Cohesion: 0.50
Nodes (3): PR 1499: Protected deployment checks and reviewed preview retirement, Result, Verification and limits

## Knowledge Gaps
- **28 isolated node(s):** `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR`, `BASE_REF`, `BASE_SHA` (+23 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 454 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `selfTest()` connect `promote-features-to-main.mjs` to `ref_node_assert`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR` to the rest of the system?**
  _28 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `promote-features-to-main.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05194805194805195 - nodes in this community are weakly interconnected._
- **Why does `NativeCompileBoundaryTests` connect `NativeCompileBoundaryTests` to `extract-vercel-prebuilt.py`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Should `deploy-admin-pr-previews.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.07901668129938542 - nodes in this community are weakly interconnected._
- **Why does `syncPreviewLabels()` connect `reconcile` to `deploy-admin-pr-previews.mjs`, `deploy-develop-pr-preview.mjs`, `deploy`, `preview-fallback.mjs`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Should `graphify-cas.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.08735733099209833 - nodes in this community are weakly interconnected._