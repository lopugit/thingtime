# Graph Report - thingtime  (2026-10-30)

## Corpus Check
- 102 files · ~268,371 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 4, .jq 1)

## Summary
- 1469 nodes · 3483 edges · 87 communities (67 shown, 20 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 61 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e8edeaf1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- promote-features-to-main.mjs
- deploy-vercel-prebuilt.mjs
- deploy-admin-pr-previews.mjs
- graphify-cas.mjs
- NativeCompileBoundaryTests
- ref_node_fs
- promotion-pr-changelog.mjs
- deploy-develop-pr-preview.mjs
- preview-fallback.mjs
- build-all-branch.mjs
- lopu-cooperative-review.mjs
- reconcile
- main
- resolve-pr-conflicts-routing-contract.mjs
- lopu-model-waterfall.mjs
- lopu-pr-status.mjs
- workflow-control-plane-contract.mjs
- extract-vercel-prebuilt.py
- runSelfTest
- refresh-promotion-graphify.sh
- Rebase Conflict Round Action
- native-compile-ci.py
- codeql-open-pr-backfill.mjs
- feature-stack-progress.mjs
- merge-main-develop-sync-pr.mjs
- github-actions Control Plane README
- lopu-pr-lifecycle.mjs
- feature-stack-waterfall.test.mjs
- promotion-worker-contract.sh
- control-plane-events.test.mjs
- supervise
- rebase-pr-stacks.yml
- rebase-related-edits.test.mjs
- prepare-round.sh
- promotion-worker.sh
- promotion-worker-routing-contract.mjs
- sync/main-into-develop PR
- Canonical AI Instructions
- stage-graphify-snapshots.mjs
- Review Job
- Resolve PR Conflicts Workflow
- orphan-preview-cleanup.mjs
- cleanup
- Feature Stack Merge Job
- deploymentIdentityIssue
- start.sh
- Select Release Distribution
- Vercel preview cleanup controller
- Thingtime AI instructions
- requestRecoveryBuild
- verify-promotion-source-authority.sh
- Gateway source compatibility admission
- Develop PR Preview Workflow
- ref_node_path
- ref_node_child_process
- vercel.json
- Feature Stack Progress Job
- Feature Stack Status Responder
- electron-release-gates.test.mjs
- rebase-ownership-routing-contract.sh
- resolve-canonical-instruction-type-conflicts.sh
- Reusable rebase PR stacks workflow
- Refresh Graphify outputs after the complete rebase
- Continue replay conflict resolution
- Reusable all-branch workflow
- Lopu conversation gate helper
- Find merge-conflicting PRs
- Feature Stack Progress Reporter
- Lopu internal develop promotion
- Settle reviewed and redundant PRs
- Lopu credential vault helper
- Maintain develop promotion
- Maintain feature promotions
- Maintain main-to-develop synchronization
- GitHub Native Auto-Merge
- Native Compile Workflow
- Lopu PR Status Script
- PR Progress Job
- CodeQL Ownership and Upload Ordering
- Trusted Preview Build and Publish Pipeline
- Protected Native Compilation Runbook
- CodeQL PR handoff workflow
- Commander Release Job
- Maintain CodeQL backfill
- PR #1294 — Remove orphan Vercel previews and reject pre-gateway source
- PR #492 Load Lopu credentials from Thingtime vault
- PR #611 Preview Recovery

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
- `Prebuilt Artifact Acceptance Tests` --conceptually_related_to--> `Protected Publishers`  [INFERRED]
  .github/TESTING.md → README.md
- `Storage Release Gate Tests` --conceptually_related_to--> `Protected Publishers`  [INFERRED]
  .github/TESTING.md → README.md
- `Lopu Agent Composite Action` --conceptually_related_to--> `Agent Overview Reporting`  [INFERRED]
  .github/actions/lopu-agent/action.yml → AGENTS.md
- `Lopu Agent Composite Action` --conceptually_related_to--> `Get It Done Agent Policy`  [INFERRED]
  .github/actions/lopu-agent/action.yml → AGENTS.md
- `Thingtime Credential Vault Router` --conceptually_related_to--> `Lopu Agent Composite Action`  [INFERRED]
  PRs/609-codex-preview-manager-reliability.md → .github/actions/lopu-agent/action.yml

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Shared CI provider routing contract** — github_workflows_promote_develop_to_main_route, github_workflows_promote_features_to_main_route [EXTRACTED 0.80]
- **develop→main promotion and back-sync automation** — github_workflows_promote_develop_to_main_workflow, github_workflows_promote_features_to_main_workflow, github_scripts_promote_features_to_main, github_scripts_promotion_pr_changelog [EXTRACTED 0.85]
- **Validation Check Suite** — prs_506_codex_auto_merge_main_develop_sync_pr_pr_506, prs_506_codex_auto_merge_main_develop_sync_pr_self_tests, prs_506_codex_auto_merge_main_develop_sync_pr_graphify_extraction, prs_506_codex_auto_merge_main_develop_sync_pr_local_codex_proxy [EXTRACTED 0.85]
- **Admin Preview Publication Flow** — prs_603_codex_admin_preview_publisher_controller_admin_preview_publisher, prs_603_codex_admin_preview_publisher_controller_github_actions_branch, prs_642_vercel_deployment [EXTRACTED 0.90]
- **Operational Proof Gate** — prs_506_codex_auto_merge_main_develop_sync_pr_pr_475, prs_506_codex_auto_merge_main_develop_sync_pr_protected_lopu_entrypoint, prs_506_codex_auto_merge_main_develop_sync_pr_sync_main_into_develop_pr, prs_506_codex_auto_merge_main_develop_sync_pr_main_branch, prs_506_codex_auto_merge_main_develop_sync_pr_develop_branch [EXTRACTED 0.90]
- **Paired Status Responder Rollout** — prs_781_codex_stack_progress_chat_controller_answer_feature_stack_status_questions_status_responder, prs_781_codex_stack_progress_chat_controller_answer_feature_stack_status_questions_product_chat_capability, prs_781_codex_stack_progress_chat_controller_answer_feature_stack_status_questions_product_api_pr_782 [EXTRACTED 0.90]
- **Terminal Merge Safety Gate** — prs_506_codex_auto_merge_main_develop_sync_pr_trusted_terminal_merger, prs_506_codex_auto_merge_main_develop_sync_pr_thingtime_repository, prs_506_codex_auto_merge_main_develop_sync_pr_sync_main_into_develop_pr, prs_506_codex_auto_merge_main_develop_sync_pr_develop_branch, prs_506_codex_auto_merge_main_develop_sync_pr_main_branch, prs_506_codex_auto_merge_main_develop_sync_pr_exact_head_rest_merge [EXTRACTED 0.90]
- **Lopu Protected Automation** — readme_lopu_manager, readme_lopu_agent_action, readme_github_actions_lopu_model_waterfall [EXTRACTED 0.94]
- **Commander Signed Release Pipeline** — github_workflows_commander_release_release [EXTRACTED 0.95]
- **Cooperative Review Handover Flow** — prs_637_codex_lopu_cooperative_handoff_safely_hand_batch_reviews_over_to_waiting_work_cooperative_handover_protocol, prs_637_codex_lopu_cooperative_handoff_safely_hand_batch_reviews_over_to_waiting_work_pr_637 [EXTRACTED 0.95]
- **Electron Release Distribution Flow** — github_workflows_electron_pr_release_resolve_validate_pr_source, github_workflows_electron_pr_release_select_release_distribution, github_workflows_electron_pr_release_derive_semver_pr_release_identity, github_workflows_electron_pr_release_build_signed_release, github_workflows_electron_pr_release_build_unsigned_release [EXTRACTED 0.95]
- **Feature Stack Progress Reporting** — prs_534_codex_feature_stack_progress_heartbeats_controller, prs_534_codex_feature_stack_progress_heartbeats_controller_reporter, prs_534_codex_feature_stack_progress_heartbeats_controller_target_workers [EXTRACTED 0.95]
- **PR #661 Delivery Reliability Repairs** — prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_pr_661, prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_dependency_graph_regression, prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_bounded_pr_inventory, prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_ref_race_retry [EXTRACTED 0.95]
- **Missing-build Preview Rollout** — prs_643_codex_preview_no_build_page_show_a_no_build_page_for_unassigned_pr_preview_urls_preview_wildcard_domains, prs_643_codex_preview_no_build_page_show_a_no_build_page_for_unassigned_pr_preview_urls_fixed_html_fallback, prs_643_codex_preview_no_build_page_show_a_no_build_page_for_unassigned_pr_preview_urls_protected_rollout [EXTRACTED 0.95]
- **Scheduled Preview Recovery Flow** — prs_642_preview_status_recovery, prs_642_scheduled_controller, prs_642_deployment_receipts, prs_642_vercel_deployment [EXTRACTED 0.95]
- **CodeQL Ownership and Upload Coordination** — .github_workflows_codeql_analysis_scope, .github_workflows_codeql_analysis_preinit, .github_workflows_codeql_analysis_sibling_barrier, .github_workflows_codeql_analysis_hold_fast_upload, .github_workflows_codeql_analysis_confirm_ownership [EXTRACTED 0.96]
- **Control Plane Regression and Live Acceptance** — github_testing_orphan_preview_cleanup, github_testing_storage_release_gate, github_testing_prebuilt_artifact, github_testing_native_compile [EXTRACTED 0.96]
- **PR conflict resolution and progress reporting flow** — .github_workflows_resolve_pr_conflicts_resolver_workflow, .github_workflows_resolve_pr_conflicts_read_live_stats, .github_workflows_resolve_pr_conflicts_sync_progress_labels, .github_workflows_resolve_pr_conflicts_update_progress [EXTRACTED 0.96]
- **Trusted PR Preview Pipeline** — .github_workflows_develop_pr_preview_dispatch, .github_workflows_develop_pr_preview_prepare, .github_workflows_develop_pr_preview_build, .github_workflows_develop_pr_preview_controller [EXTRACTED 0.96]
- **Centralized PR management workflow** — github_workflows_resolve_pr_conflicts_yml_route, github_workflows_resolve_pr_conflicts_yml_manage_rebases, github_workflows_resolve_pr_conflicts_yml_detect, github_workflows_resolve_pr_conflicts_yml_handoff, github_workflows_resolve_pr_conflicts_yml_lifecycle, github_workflows_resolve_pr_conflicts_yml_maintain_all_branch [EXTRACTED 0.98]
- **Isolated Rebase Conflict Resolution Flow** — .github_actions_rebase_conflict_round_bootstrap, .github_actions_rebase_conflict_round_prepare, .github_actions_rebase_conflict_round_lopu, .github_actions_rebase_conflict_round_verify, .github_actions_rebase_conflict_round_cleanup [EXTRACTED 0.98]
- **Protected CI and Publication Flow** — readme_thin_listeners, readme_protected_publishers, readme_environment_gateway_policy, readme_preview_controller [EXTRACTED 0.98]
- **Verified rebase publication flow** — github_workflows_rebase_pr_stacks_yml_verify_the_complete_local_rebase, github_workflows_rebase_pr_stacks_yml_validate_every_tracked_symlink_before_graphify, github_workflows_rebase_pr_stacks_yml_refresh_graphify_outputs_after_the_complete_rebase, github_workflows_rebase_pr_stacks_yml_stamp_exact_lopu_rebase_provenance_on_the_rewritten_tip, github_workflows_rebase_pr_stacks_yml_revalidate_live_refs_and_final_local_state, github_workflows_rebase_pr_stacks_yml_force_push_the_fully_verified_rewritten_history_once, github_workflows_rebase_pr_stacks_yml_verify_the_published_ref [EXTRACTED 0.99]
- **Evidence-Bound CodeQL Disposition Flow** — .github_workflows_resolve_pr_conflicts_review, .github_workflows_resolve_pr_conflicts_codeql_dispositions, .github_workflows_resolve_pr_conflicts_codeql_handoff [EXTRACTED 1.00]
- **Feature Stack Verified Merge Flow** — .github_workflows_resolve_pr_conflicts_feature_stack_plan, .github_workflows_resolve_pr_conflicts_feature_stack_merge, .github_workflows_resolve_pr_conflicts_feature_stack_merge_gate [EXTRACTED 1.00]
- **Serialized Lopu Review Flow** — .github_workflows_resolve_pr_conflicts_review_detect, .github_workflows_resolve_pr_conflicts_review_handoff, .github_workflows_resolve_pr_conflicts_review [EXTRACTED 1.00]
- **Gateway compatibility admission for preview publishers** — prs_1294_codex_vercel_orphan_preview_cleanup_three_preview_publishers, prs_1294_codex_vercel_orphan_preview_cleanup_gateway_compatibility, prs_1294_codex_vercel_orphan_preview_cleanup_mongo_authority_fence, prs_1294_codex_vercel_orphan_preview_cleanup_gateway_ingress_middleware, prs_1294_codex_vercel_orphan_preview_cleanup_authority_implementation, prs_1294_codex_vercel_orphan_preview_cleanup_connection_policy [EXTRACTED 1.00]
- **Vercel preview orphan sweep and safeguards** — prs_1294_codex_vercel_orphan_preview_cleanup_controller, prs_1294_codex_vercel_orphan_preview_cleanup_deployment_inventory, prs_1294_codex_vercel_orphan_preview_cleanup_exact_id_deletion, prs_1294_codex_vercel_orphan_preview_cleanup_alias_protection, prs_1294_codex_vercel_orphan_preview_cleanup_pr_lifecycle [EXTRACTED 1.00]
- **Control Plane Agent Governance and Reporting** — agents_global_question_policy, agents_agent_overview_reporting, agents_thingtime_character_coordination, github_actions_lopu_agent_action [INFERRED 0.78]

## Communities (87 total, 20 thin omitted)

### Community 0 - "promote-features-to-main.mjs"
Cohesion: 0.05
Nodes (133): applyPicks(), attestationMatches(), botCommentsByLatestEvent(), buildPromotionDispatchRequest(), buildPromotionPlanContext(), cancelPromotionRetirement(), CFG, checkoutRemoteBranch() (+125 more)

### Community 1 - "deploy-vercel-prebuilt.mjs"
Cohesion: 0.09
Nodes (62): Production Storage Runtime Monitor, Web CI Workflow, applyOutputPolicy(), visit(), assertGatewaySource(), assertPreviewOpen(), compatibilityAliasCandidates(), context() (+54 more)

### Community 2 - "deploy-admin-pr-previews.mjs"
Cohesion: 0.07
Nodes (66): ACTIVE_STATES, assertCurrentPullRequest(), assertPrebuiltOutput(), assignAlias(), boundedInteger(), cleanupDeploymentIssue(), cleanupEnvironment(), commentBody() (+58 more)

### Community 3 - "graphify-cas.mjs"
Cohesion: 0.09
Nodes (60): activateSnapshot(), artifactHash(), baselineNodeCount(), compareSnapshotQuality(), computeSourceFingerprint(), copyPortableFiles(), DEFAULT_SNAPSHOT_RETENTION, dropNestedRepositories() (+52 more)

### Community 5 - "ref_node_fs"
Cohesion: 0.09
Nodes (18): CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest(), allowed, workflow (+10 more)

### Community 6 - "promotion-pr-changelog.mjs"
Cohesion: 0.12
Nodes (41): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+33 more)

