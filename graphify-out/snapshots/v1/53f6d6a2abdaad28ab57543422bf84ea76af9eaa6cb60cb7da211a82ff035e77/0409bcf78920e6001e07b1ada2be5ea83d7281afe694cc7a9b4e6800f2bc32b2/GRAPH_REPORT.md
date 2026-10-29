# Graph Report - thingtime  (2026-10-30)

## Corpus Check
- 102 files · ~268,379 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 4, .jq 1)

## Summary
- 1389 nodes · 3405 edges · 74 communities (67 shown, 7 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 46 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e8edeaf1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- promote-features-to-main.mjs
- deploy-admin-pr-previews.mjs
- graphify-cas.mjs
- deploy-vercel-prebuilt.mjs
- NativeCompileBoundaryTests
- lopu-model-waterfall.mjs
- promotion-pr-changelog.mjs
- build-all-branch.mjs
- lopu-cooperative-review.mjs
- deploy-develop-pr-preview.mjs
- resolve-pr-conflicts-routing-contract.mjs
- reconcile
- lopu-pr-status.mjs
- workflow-control-plane-contract.mjs
- extract-vercel-prebuilt.py
- runSelfTest
- ref_node_fs
- preview-fallback.mjs
- refresh-promotion-graphify.sh
- native-compile-ci.py
- codeql-open-pr-backfill.mjs
- ref_node_assert
- deploymentIdentityIssue
- Control-plane changelog
- lopu-pr-lifecycle.mjs
- orphan-preview-cleanup.mjs
- main
- merge-main-develop-sync-pr.mjs
- promotion-worker-contract.sh
- feature-stack-waterfall.test.mjs
- supervise
- normalizeLogin
- rebase-related-edits.test.mjs
- prepare-round.sh
- promotion-worker.sh
- feature-stack-progress.mjs
- preview-labels.mjs
- promotion-worker-routing-contract.mjs
- `github-actions` — the CI control plane
- Control-plane regression checklist
- Thingtime AI instructions
- Thingtime AI instructions
- control-plane-events.test.mjs
- stage-graphify-snapshots.mjs
- ref_node_child_process
- cleanup
- Prebuilt-only deployments (2026-10-23)
- preview-recovery.test.mjs
- start.sh
- verify-promotion-source-authority.sh
- PR #609 — Restore Lopu and preview admission
- CHANGELOG.md
- Protected unsigned native compilation
- PR #506 — Auto-merge resolved main to develop sync PR
- PR #603 — Admin preview publisher controller
- PR #637: Safe cooperative handover for Lopu reviews
- PR #643 — Missing-build page for unassigned PR preview URLs
- vercel.json
- rebase-index-fingerprint.test.mjs
- PR #1294 — Remove orphan Vercel previews and reject pre-gateway source
- PR #492 — Load Lopu credentials from the Thingtime vault
- PR #534 — Feature Stack progress heartbeat controller
- PR #634: Lopu comment admission and idempotent preview writes
- PR #642: Discoverable preview status and missed-build repair
- [Unreleased]
- README.md
- safeHostname
- rebase-ownership-routing-contract.sh
- resolve-canonical-instruction-type-conflicts.sh
- Working on it
- 1225-codex-gateway-publisher-policy-publish-controlled-environment-gateway-owners.md
- 781-codex-stack-progress-chat-controller-answer-feature-stack-status-questions.md
- codex-gateway-alias-propagation-standard-preview-target.md

## God Nodes (most connected - your core abstractions)
1. `runPromotion()` - 64 edges
2. `runSelfTest()` - 55 edges
3. `selfTest()` - 53 edges
4. `NativeCompileBoundaryTests` - 48 edges
5. `reconcile()` - 38 edges
6. `deploy()` - 29 edges
7. `publish()` - 28 edges
8. `failureDetail()` - 28 edges
9. `githubRequest()` - 22 edges
10. `main()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `publishAdminStatus()` --calls--> `syncPreviewLabels()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/preview-labels.mjs
- `cleanupEnvironment()` --calls--> `syncPreviewLabels()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/preview-labels.mjs
- `deployEnvironment()` --calls--> `verifyPublishedPreview()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/preview-fallback.mjs
- `deployEnvironment()` --calls--> `deploymentBuiltAt()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/preview-labels.mjs
- `choosePreferredDeployment()` --calls--> `gatewayDeploymentIssue()`  [EXTRACTED]
  .github/scripts/deploy-develop-pr-preview.mjs → .github/scripts/environment-gateway-policy.mjs

## Import Cycles
- None detected.

## Communities (74 total, 7 thin omitted)

### Community 0 - "promote-features-to-main.mjs"
Cohesion: 0.05
Nodes (130): applyPicks(), attestationMatches(), botCommentsByLatestEvent(), buildPromotionDispatchRequest(), buildPromotionPlanContext(), cancelPromotionRetirement(), CFG, checkoutRemoteBranch() (+122 more)

### Community 1 - "deploy-admin-pr-previews.mjs"
Cohesion: 0.07
Nodes (66): ACTIVE_STATES, assertCurrentPullRequest(), assertPrebuiltOutput(), assignAlias(), boundedInteger(), cleanupDeploymentIssue(), cleanupEnvironment(), commentBody() (+58 more)

### Community 2 - "graphify-cas.mjs"
Cohesion: 0.09
Nodes (60): activateSnapshot(), artifactHash(), baselineNodeCount(), compareSnapshotQuality(), computeSourceFingerprint(), copyPortableFiles(), DEFAULT_SNAPSHOT_RETENTION, dropNestedRepositories() (+52 more)

### Community 3 - "deploy-vercel-prebuilt.mjs"
Cohesion: 0.10
Nodes (53): applyOutputPolicy(), visit(), assertGatewaySource(), assertPreviewOpen(), compatibilityAliasCandidates(), context(), deploymentArgs(), deploymentIssue() (+45 more)

### Community 5 - "lopu-model-waterfall.mjs"
Cohesion: 0.12
Nodes (37): models, CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest(), exportBundle() (+29 more)

### Community 6 - "promotion-pr-changelog.mjs"
Cohesion: 0.13
Nodes (38): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+30 more)

### Community 7 - "build-all-branch.mjs"
Cohesion: 0.16
Nodes (36): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), completeRefspecs, countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode() (+28 more)

### Community 8 - "lopu-cooperative-review.mjs"
Cohesion: 0.11
Nodes (28): checkpoint(), completedReport(), continuationNumbers(), finalize(), git(), HANDOVER_INSTRUCTIONS, initialize(), numbers() (+20 more)

### Community 9 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.10
Nodes (26): ACTIVE_STATES, assertPrebuiltOutput(), assertWildcardFallbackRuntimes(), CLEANUP_ACTIONS, developRefSha(), execFileAsync, expectedReadyAt(), expectedReadyForRun() (+18 more)

### Community 10 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.12
Nodes (26): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertCapturedStdoutStaysClean(), assertRoute(), assertWorkflowSource(), CALLS_HELPER(), decodeBatch() (+18 more)

### Community 11 - "reconcile"
Cohesion: 0.19
Nodes (28): assertCurrentPullRequest(), assertTrustedPullRequestStack(), assignAliasVerified(), cleanupDeployments(), cleanupPrResources(), createGithubDeployment(), dashboardUrl(), deploy() (+20 more)

### Community 12 - "lopu-pr-status.mjs"
Cohesion: 0.17
Nodes (25): argument(), branchCode(), classifyInventory(), count(), dateParts(), desiredFactLabels(), escapeHtml(), FACT_LABEL_ORDER (+17 more)

### Community 13 - "workflow-control-plane-contract.mjs"
Cohesion: 0.13
Nodes (26): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertAdminWaterfallGrammar(), assertBareControlPlaneTree() (+18 more)

### Community 14 - "extract-vercel-prebuilt.py"
Cohesion: 0.14
Nodes (5): extract_archive(), main(), _member_path(), self_test(), _validate_link()

### Community 15 - "runSelfTest"
Cohesion: 0.13
Nodes (26): assertCustomDevelopEnvironment(), assertPreviewMaster(), assertVercelConfiguration(), cancelAndDeleteDeployment(), choosePreferredDeployment(), chooseStableDevelopDeployment(), customEnvironmentDomainNames(), headHasPreviewBundle() (+18 more)

### Community 16 - "ref_node_fs"
Cohesion: 0.13
Nodes (13): allowed, workflow, allowed(), evaluate, expression, main, workflow, answerCommand() (+5 more)

### Community 17 - "preview-fallback.mjs"
Cohesion: 0.15
Nodes (19): FALLBACK_BRANCH, FALLBACK_HEADER, FALLBACK_MARKER, fallbackDeploymentIssue(), fallbackDomainIssue(), fallbackPage(), fallbackResponseIssue(), installFallbackAliases() (+11 more)

### Community 18 - "refresh-promotion-graphify.sh"
Cohesion: 0.14
Nodes (24): assert_control_metadata_unchanged(), assert_tool_boundary(), current_grafts_state(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT (+16 more)

### Community 19 - "native-compile-ci.py"
Cohesion: 0.12
Nodes (11): acquire_cleanup_lock(), arm_native(), drop_identity(), extract_candidate(), kernel_groups(), main(), native_deadline(), preflight_failure() (+3 more)

### Community 20 - "codeql-open-pr-backfill.mjs"
Cohesion: 0.21
Nodes (23): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), analysisSnapshotForPullRequest(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp() (+15 more)

### Community 21 - "ref_node_assert"
Cohesion: 0.13
Nodes (9): assertPrReleaseContract(), count(), here, workflow, postPublishRefRace(), snapshot, previewSummaryBody(), publishPreviewSummary() (+1 more)

### Community 22 - "deploymentIdentityIssue"
Cohesion: 0.20
Nodes (19): createVercelDeployment(), deploymentDetail(), deploymentIdentityIssue(), deploymentMetadata(), deployPrebuiltOutput(), guardPreviewUpload(), listWorkflowDeployments(), prebuiltDeploymentArgs() (+11 more)

### Community 23 - "Control-plane changelog"
Cohesion: 0.10
Nodes (20): 2026-09-05 — Cooperative review handover and preview recovery, 2026-09-05 — Desktop and Recovery cloud release repair, 2026-09-05 — Signed Commander releases and Recovery pairing, 2026-09-05 — Visible previews and conflict detector recovery, 2026-10-18 — Correct reusable workflow context, 2026-10-18 — Diagnose OpenAI preflight failures safely, 2026-10-18 — Execute the saved admin AI waterfall, 2026-10-23 — Build every Vercel deployment on GitHub Actions (+12 more)

### Community 24 - "lopu-pr-lifecycle.mjs"
Cohesion: 0.20
Nodes (16): approved(), eligible(), identity(), managed(), pauses, redundant(), selectPulls(), settle() (+8 more)

### Community 25 - "orphan-preview-cleanup.mjs"
Cohesion: 0.23
Nodes (16): ACTIVE, assertPreviewHasOpenPullRequest(), completeInventory(), idOf(), missing(), openBranchPullRequests(), orphaned(), previewIdentity() (+8 more)

### Community 26 - "main"
Cohesion: 0.21
Nodes (18): assertPreviewBundle(), boundedInteger(), cleanupClosedPrResources(), cleanupComment(), deploymentListParams(), dispatchPullRequestIssue(), exactPrefixedId(), getPullRequest() (+10 more)

### Community 27 - "merge-main-develop-sync-pr.mjs"
Cohesion: 0.22
Nodes (15): assertHeadContainsMain(), assertSyncPullRequestShape(), exactSha(), EXPECTED_MERGE_REJECTIONS, githubRequest(), GitHubRequestError, headContainsMain(), mergeStandingSyncPullRequest() (+7 more)

### Community 28 - "promotion-worker-contract.sh"
Cohesion: 0.14
Nodes (17): BASE_REF, BASE_SHA, compute_plan_hash(), GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay() (+9 more)

### Community 29 - "feature-stack-waterfall.test.mjs"
Cohesion: 0.32
Nodes (14): canonicalFeatureStackPlan(), decodeFeatureStackPlan(), exactKeys(), featureStackId(), git(), selfTest(), validateWaterfall(), verifyFeatureStackHistory() (+6 more)

### Community 30 - "supervise"
Cohesion: 0.17
Nodes (14): admit_runner(), build_environment(), firewall_rules(), phase(), require_hosted_runner(), run(), supervise(), as_build() (+6 more)

### Community 31 - "normalizeLogin"
Cohesion: 0.18
Nodes (14): assertNoProtectedAlias(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), classifyPullRequest(), EligibilityError, getRepositoryPermission(), isSafeHeadRef() (+6 more)

### Community 32 - "rebase-related-edits.test.mjs"
Cohesion: 0.28
Nodes (14): actionPath, copyTrustedTree(), extractVerifierScript(), filesUnder(), hashNamedFiles(), hashRebaseState(), hashTrustedTree(), makeStoppedRebase() (+6 more)

### Community 33 - "prepare-round.sh"
Cohesion: 0.28
Nodes (14): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_index_entries(), hash_rebase_state(), rebase_in_progress() (+6 more)

### Community 34 - "promotion-worker.sh"
Cohesion: 0.37
Nodes (13): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+5 more)

### Community 35 - "feature-stack-progress.mjs"
Cohesion: 0.24
Nodes (12): githubJobs(), githubStackPullRequests(), postProgress(), progressSnapshot(), reconcile(), recoveryPayload(), run(), selfTest() (+4 more)

### Community 36 - "preview-labels.mjs"
Cohesion: 0.24
Nodes (11): colors, ensureLabel(), hasPreviewLabels(), lanes, prefix(), previewBuildTime(), previewBuiltLabel(), syncOnce() (+3 more)

### Community 37 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.14
Nodes (13): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, featureStackMergeIf, featureStackMergeJob, graphify, lopuAgent (+5 more)

### Community 38 - "`github-actions` — the CI control plane"
Cohesion: 0.14
Nodes (14): Commander signed releases, Desktop and Recovery release pipeline, Environment gateways for future product builds, Fork setup: Vercel develop previews, `github-actions` — the CI control plane, Known trade-off, Lopu principal repository manager, macOS signing and build identity (+6 more)

### Community 39 - "Control-plane regression checklist"
Cohesion: 0.15
Nodes (13): Configured cross-provider waterfall, Control-plane regression checklist, Cooperative review handover, Event feedback and CI cancellation, Exact configured workflow model orders, Explicit stack model and endpoint waterfall, Feature Stack run status conversations, Feature Stack snapshot publication and merge gates (+5 more)

### Community 40 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 41 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 42 - "control-plane-events.test.mjs"
Cohesion: 0.24
Nodes (5): ci, workflow, classifyConversation(), classifyQueuedConversation(), hasAutomationMarker()

### Community 43 - "stage-graphify-snapshots.mjs"
Cohesion: 0.36
Nodes (11): addExisting(), filesUnder(), git(), LEGACY_ROOT, missingFromWorktree(), PORTABLE, removeFromIndex(), restoreTrackedFromHead() (+3 more)

### Community 44 - "ref_node_child_process"
Cohesion: 0.31
Nodes (6): checkDisposition(), publishMerge(), baseSha, fixture(), head, success

### Community 45 - "cleanup"
Cohesion: 0.22
Nodes (7): cleanup(), command(), detach_watchdog_io(), process_inventory(), publish_watchdog_evidence(), record_remaining(), start_watchdog()

### Community 46 - "Prebuilt-only deployments (2026-10-23)"
Cohesion: 0.22
Nodes (9): Environment gateway publication, Existing workflow preflight verification, Native control continuity and bounded bootstrap, Prebuilt artifact acceptance, Prebuilt-only deployments (2026-10-23), Preview receipt runner context (2026-10-26), Protected native compilation, Published PR gateway API acceptance (2026-10-26) (+1 more)

### Community 47 - "preview-recovery.test.mjs"
Cohesion: 0.39
Nodes (6): previewWorkActive(), reconcilePreviewInventory(), recoveryAttempt(), recoverySourceIssue(), now, source

### Community 48 - "start.sh"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 49 - "verify-promotion-source-authority.sh"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 50 - "PR #609 — Restore Lopu and preview admission"
Cohesion: 0.29
Nodes (6): Follow-up acceptance repair, Live diagnosis, Outcome, PR #609 — Restore Lopu and preview admission, Security boundary, Validation

### Community 52 - "Protected unsigned native compilation"
Cohesion: 0.33
Nodes (6): Admission and entry point, Darwin credential verification and trusted failures, Enforced network policy and cleanup, Protected unsigned native compilation, Trust boundary, Validation and acceptance

### Community 53 - "PR #506 — Auto-merge resolved main to develop sync PR"
Cohesion: 0.33
Nodes (5): Operational proof gate, PR #506 — Auto-merge resolved main to develop sync PR, Problem, Resolution, Validation

### Community 54 - "PR #603 — Admin preview publisher controller"
Cohesion: 0.33
Nodes (5): Compatibility fix, Outcome, PR #603 — Admin preview publisher controller, Security boundary, Validation

### Community 55 - "PR #637: Safe cooperative handover for Lopu reviews"
Cohesion: 0.33
Nodes (5): PR #611 recovery, PR #637: Safe cooperative handover for Lopu reviews, Protocol, Scope and evidence, Validation

### Community 56 - "PR #643 — Missing-build page for unassigned PR preview URLs"
Cohesion: 0.33
Nodes (5): Cause and scope, PR #643 — Missing-build page for unassigned PR preview URLs, Protected rollout, Root response decision, Verification before merge

### Community 57 - "vercel.json"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 58 - "rebase-index-fingerprint.test.mjs"
Cohesion: 0.80
Nodes (4): rawIndexHash(), runGit(), semanticIndexHash(), sha256()

### Community 59 - "PR #1294 — Remove orphan Vercel previews and reject pre-gateway source"
Cohesion: 0.40
Nodes (4): Activation and remaining acceptance, Delivered controller behavior, PR #1294 — Remove orphan Vercel previews and reject pre-gateway source, Verification and evidence boundaries

### Community 60 - "PR #492 — Load Lopu credentials from the Thingtime vault"
Cohesion: 0.40
Nodes (4): PR #492 — Load Lopu credentials from the Thingtime vault, Safety and regression focus, Scope, Validation log

### Community 61 - "PR #534 — Feature Stack progress heartbeat controller"
Cohesion: 0.40
Nodes (4): Outcome, PR #534 — Feature Stack progress heartbeat controller, Safety and cost, Validation

### Community 62 - "PR #634: Lopu comment admission and idempotent preview writes"
Cohesion: 0.40
Nodes (5): Behavior, Evidence and scope, PR #634: Lopu comment admission and idempotent preview writes, Rollout, Validation

### Community 63 - "PR #642: Discoverable preview status and missed-build repair"
Cohesion: 0.40
Nodes (4): Changes, Evidence and cause, PR #642: Discoverable preview status and missed-build repair, Validation and rollout

### Community 64 - "[Unreleased]"
Cohesion: 0.50
Nodes (4): Added, Changed, Fixed, [Unreleased]

### Community 66 - "safeHostname"
Cohesion: 0.67
Nodes (4): isHostnameLabel(), isS3BucketHostname(), safeCorsProbeUrl(), safeHostname()

### Community 67 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 68 - "resolve-canonical-instruction-type-conflicts.sh"
Cohesion: 0.83
Nodes (3): resolve-canonical-instruction-type-conflicts.sh script, stage_record(), tree_record()

### Community 69 - "Working on it"
Cohesion: 0.50
Nodes (4): Discoverable preview status and recovery, Missing-build wildcard page, Orphan deployment cleanup (2026-10-30), Working on it

## Knowledge Gaps
- **28 isolated node(s):** `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR`, `BASE_REF`, `BASE_SHA` (+23 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 397 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `selfTest()` connect `promote-features-to-main.mjs` to `ref_node_assert`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **What connects `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR` to the rest of the system?**
  _28 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `promote-features-to-main.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05194805194805195 - nodes in this community are weakly interconnected._
- **Why does `NativeCompileBoundaryTests` connect `NativeCompileBoundaryTests` to `extract-vercel-prebuilt.py`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Should `deploy-admin-pr-previews.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.07367641614216956 - nodes in this community are weakly interconnected._
- **Should `graphify-cas.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.08735733099209833 - nodes in this community are weakly interconnected._
- **Should `deploy-vercel-prebuilt.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.09837092731829573 - nodes in this community are weakly interconnected._