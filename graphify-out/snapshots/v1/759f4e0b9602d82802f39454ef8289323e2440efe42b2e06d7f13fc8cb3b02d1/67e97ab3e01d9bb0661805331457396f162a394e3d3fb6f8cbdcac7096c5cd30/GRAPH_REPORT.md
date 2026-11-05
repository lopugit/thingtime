# Graph Report - thingtime  (2026-10-30)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1394 nodes · 3447 edges · 79 communities (62 shown, 17 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 65 edges (avg confidence: 0.84)
- Token cost: 3,571 input · 703 output

## Graph Freshness
- Built from commit: `6b541291`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Promotion Workflow
- Admin Preview Deployment
- Graphify Snapshot Management
- Prebuilt Deployment Publishing
- Native Compilation Security Tests
- Repository Workflow Automation
- Develop Preview Deployment
- Promotion Changelog Generation
- All Branch Build Automation
- Model Routing and Credential Vault
- Credential Failure Classification
- Orphan Preview Cleanup
- Conflict Routing Contracts
- Pull Request Status Reporting
- Cooperative Review Workflow
- Trusted Pull Request Validation
- Workflow Control Plane Contracts
- Safe Archive Extraction
- Deployment Lifecycle Management
- Preview Fallback Handling
- Promotion Graph Refresh
- Native Compilation Isolation
- CodeQL Pull Request Backfill
- Feature Stack Chat and Progress
- Prebuilt Preview Deployment
- Feature Stack Planning
- Main Develop Synchronization
- Pull Request Lifecycle Management
- Promotion Worker Contracts
- Conversation Automation Gates
- Build Runner Isolation
- Rebase Conflict Verification
- Rebase Conflict Preparation
- Promotion Worker Execution
- Preview Label Management
- Promotion Workflow Routing
- Main Develop Synchronization Lane
- Graphify Snapshot Staging
- Preview Publisher Coordination
- Feature Stack Merge Publishing
- Build Watchdog Cleanup
- Pull Request Review Queue
- Thingtime API and Data Model
- Preview Control Plane
- Preview Recovery Management
- Rebase Workflow Startup
- Electron Release Workflows
- Promotion Source Verification
- Agent Model Routing
- HTTP Request Retry Handling
- Electron Release Gate Tests
- Pull Request Preview Coordination
- Vercel Deployment Configuration
- Native Compilation Isolation Policy
- Deployment URL Validation
- Rebase Index Fingerprinting
- Feature Stack Status Reporting
- Rebase Ownership Routing
- Canonical Instruction Conflict Resolution
- Preview HTML Fallback Rollout
- Feature Stack Merge Workflow
- Feature Stack Progress Tracking
- Preview Manager and Credential Routing
- Develop Promotion Workflows
- Protected Branch Auto-Merge
- Cooperative Handover Workflow
- Pull Request Lifecycle Workflow
- Feature Stack Progress Heartbeat
- Feature Stack Reconcile Receipts
- Model Configuration Workflow
- Promotion Resolution Workflow
- API Capability Manifest
- Canonical AI Instructions
- CodeQL Pull Request Handoff
- Commander Release Workflow
- Thingtime Credential Vault Integration
- Comment Admission Security
- Preview Recovery Workflow