### Community 7 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.09
Nodes (31): ACTIVE_STATES, assertPrebuiltOutput(), assertPreviewMaster(), assertVercelConfiguration(), assertWildcardFallbackRuntimes(), CLEANUP_ACTIONS, developRefSha(), execFileAsync (+23 more)

### Community 8 - "preview-fallback.mjs"
Cohesion: 0.09
Nodes (30): FALLBACK_BRANCH, FALLBACK_HEADER, FALLBACK_MARKER, fallbackDeploymentIssue(), fallbackDomainIssue(), fallbackPage(), fallbackResponseIssue(), installFallbackAliases() (+22 more)

### Community 9 - "build-all-branch.mjs"
Cohesion: 0.16
Nodes (36): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), completeRefspecs, countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode() (+28 more)

### Community 10 - "lopu-cooperative-review.mjs"
Cohesion: 0.11
Nodes (28): checkpoint(), completedReport(), continuationNumbers(), finalize(), git(), HANDOVER_INSTRUCTIONS, initialize(), numbers() (+20 more)

### Community 11 - "reconcile"
Cohesion: 0.15
Nodes (30): choosePreferredDeployment(), cleanupClosedPrResources(), cleanupComment(), cleanupDeployments(), cleanupPrResources(), createGithubDeployment(), dashboardUrl(), deploy() (+22 more)

### Community 12 - "main"
Cohesion: 0.16
Nodes (25): assertCurrentPullRequest(), assertPreviewBundle(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), boundedInteger(), dispatchPullRequestIssue() (+17 more)

### Community 13 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.12
Nodes (26): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertCapturedStdoutStaysClean(), assertRoute(), assertWorkflowSource(), CALLS_HELPER(), decodeBatch() (+18 more)

### Community 14 - "lopu-model-waterfall.mjs"
Cohesion: 0.15
Nodes (31): models, exportBundle(), fetchBundle(), legacyCredentials(), main(), required(), safeCache(), validate() (+23 more)

### Community 15 - "lopu-pr-status.mjs"
Cohesion: 0.17
Nodes (25): argument(), branchCode(), classifyInventory(), count(), dateParts(), desiredFactLabels(), escapeHtml(), FACT_LABEL_ORDER (+17 more)

### Community 16 - "workflow-control-plane-contract.mjs"
Cohesion: 0.13
Nodes (26): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertAdminWaterfallGrammar(), assertBareControlPlaneTree() (+18 more)

### Community 17 - "extract-vercel-prebuilt.py"
Cohesion: 0.14
Nodes (5): extract_archive(), main(), _member_path(), self_test(), _validate_link()

### Community 18 - "runSelfTest"
Cohesion: 0.14
Nodes (25): assertCustomDevelopEnvironment(), assertNoProtectedAlias(), cancelAndDeleteDeployment(), chooseStableDevelopDeployment(), classifyPullRequest(), createVercelDeployment(), customEnvironmentDomainNames(), deploymentMetadata() (+17 more)