## God Nodes (most connected - your core abstractions)
1. `runPromotion()` - 64 edges
2. `selfTest()` - 53 edges
3. `runSelfTest()` - 53 edges
4. `NativeCompileBoundaryTests` - 48 edges
5. `reconcile()` - 38 edges
6. `deploy()` - 31 edges
7. `failureDetail()` - 28 edges
8. `publish()` - 28 edges
9. `githubRequest()` - 23 edges
10. `main()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `Lopu agent action` --references--> `Saved Thingtime model waterfall`  [EXTRACTED]
  .github/actions/lopu-agent/action.yml → README.md
- `Storage release gate` --references--> `Preview gateway capability`  [EXTRACTED]
  .github/TESTING.md → README.md
- `Saved Thingtime model waterfall` --references--> `Lopu model waterfall`  [EXTRACTED]
  README.md → .github/actions/lopu-agent/action.yml
- `Rebase PR Stacks Workflow` --conceptually_related_to--> `Exact Snapshot Validation`  [INFERRED]
  .github/workflows/rebase-pr-stacks.yml → .github/workflows/resolve-pr-conflicts.yml
- `Resolve PR Conflicts Workflow` --conceptually_related_to--> `Graphify Refresh and Publication`  [INFERRED]
  .github/workflows/resolve-pr-conflicts.yml → .github/workflows/rebase-pr-stacks.yml

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Shared CI provider routing contract** — github_workflows_promote_develop_to_main_route, github_workflows_promote_features_to_main_route [EXTRACTED 0.80]
- **develop→main promotion and back-sync automation** — github_workflows_promote_develop_to_main_workflow, github_workflows_promote_features_to_main_workflow, github_scripts_promote_features_to_main, github_scripts_promotion_pr_changelog [EXTRACTED 0.85]
- **Validation Check Suite** — prs_506_codex_auto_merge_main_develop_sync_pr_pr_506, prs_506_codex_auto_merge_main_develop_sync_pr_self_tests, prs_506_codex_auto_merge_main_develop_sync_pr_graphify_extraction, prs_506_codex_auto_merge_main_develop_sync_pr_local_codex_proxy [EXTRACTED 0.85]
- **Admin Preview Publication Flow** — prs_603_codex_admin_preview_publisher_controller_admin_preview_publisher, prs_603_codex_admin_preview_publisher_controller_github_actions_branch, prs_642_vercel_deployment [EXTRACTED 0.90]
- **Graphify Refresh After Rebase** — .github_workflows_rebase_pr_stacks_graphify_cas, .github_workflows_rebase_pr_stacks_stage_graphify_snapshots, .github_workflows_rebase_pr_stacks_lopu_credential_vault, .github_workflows_resolve_pr_conflicts_graphify_refresh [EXTRACTED 0.90]
- **Operational Proof Gate** — prs_506_codex_auto_merge_main_develop_sync_pr_pr_475, prs_506_codex_auto_merge_main_develop_sync_pr_protected_lopu_entrypoint, prs_506_codex_auto_merge_main_develop_sync_pr_sync_main_into_develop_pr, prs_506_codex_auto_merge_main_develop_sync_pr_main_branch, prs_506_codex_auto_merge_main_develop_sync_pr_develop_branch [EXTRACTED 0.90]
- **Paired Status Responder Rollout** — prs_781_codex_stack_progress_chat_controller_answer_feature_stack_status_questions_status_responder, prs_781_codex_stack_progress_chat_controller_answer_feature_stack_status_questions_product_chat_capability, prs_781_codex_stack_progress_chat_controller_answer_feature_stack_status_questions_product_api_pr_782 [EXTRACTED 0.90]
- **Terminal Merge Safety Gate** — prs_506_codex_auto_merge_main_develop_sync_pr_trusted_terminal_merger, prs_506_codex_auto_merge_main_develop_sync_pr_thingtime_repository, prs_506_codex_auto_merge_main_develop_sync_pr_sync_main_into_develop_pr, prs_506_codex_auto_merge_main_develop_sync_pr_develop_branch, prs_506_codex_auto_merge_main_develop_sync_pr_main_branch, prs_506_codex_auto_merge_main_develop_sync_pr_exact_head_rest_merge [EXTRACTED 0.90]
- **Verified Rebase and Stack Publication** — .github_workflows_rebase_pr_stacks, .github_workflows_rebase_pr_stacks_rebase_conflict_round_action, .github_workflows_resolve_pr_conflicts_pr_stack_coordination [EXTRACTED 0.90]
- **CodeQL analysis ownership and upload ordering** — .github_workflows_codeql_analysis, .github_workflows_codeql_analysis_scope, .github_workflows_codeql_analysis_analyze [EXTRACTED 0.95]
- **Commander Signed Release Pipeline** — github_workflows_commander_release_release [EXTRACTED 0.95]
- **Cooperative Review Handover Flow** — prs_637_codex_lopu_cooperative_handoff_safely_hand_batch_reviews_over_to_waiting_work_cooperative_handover_protocol, prs_637_codex_lopu_cooperative_handoff_safely_hand_batch_reviews_over_to_waiting_work_pr_637 [EXTRACTED 0.95]
- **Electron Release Distribution Flow** — github_workflows_electron_pr_release_resolve_validate_pr_source, github_workflows_electron_pr_release_select_release_distribution, github_workflows_electron_pr_release_derive_semver_pr_release_identity, github_workflows_electron_pr_release_build_signed_release, github_workflows_electron_pr_release_build_unsigned_release [EXTRACTED 0.95]
- **Feature Stack Progress Reporting** — prs_534_codex_feature_stack_progress_heartbeats_controller, prs_534_codex_feature_stack_progress_heartbeats_controller_reporter, prs_534_codex_feature_stack_progress_heartbeats_controller_target_workers [EXTRACTED 0.95]
- **Lopu PR Management and Resolution Flow** — .github_workflows_resolve_pr_conflicts, .github_workflows_resolve_pr_conflicts_ci_provider_router_workflow, .github_workflows_resolve_pr_conflicts_rebase_pr_stacks_workflow, .github_workflows_resolve_pr_conflicts_lopu_pr_status, .github_workflows_resolve_pr_conflicts_lopu_conversation_gate, .github_workflows_resolve_pr_conflicts_exact_snapshot_validation [EXTRACTED 0.95]
- **Lopu isolated rebase conflict resolution flow** — .github_workflows_rebase_pr_stacks_detect, .github_workflows_rebase_pr_stacks_handoff, .github_workflows_rebase_pr_stacks_rebase, .github_actions_rebase_conflict_round_action [EXTRACTED 0.95]
- **PR #661 Delivery Reliability Repairs** — prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_pr_661, prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_dependency_graph_regression, prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_bounded_pr_inventory, prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_ref_race_retry [EXTRACTED 0.95]
- **Missing-build Preview Rollout** — prs_643_codex_preview_no_build_page_show_a_no_build_page_for_unassigned_pr_preview_urls_preview_wildcard_domains, prs_643_codex_preview_no_build_page_show_a_no_build_page_for_unassigned_pr_preview_urls_fixed_html_fallback, prs_643_codex_preview_no_build_page_show_a_no_build_page_for_unassigned_pr_preview_urls_protected_rollout [EXTRACTED 0.95]
- **Scheduled Preview Recovery Flow** — prs_642_preview_status_recovery, prs_642_scheduled_controller, prs_642_deployment_receipts, prs_642_vercel_deployment [EXTRACTED 0.95]
- **Vercel preview build and publish pipeline** — .github_workflows_develop_pr_preview, .github_workflows_deploy_vercel_prebuilt, .github_workflows_all_branch [INFERRED 0.72]

## Communities (79 total, 17 thin omitted)

### Community 0 - "Promotion Workflow"
Cohesion: 0.05
Nodes (133): applyPicks(), attestationMatches(), botCommentsByLatestEvent(), buildPromotionDispatchRequest(), buildPromotionPlanContext(), cancelPromotionRetirement(), CFG, checkoutRemoteBranch() (+125 more)

### Community 1 - "Admin Preview Deployment"
Cohesion: 0.07
Nodes (67): ACTIVE_STATES, assertCurrentPullRequest(), assertPrebuiltOutput(), assignAlias(), boundedInteger(), cleanupDeploymentIssue(), cleanupEnvironment(), commentBody() (+59 more)

### Community 2 - "Graphify Snapshot Management"
Cohesion: 0.09
Nodes (60): activateSnapshot(), artifactHash(), baselineNodeCount(), compareSnapshotQuality(), computeSourceFingerprint(), copyPortableFiles(), DEFAULT_SNAPSHOT_RETENTION, dropNestedRepositories() (+52 more)

### Community 3 - "Prebuilt Deployment Publishing"
Cohesion: 0.09
Nodes (61): applyOutputPolicy(), visit(), assertGatewaySource(), assertPreviewOpen(), compatibilityAliasCandidates(), context(), deploymentArgs(), deploymentIssue() (+53 more)

### Community 5 - "Repository Workflow Automation"
Cohesion: 0.05
Nodes (43): Rebase conflict round action, Lopu conflict resolver action, Prepare conflict round, Verify and continue rebase, All-branch integration workflow, All-branch build controller, CodeQL analysis workflow, Analyze CodeQL language matrix (+35 more)

### Community 6 - "Develop Preview Deployment"
Cohesion: 0.08
Nodes (41): ACTIVE_STATES, assertCustomDevelopEnvironment(), assertPrebuiltOutput(), assertPreviewMaster(), assertVercelConfiguration(), assertWildcardFallbackRuntimes(), CLEANUP_ACTIONS, cleanupDeployments() (+33 more)

### Community 7 - "Promotion Changelog Generation"
Cohesion: 0.12
Nodes (41): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+33 more)

### Community 8 - "All Branch Build Automation"
Cohesion: 0.16
Nodes (36): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), completeRefspecs, countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode() (+28 more)

### Community 9 - "Model Routing and Credential Vault"
Cohesion: 0.15
Nodes (31): models, exportBundle(), fetchBundle(), legacyCredentials(), main(), required(), safeCache(), validate() (+23 more)

### Community 10 - "Credential Failure Classification"
Cohesion: 0.10
Nodes (16): CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest(), allowed, workflow (+8 more)

### Community 11 - "Orphan Preview Cleanup"
Cohesion: 0.15
Nodes (25): ACTIVE, assertPreviewHasOpenPullRequest(), completeInventory(), deploymentLane(), idOf(), missing(), openBranchPullRequests(), previewIdentity() (+17 more)

### Community 12 - "Conflict Routing Contracts"
Cohesion: 0.12
Nodes (26): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertCapturedStdoutStaysClean(), assertRoute(), assertWorkflowSource(), CALLS_HELPER(), decodeBatch() (+18 more)

### Community 13 - "Pull Request Status Reporting"
Cohesion: 0.16
Nodes (26): progress job, argument(), branchCode(), classifyInventory(), count(), dateParts(), desiredFactLabels(), escapeHtml() (+18 more)

### Community 14 - "Cooperative Review Workflow"
Cohesion: 0.16
Nodes (22): checkpoint(), completedReport(), continuationNumbers(), finalize(), git(), HANDOVER_INSTRUCTIONS, initialize(), numbers() (+14 more)

### Community 15 - "Trusted Pull Request Validation"
Cohesion: 0.15
Nodes (26): assertCurrentPullRequest(), assertPreviewBundle(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), boundedInteger(), dispatchPullRequestIssue() (+18 more)

### Community 16 - "Workflow Control Plane Contracts"
Cohesion: 0.13
Nodes (26): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertAdminWaterfallGrammar(), assertBareControlPlaneTree() (+18 more)

### Community 17 - "Safe Archive Extraction"
Cohesion: 0.14
Nodes (5): extract_archive(), main(), _member_path(), self_test(), _validate_link()

### Community 18 - "Deployment Lifecycle Management"
Cohesion: 0.20
Nodes (26): assertNoProtectedAlias(), assignAliasVerified(), cleanupClosedPrResources(), cleanupComment(), cleanupPrResources(), createGithubDeployment(), dashboardUrl(), deploy() (+18 more)

### Community 19 - "Preview Fallback Handling"
Cohesion: 0.15
Nodes (19): FALLBACK_BRANCH, FALLBACK_HEADER, FALLBACK_MARKER, fallbackDeploymentIssue(), fallbackDomainIssue(), fallbackPage(), fallbackResponseIssue(), installFallbackAliases() (+11 more)

### Community 20 - "Promotion Graph Refresh"
Cohesion: 0.14
Nodes (24): assert_control_metadata_unchanged(), assert_tool_boundary(), current_grafts_state(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT (+16 more)

### Community 21 - "Native Compilation Isolation"
Cohesion: 0.12
Nodes (11): acquire_cleanup_lock(), arm_native(), drop_identity(), extract_candidate(), kernel_groups(), main(), native_deadline(), preflight_failure() (+3 more)

### Community 22 - "CodeQL Pull Request Backfill"
Cohesion: 0.21
Nodes (23): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), analysisSnapshotForPullRequest(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp() (+15 more)

### Community 23 - "Feature Stack Chat and Progress"
Cohesion: 0.16
Nodes (17): answerCommand(), answerQuestion(), CHAT_SYSTEM_PROMPT, safeRunContext(), serveRunChat(), githubJobs(), githubStackPullRequests(), postProgress() (+9 more)

### Community 24 - "Prebuilt Preview Deployment"
Cohesion: 0.19
Nodes (23): choosePreferredDeployment(), chooseStableDevelopDeployment(), classifyPullRequest(), createVercelDeployment(), deploymentIdentityIssue(), deploymentMetadata(), deployPrebuiltOutput(), guardPreviewUpload() (+15 more)

### Community 25 - "Feature Stack Planning"
Cohesion: 0.22
Nodes (18): codeql_dispositions job, review job, review_detect job, review_handoff job, canonicalFeatureStackPlan(), decodeFeatureStackPlan(), exactKeys(), featureStackId() (+10 more)

### Community 26 - "Main Develop Synchronization"
Cohesion: 0.17
Nodes (18): assertHeadContainsMain(), assertSyncPullRequestShape(), exactSha(), EXPECTED_MERGE_REJECTIONS, githubRequest(), GitHubRequestError, headContainsMain(), mergeStandingSyncPullRequest() (+10 more)

### Community 27 - "Pull Request Lifecycle Management"
Cohesion: 0.20
Nodes (16): approved(), eligible(), identity(), managed(), pauses, redundant(), selectPulls(), settle() (+8 more)

### Community 28 - "Promotion Worker Contracts"
Cohesion: 0.14
Nodes (17): BASE_REF, BASE_SHA, compute_plan_hash(), GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay() (+9 more)

### Community 29 - "Conversation Automation Gates"
Cohesion: 0.18
Nodes (7): ci, workflow, classifyConversation(), classifyQueuedConversation(), hasAutomationMarker(), previewSummaryBody(), publishPreviewSummary()

### Community 30 - "Build Runner Isolation"
Cohesion: 0.17
Nodes (14): admit_runner(), build_environment(), firewall_rules(), phase(), require_hosted_runner(), run(), supervise(), as_build() (+6 more)

### Community 31 - "Rebase Conflict Verification"
Cohesion: 0.28
Nodes (14): actionPath, copyTrustedTree(), extractVerifierScript(), filesUnder(), hashNamedFiles(), hashRebaseState(), hashTrustedTree(), makeStoppedRebase() (+6 more)

### Community 32 - "Rebase Conflict Preparation"
Cohesion: 0.28
Nodes (14): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_index_entries(), hash_rebase_state(), rebase_in_progress() (+6 more)

### Community 33 - "Promotion Worker Execution"
Cohesion: 0.37
Nodes (13): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+5 more)

### Community 34 - "Preview Label Management"
Cohesion: 0.24
Nodes (11): colors, ensureLabel(), hasPreviewLabels(), lanes, prefix(), previewBuildTime(), previewBuiltLabel(), syncOnce() (+3 more)

### Community 35 - "Promotion Workflow Routing"
Cohesion: 0.14
Nodes (13): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, featureStackMergeIf, featureStackMergeJob, graphify, lopuAgent (+5 more)

### Community 36 - "Main Develop Synchronization Lane"
Cohesion: 0.15
Nodes (14): Clean Synchronization Lane, develop Branch, GitHub Exact-Head REST Merge, Semantic Graphify Extraction, Local Codex Proxy, Lopu Conflict Resolver, main Branch, PR #475 (+6 more)

### Community 37 - "Graphify Snapshot Staging"
Cohesion: 0.36
Nodes (11): addExisting(), filesUnder(), git(), LEGACY_ROOT, missingFromWorktree(), PORTABLE, removeFromIndex(), restoreTrackedFromHead() (+3 more)

### Community 38 - "Preview Publisher Coordination"
Cohesion: 0.20
Nodes (11): Admin Preview Publisher, Develop Preview Controller, PR #603 Admin Preview Publisher Controller, Protected github-actions Branch, Thingtime GitHub App Bot, PR #595, Per-SHA Deployment Receipts, PR 596 (+3 more)

### Community 39 - "Feature Stack Merge Publishing"
Cohesion: 0.31
Nodes (6): checkDisposition(), publishMerge(), baseSha, fixture(), head, success

### Community 40 - "Build Watchdog Cleanup"
Cohesion: 0.22
Nodes (7): cleanup(), command(), detach_watchdog_io(), process_inventory(), publish_watchdog_evidence(), record_remaining(), start_watchdog()

### Community 41 - "Pull Request Review Queue"
Cohesion: 0.33
Nodes (6): findPendingReview(), pending, reviewScope(), fixture(), run, worker

### Community 42 - "Thingtime API and Data Model"
Cohesion: 0.29
Nodes (8): Agent overview workspace, API utils layer, Authentication sessions, Fundamentals, Lopu toast notifications, Relational appended and child data, Everything-is-a-thing model, Thingtime API

### Community 43 - "Preview Control Plane"
Cohesion: 0.25
Nodes (8): Control-plane CI, Repository-aware Graphify router, Protected prebuilt publisher, Orphan preview deployment cleanup, Preview gateway capability, Saved admin preview retention policy, Storage release gate, Environment gateway policy

### Community 44 - "Preview Recovery Management"
Cohesion: 0.39
Nodes (6): previewWorkActive(), reconcilePreviewInventory(), recoveryAttempt(), recoverySourceIssue(), now, source

### Community 45 - "Rebase Workflow Startup"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 46 - "Electron Release Workflows"
Cohesion: 0.25
Nodes (8): Build Signed and Notarized Electron Release, Build Unsigned Electron Release, Derive SemVer PR Release Identity, Import Developer ID and Notarization Credentials, Resolve and Validate PR Source, Select Release Distribution, Thingtime Electron PR Release Workflow, Electron App Release

### Community 47 - "Promotion Source Verification"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 48 - "Agent Model Routing"
Cohesion: 0.40
Nodes (6): Claude action, Codex action, Saved Thingtime model waterfall, Cooperative review checkpoints, Lopu agent action, Lopu model waterfall

### Community 49 - "HTTP Request Retry Handling"
Cohesion: 0.33
Nodes (5): HttpError, isRetryableHttpResponse(), parseErrorCode(), requestJson(), retryDelayMs()

### Community 50 - "Electron Release Gate Tests"
Cohesion: 0.40
Nodes (5): allowed(), evaluate, expression, main, workflow

### Community 51 - "Pull Request Preview Coordination"
Cohesion: 0.33
Nodes (6): Bounded PR Inventory, Routing Dependency Graph Regression, PR #592, PR #661: Conflict Scans and Visible Previews, Preview Description Helper, Target Ref Race Retry

### Community 52 - "Vercel Deployment Configuration"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 53 - "Native Compilation Isolation Policy"
Cohesion: 0.40
Nodes (5): Candidate source archive, Isolation and network policy gates, Native compile mode, Native compile preflight, Protected unsigned native compilation

### Community 54 - "Deployment URL Validation"
Cohesion: 0.50
Nodes (5): deploymentUrl(), isHostnameLabel(), isS3BucketHostname(), safeCorsProbeUrl(), safeHostname()

### Community 55 - "Rebase Index Fingerprinting"
Cohesion: 0.80
Nodes (4): rawIndexHash(), runGit(), semanticIndexHash(), sha256()

### Community 56 - "Feature Stack Status Reporting"
Cohesion: 0.50
Nodes (5): PR #781 Feature Stack Action Status Responder, Merge Workers, Paired Product/API PR #782, Product Chat Capability, Feature Stack Status Responder

### Community 57 - "Rebase Ownership Routing"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 58 - "Canonical Instruction Conflict Resolution"
Cohesion: 0.83
Nodes (3): resolve-canonical-instruction-type-conflicts.sh script, stage_record(), tree_record()

### Community 59 - "Preview HTML Fallback Rollout"
Cohesion: 0.50
Nodes (4): Fixed HTML Fallback, PR #643 Missing-build Page, Preview Wildcard Domains, Protected Rollout

### Community 60 - "Feature Stack Merge Workflow"
Cohesion: 0.67
Nodes (3): feature_stack_merge job, feature_stack_merge_gate job, feature_stack_plan job

### Community 61 - "Feature Stack Progress Tracking"
Cohesion: 0.67
Nodes (3): Feature Stack Progress Heartbeat Controller, Feature Stack Progress Reporter, Feature Stack Target Workers

### Community 62 - "Preview Manager and Credential Routing"
Cohesion: 0.67
Nodes (3): PR 609 Codex Preview Manager Reliability, Thingtime Credential Vault Router, Lopu Admission Contract

## Ambiguous Edges - Review These
- `Claude action` → `Lopu agent action`  [AMBIGUOUS]
  .github/actions/lopu-agent/action.yml · relation: calls

## Knowledge Gaps
- **127 isolated node(s):** `GIT_ATTR_NOSYSTEM`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_KEY_0`, `GIT_CONFIG_KEY_1` (+122 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 366 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `selfTest()` connect `Promotion Workflow` to `Credential Failure Classification`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `GIT_ATTR_NOSYSTEM`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_GLOBAL` to the rest of the system?**
  _127 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Promotion Workflow` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Why does `reconcileOrphanPreviews()` connect `Orphan Preview Cleanup` to `Admin Preview Deployment`, `Prebuilt Deployment Publishing`, `Develop Preview Deployment`, `Trusted Pull Request Validation`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Should `Admin Preview Deployment` be split into smaller, more focused modules?**
  _Cohesion score 0.07027027027027027 - nodes in this community are weakly interconnected._
- **Should `Graphify Snapshot Management` be split into smaller, more focused modules?**
  _Cohesion score 0.08735733099209833 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Claude action` and `Lopu agent action`?**
  _Edge tagged AMBIGUOUS (relation: calls) - confidence is low._