### Community 19 - "refresh-promotion-graphify.sh"
Cohesion: 0.14
Nodes (24): assert_control_metadata_unchanged(), assert_tool_boundary(), current_grafts_state(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT (+16 more)

### Community 20 - "Rebase Conflict Round Action"
Cohesion: 0.11
Nodes (24): Rebase Conflict Round Action, Mark Credentialed AI Attempt, Bootstrap Trusted Round Code, Wipe Scratch and Restore Action, Continue Claude Session, Resolve Conflicts with Lopu, Prepare Conflict Scratch, Verify Scratch and Continue Rebase (+16 more)

### Community 21 - "native-compile-ci.py"
Cohesion: 0.12
Nodes (11): acquire_cleanup_lock(), arm_native(), drop_identity(), extract_candidate(), kernel_groups(), main(), native_deadline(), preflight_failure() (+3 more)

### Community 22 - "codeql-open-pr-backfill.mjs"
Cohesion: 0.21
Nodes (23): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), analysisSnapshotForPullRequest(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp() (+15 more)

### Community 23 - "feature-stack-progress.mjs"
Cohesion: 0.27
Nodes (12): githubJobs(), githubStackPullRequests(), postProgress(), progressSnapshot(), reconcile(), recoveryPayload(), run(), selfTest() (+4 more)

### Community 24 - "merge-main-develop-sync-pr.mjs"
Cohesion: 0.17
Nodes (18): assertHeadContainsMain(), assertSyncPullRequestShape(), exactSha(), EXPECTED_MERGE_REJECTIONS, githubRequest(), GitHubRequestError, headContainsMain(), mergeStandingSyncPullRequest() (+10 more)

### Community 25 - "github-actions Control Plane README"
Cohesion: 0.12
Nodes (17): Protected Native Compilation Tests, Orphan Preview Cleanup Tests, Prebuilt Artifact Acceptance Tests, Storage Release Gate Tests, Commander Signed Release Pipeline, Electron and Recovery Release Pipeline, Environment Gateway Policy, github-actions Control Plane README (+9 more)

### Community 26 - "lopu-pr-lifecycle.mjs"
Cohesion: 0.20
Nodes (16): approved(), eligible(), identity(), managed(), pauses, redundant(), selectPulls(), settle() (+8 more)

### Community 27 - "feature-stack-waterfall.test.mjs"
Cohesion: 0.32
Nodes (14): canonicalFeatureStackPlan(), decodeFeatureStackPlan(), exactKeys(), featureStackId(), git(), selfTest(), validateWaterfall(), verifyFeatureStackHistory() (+6 more)

### Community 28 - "promotion-worker-contract.sh"
Cohesion: 0.14
Nodes (17): BASE_REF, BASE_SHA, compute_plan_hash(), GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay() (+9 more)

### Community 29 - "control-plane-events.test.mjs"
Cohesion: 0.24
Nodes (5): ci, workflow, classifyConversation(), classifyQueuedConversation(), hasAutomationMarker()

### Community 30 - "supervise"
Cohesion: 0.17
Nodes (14): admit_runner(), build_environment(), firewall_rules(), phase(), require_hosted_runner(), run(), supervise(), as_build() (+6 more)

### Community 31 - "rebase-pr-stacks.yml"
Cohesion: 0.12
Nodes (14): Clean up after a pre-push failure, Clean up after post-publication failure, Dispatch Web CI for a rewritten web diff, Force-push verified rewritten history once, Queue repository maintenance after the rebase fleet settles, Release current PR and report success, Requeue after a moving-ref rebase race, Revalidate live refs and final local state (+6 more)

### Community 32 - "rebase-related-edits.test.mjs"
Cohesion: 0.28
Nodes (14): actionPath, copyTrustedTree(), extractVerifierScript(), filesUnder(), hashNamedFiles(), hashRebaseState(), hashTrustedTree(), makeStoppedRebase() (+6 more)

### Community 33 - "prepare-round.sh"
Cohesion: 0.28
Nodes (14): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_index_entries(), hash_rebase_state(), rebase_in_progress() (+6 more)

### Community 34 - "promotion-worker.sh"
Cohesion: 0.37
Nodes (13): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+5 more)

### Community 35 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.14
Nodes (13): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, featureStackMergeIf, featureStackMergeJob, graphify, lopuAgent (+5 more)

### Community 36 - "sync/main-into-develop PR"
Cohesion: 0.15
Nodes (14): Clean Synchronization Lane, develop Branch, GitHub Exact-Head REST Merge, Semantic Graphify Extraction, Local Codex Proxy, Lopu Conflict Resolver, main Branch, PR #475 (+6 more)

### Community 37 - "Canonical AI Instructions"
Cohesion: 0.18
Nodes (12): Agent Overview Reporting, Canonical AI Instructions, Global AI Instruction Symlinks, Get It Done Agent Policy, Graphify Workflow, Thingtime Character Coordination, Thingtime Data and API Conventions, Canonical AI Instructions (+4 more)

### Community 38 - "stage-graphify-snapshots.mjs"
Cohesion: 0.36
Nodes (11): addExisting(), filesUnder(), git(), LEGACY_ROOT, missingFromWorktree(), PORTABLE, removeFromIndex(), restoreTrackedFromHead() (+3 more)

### Community 39 - "Review Job"
Cohesion: 0.22
Nodes (11): CodeQL Dispositions Job, Evidence-Bound CodeQL Disposition Handoff, Dispatch Review Worker Step, Feature Stack Publish Merge Script, Lopu Conversation Gate Script, Lopu Cooperative Review Script, Lopu Review Queue Helper, Review Job (+3 more)

### Community 40 - "Resolve PR Conflicts Workflow"
Cohesion: 0.06
Nodes (35): encode_ref, read_jobs, read_live_stats, Resolve PR Conflicts Workflow, sync_progress_label_subset, sync_progress_labels, update_progress, Control Plane Changelog (+27 more)

### Community 41 - "orphan-preview-cleanup.mjs"
Cohesion: 0.23
Nodes (16): ACTIVE, assertPreviewHasOpenPullRequest(), completeInventory(), idOf(), missing(), openBranchPullRequests(), orphaned(), previewIdentity() (+8 more)

### Community 42 - "cleanup"
Cohesion: 0.22
Nodes (7): cleanup(), command(), detach_watchdog_io(), process_inventory(), publish_watchdog_evidence(), record_remaining(), start_watchdog()

### Community 43 - "Feature Stack Merge Job"
Cohesion: 0.36
Nodes (8): Feature Stack Workflow, Feature Stack Merge Job, Feature Stack Merge Gate Job, Feature Stack Plan Job, Feature Stack Plan Script, Feature Stack Waterfall Script, Model Configuration Job, Promotion Resolution Job

### Community 44 - "deploymentIdentityIssue"
Cohesion: 0.24
Nodes (13): assignAliasVerified(), deploymentDetail(), deploymentIdentityIssue(), deploymentListParams(), getAliasBinding(), getOwnedAlias(), listDeploymentSummaries(), listStableDevelopDeployments() (+5 more)

### Community 45 - "start.sh"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 46 - "Select Release Distribution"
Cohesion: 0.25
Nodes (8): Build Signed and Notarized Electron Release, Build Unsigned Electron Release, Derive SemVer PR Release Identity, Import Developer ID and Notarization Credentials, Resolve and Validate PR Source, Select Release Distribution, Thingtime Electron PR Release Workflow, Electron App Release

### Community 47 - "Vercel preview cleanup controller"
Cohesion: 0.29
Nodes (8): Production and custom alias protection, Vercel preview cleanup controller, Controller activation and live acceptance, Vercel deployment inventory, Develop PR preview workflow, Exact deployment ID deletion and 404 readback, PR lifecycle safeguards, Verification evidence and boundaries

### Community 48 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 49 - "requestRecoveryBuild"
Cohesion: 0.24
Nodes (10): expectedReadyAt(), expectedReadyForRun(), optionalEnv(), requestRecoveryBuild(), previewWorkActive(), reconcilePreviewInventory(), recoveryAttempt(), recoverySourceIssue() (+2 more)

### Community 50 - "verify-promotion-source-authority.sh"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 51 - "Gateway source compatibility admission"
Cohesion: 0.29
Nodes (7): Authority implementation, Explicit connection policy, Gateway source compatibility admission, Gateway ingress middleware, Mongo pre-connect authority fence, Prebuilt feature publication lifecycle, Three preview publishers

### Community 52 - "Develop PR Preview Workflow"
Cohesion: 0.53
Nodes (6): Vercel Prebuilt Deployment Workflow, Develop PR Preview Workflow, Build PR Preview Bundle, Publish Develop PR Preview, Dispatch Preview Controller, Authorize Preview Source

### Community 53 - "ref_node_path"
Cohesion: 0.21
Nodes (9): answerCommand(), answerQuestion(), CHAT_SYSTEM_PROMPT, safeRunContext(), serveRunChat(), rawIndexHash(), runGit(), semanticIndexHash() (+1 more)

### Community 54 - "ref_node_child_process"
Cohesion: 0.31
Nodes (6): checkDisposition(), publishMerge(), baseSha, fixture(), head, success

### Community 55 - "vercel.json"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 56 - "Feature Stack Progress Job"
Cohesion: 0.40
Nodes (5): Feature Stack Chat Script, Feature Stack Progress Job, Feature Stack Progress Script, Feature Stack Receipt Reconciliation Job, Lopu Credential Vault Script

### Community 57 - "Feature Stack Status Responder"
Cohesion: 0.50
Nodes (5): PR #781 Feature Stack Action Status Responder, Merge Workers, Paired Product/API PR #782, Product Chat Capability, Feature Stack Status Responder

### Community 58 - "electron-release-gates.test.mjs"
Cohesion: 0.40
Nodes (5): allowed(), evaluate, expression, main, workflow

### Community 59 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 60 - "resolve-canonical-instruction-type-conflicts.sh"
Cohesion: 0.83
Nodes (3): resolve-canonical-instruction-type-conflicts.sh script, stage_record(), tree_record()

### Community 62 - "Reusable rebase PR stacks workflow"
Cohesion: 0.67
Nodes (3): Dispatch exact child transplants, Manage rebases, Reusable rebase PR stacks workflow

### Community 63 - "Refresh Graphify outputs after the complete rebase"
Cohesion: 0.67
Nodes (3): Graphify credential router, Graphify snapshot stager, Refresh Graphify outputs after the complete rebase

### Community 64 - "Continue replay conflict resolution"
Cohesion: 0.67
Nodes (3): Continue replay conflict resolution, Rebase conflict round action, Rebase conflict round inputs

### Community 65 - "Reusable all-branch workflow"
Cohesion: 0.67
Nodes (3): Reusable all-branch workflow, Hand off all-branch rebuild, Maintain all branch

### Community 66 - "Lopu conversation gate helper"
Cohesion: 0.67
Nodes (3): Conversation gate, Lopu conversation gate helper, Route PR management request

### Community 67 - "Find merge-conflicting PRs"
Cohesion: 0.67
Nodes (3): Find merge-conflicting PRs, Hand off selected PR batch, Lopu PR status helper

### Community 68 - "Feature Stack Progress Reporter"
Cohesion: 0.67
Nodes (3): Feature Stack Progress Heartbeat Controller, Feature Stack Progress Reporter, Feature Stack Target Workers

## Ambiguous Edges - Review These
- `storage-release-gate.mjs` → `Resolve PR Conflicts Workflow`  [AMBIGUOUS]
  .github/workflows/resolve-pr-conflicts.yml · relation: references
- `encode_ref` → `update_progress`  [AMBIGUOUS]
  .github/workflows/resolve-pr-conflicts.yml · relation: references
- `read_jobs` → `update_progress`  [AMBIGUOUS]
  .github/workflows/resolve-pr-conflicts.yml · relation: references
- `Feature Stack Plan Script` → `Promotion Resolution Job`  [AMBIGUOUS]
  .github/workflows/resolve-pr-conflicts.yml · relation: references

## Knowledge Gaps
- **159 isolated node(s):** `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR`, `BASE_REF`, `BASE_SHA` (+154 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 405 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Resolve PR Conflicts Workflow` connect `Resolve PR Conflicts Workflow` to `deploy-vercel-prebuilt.mjs`, `ref_node_fs`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **What connects `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR` to the rest of the system?**
  _159 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `promote-features-to-main.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `deploy-vercel-prebuilt.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.08647936786654961 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `storage-release-gate.mjs` and `Resolve PR Conflicts Workflow`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `encode_ref` and `update_progress`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `read_jobs` and `update_progress`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._