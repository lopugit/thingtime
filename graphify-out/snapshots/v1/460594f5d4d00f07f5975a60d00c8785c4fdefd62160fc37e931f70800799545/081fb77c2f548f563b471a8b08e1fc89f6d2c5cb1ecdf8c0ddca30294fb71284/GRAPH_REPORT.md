# Graph Report - thingtime  (2026-10-27)

## Corpus Check
- 97 files · ~259,326 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 4, .jq 1)

## Summary
- 1489 nodes · 3374 edges · 117 communities (76 shown, 41 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 38 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `84042679`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- promote-features-to-main.mjs
- deploy-develop-pr-preview.mjs
- deploy-admin-pr-previews.mjs
- graphify-cas.mjs
- PR #643 — Missing-build page for unassigned PR preview URLs
- lopu-model-waterfall.mjs
- lopu-pr-lifecycle.mjs
- promotion-pr-changelog.mjs
- build-all-branch.mjs
- lopu-cooperative-review.mjs
- resolve-pr-conflicts-routing-contract.mjs
- lopu-pr-status.mjs
- workflow-control-plane-contract.mjs
- preview-fallback.mjs
- refresh-promotion-graphify.sh
- codeql-open-pr-backfill.mjs
- extract-vercel-prebuilt.py
- ref_node_crypto
- merge-main-develop-sync-pr.mjs
- .cleanup_state
- promotion-worker-contract.sh
- feature-stack-waterfall.test.mjs
- PR #603 — Admin preview publisher controller
- native-compile-ci.py
- prepare-round.sh
- promotion-worker.sh
- reconcile
- promotion-worker-routing-contract.mjs
- Control-plane regression checklist
- sync/main-into-develop PR
- `github-actions` — the CI control plane
- Thingtime AI instructions
- Thingtime AI instructions
- stage-graphify-snapshots.mjs
- control-plane-events.test.mjs
- Lopu Agent Action
- PR #609 — Restore Lopu and preview admission
- start.sh
- Select Release Distribution
- Resolve Promotion
- verify-promotion-source-authority.sh
- PR #534 — Feature Stack progress heartbeat controller
- Lopu Protected Repository Manager
- deploy-vercel-prebuilt.mjs
- PR #506 — Auto-merge resolved main to develop sync PR
- Feature Stack Status Responder
- vercel.json
- Classify Web CI Scope Job
- preview-labels.mjs
- Conflict Detector Job
- PR #492 — Load Lopu credentials from the Thingtime vault
- rebase-ownership-routing-contract.sh
- resolve-canonical-instruction-type-conflicts.sh
- Lopu PR Manager Workflow
- Guarded Push
- ref_node_child_process
- Control-plane changelog
- Exact Head Preview Publication
- CodeQL Analyze Job
- Lopu internal develop promotion
- Collect Residual Conflicts
- Review Detector Job
- GitHub Native Auto-Merge
- Cooperative Handover Protocol
- CodeQL Analysis Workflow
- CodeQL PR handoff workflow
- Commander Release Job
- Workflow Control-Plane CI
- Contract Advisories Job
- Lopu PR Lifecycle Workflow
- Stack Rebase Detection Job
- Stack Rebase Handoff Job
- Conversation Gate Job
- Feature Stack Merge Gate Job
- Feature Stack Plan Job
- Feature Stack Progress Job
- Finalize Conflict Batch Maintenance
- PR Lifecycle Job
- CodeQL Backfill Job
- Develop Promotion Maintenance Job
- Feature Promotions Maintenance Job
- Main to Develop Sync Job
- Merge Verified Main to Develop Sync PR
- Recheck Target After Publication
- Promotion Validation Job
- Route Job
- Synchronize Lopu Label Subset
- Verify Credential Vault Job
- PR #611 Preview Recovery
- main
- 1225-codex-gateway-publisher-policy-publish-controlled-environment-gateway-owners.md
- PR #642: Discoverable preview status and missed-build repair
- PR #634: Lopu comment admission and idempotent preview writes
- rebase-related-edits.test.mjs
- PR #661: conflict scans and visible previews
- runSelfTest
- PR #637: Safe cooperative handover for Lopu reviews
- [Unreleased]
- Prebuilt-only deployments (2026-10-23)
- PR 1017: GitHub Lopu admin model waterfall
- ref_node_url
- feature-stack-progress.mjs
- CHANGELOG.md
- NativeCompileBoundaryTests
- supervise
- Protected unsigned native compilation
- ref_node_fs
- codex-gateway-alias-propagation-standard-preview-target.md
- cleanup
- Controller Job
- Thingtime Agent Instructions
- preview-recovery.test.mjs

## God Nodes (most connected - your core abstractions)
1. `runPromotion()` - 64 edges
2. `runSelfTest()` - 54 edges
3. `NativeCompileBoundaryTests` - 53 edges
4. `selfTest()` - 53 edges
5. `reconcile()` - 36 edges
6. `failureDetail()` - 28 edges
7. `deploy()` - 27 edges
8. `supervise()` - 23 edges
9. `main()` - 22 edges
10. `Control-plane changelog` - 22 edges

## Surprising Connections (you probably didn't know these)
- `Thingtime Agent Instructions` --references--> `Control-plane regression checklist`  [EXTRACTED]
  AGENTS.md → .github/TESTING.md
- `Lopu Agent Action` --implements--> `Lopu Protected Repository Manager`  [INFERRED]
  .github/actions/lopu-agent/action.yml → README.md
- `Control-plane regression checklist` --references--> `Saved Admin Model Waterfall`  [EXTRACTED]
  .github/TESTING.md → README.md
- `All Branch Workflow` --references--> `Lopu Agent Action`  [AMBIGUOUS]
  .github/workflows/all-branch.yml → .github/actions/lopu-agent/action.yml
- `Control-plane regression checklist` --references--> `Rebase Conflict Round Action`  [INFERRED]
  .github/TESTING.md → .github/actions/rebase-conflict-round/action.yml

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Shared CI provider routing contract** — github_workflows_promote_develop_to_main_route, github_workflows_promote_features_to_main_route [EXTRACTED 0.80]
- **develop→main promotion and back-sync automation** — github_workflows_promote_develop_to_main_workflow, github_workflows_promote_features_to_main_workflow, github_scripts_promote_features_to_main, github_scripts_promotion_pr_changelog [EXTRACTED 0.85]
- **Validation Check Suite** — prs_506_codex_auto_merge_main_develop_sync_pr_pr_506, prs_506_codex_auto_merge_main_develop_sync_pr_self_tests, prs_506_codex_auto_merge_main_develop_sync_pr_graphify_extraction, prs_506_codex_auto_merge_main_develop_sync_pr_local_codex_proxy [EXTRACTED 0.85]
- **Admin Preview Publication Flow** — prs_603_codex_admin_preview_publisher_controller_admin_preview_publisher, prs_603_codex_admin_preview_publisher_controller_github_actions_branch, prs_642_vercel_deployment [EXTRACTED 0.90]
- **Lopu Protected Automation System** — concept_lopu_control_plane, concept_lopu_model_waterfall, github_actions_lopu_agent, github_actions_rebase_conflict_round [EXTRACTED 0.90]
- **Operational Proof Gate** — prs_506_codex_auto_merge_main_develop_sync_pr_pr_475, prs_506_codex_auto_merge_main_develop_sync_pr_protected_lopu_entrypoint, prs_506_codex_auto_merge_main_develop_sync_pr_sync_main_into_develop_pr, prs_506_codex_auto_merge_main_develop_sync_pr_main_branch, prs_506_codex_auto_merge_main_develop_sync_pr_develop_branch [EXTRACTED 0.90]
- **Ordinary PR Resolution Flow** — github_workflows_resolve_pr_conflicts_resolve, github_workflows_resolve_pr_conflicts_lopu_agent, github_workflows_resolve_pr_conflicts_graphify, github_workflows_resolve_pr_conflicts_progress [EXTRACTED 0.90]
- **Paired Status Responder Rollout** — prs_781_codex_stack_progress_chat_controller_answer_feature_stack_status_questions_status_responder, prs_781_codex_stack_progress_chat_controller_answer_feature_stack_status_questions_product_chat_capability, prs_781_codex_stack_progress_chat_controller_answer_feature_stack_status_questions_product_api_pr_782 [EXTRACTED 0.90]
- **PR Resolution Reporting Flow** — github_workflows_resolve_pr_conflicts_comment_resolved, github_workflows_resolve_pr_conflicts_collect_residual_conflicts, github_workflows_resolve_pr_conflicts_comment_needs_attention [EXTRACTED 0.90]
- **Terminal Merge Safety Gate** — prs_506_codex_auto_merge_main_develop_sync_pr_trusted_terminal_merger, prs_506_codex_auto_merge_main_develop_sync_pr_thingtime_repository, prs_506_codex_auto_merge_main_develop_sync_pr_sync_main_into_develop_pr, prs_506_codex_auto_merge_main_develop_sync_pr_develop_branch, prs_506_codex_auto_merge_main_develop_sync_pr_main_branch, prs_506_codex_auto_merge_main_develop_sync_pr_exact_head_rest_merge [EXTRACTED 0.90]
- **Protected Resolver Control Plane** — github_workflows_resolve_pr_conflicts_route, github_workflows_resolve_pr_conflicts_detect, github_workflows_resolve_pr_conflicts_handoff, github_workflows_resolve_pr_conflicts_model_config [EXTRACTED 0.93]
- **Admin Selected Preview Delivery Flow** — github_workflows_develop_pr_preview_admin_prepare, github_workflows_develop_pr_preview_admin_build, github_workflows_develop_pr_preview_admin_controller, concept_preview_publication [EXTRACTED 0.95]
- **Single-Owner CodeQL Analysis Flow** — github_workflows_codeql_analysis, github_workflows_codeql_analysis_scope, github_workflows_codeql_analysis_analyze [EXTRACTED 0.95]
- **Commander Signed Release Pipeline** — github_workflows_commander_release_release [EXTRACTED 0.95]
- **Cooperative Review Handover Flow** — prs_637_codex_lopu_cooperative_handoff_safely_hand_batch_reviews_over_to_waiting_work_cooperative_handover_protocol, prs_637_codex_lopu_cooperative_handoff_safely_hand_batch_reviews_over_to_waiting_work_pr_637 [EXTRACTED 0.95]
- **Protected Develop Preview Delivery Flow** — github_workflows_develop_pr_preview_prepare, github_workflows_develop_pr_preview_build, github_workflows_develop_pr_preview_controller, concept_preview_publication [EXTRACTED 0.95]
- **Electron Release Distribution Flow** — github_workflows_electron_pr_release_resolve_validate_pr_source, github_workflows_electron_pr_release_select_release_distribution, github_workflows_electron_pr_release_derive_semver_pr_release_identity, github_workflows_electron_pr_release_build_signed_release, github_workflows_electron_pr_release_build_unsigned_release [EXTRACTED 0.95]
- **Immutable Feature Stack Flow** — github_workflows_resolve_pr_conflicts_feature_stack_plan, github_workflows_resolve_pr_conflicts_feature_stack_merge, github_workflows_resolve_pr_conflicts_feature_stack_progress, github_workflows_resolve_pr_conflicts_feature_stack_merge_gate [EXTRACTED 0.95]
- **Feature Stack Progress Reporting** — prs_534_codex_feature_stack_progress_heartbeats_controller, prs_534_codex_feature_stack_progress_heartbeats_controller_reporter, prs_534_codex_feature_stack_progress_heartbeats_controller_target_workers [EXTRACTED 0.95]
- **Guarded PR Publication Flow** — github_workflows_resolve_pr_conflicts_push, github_workflows_resolve_pr_conflicts_post_publish, github_workflows_resolve_pr_conflicts_requeue_ref_race [EXTRACTED 0.95]
- **Lopu Agent Fleet Serialization** — github_workflows_all_branch_rebuild, github_workflows_rebase_pr_stacks_rebase, github_workflows_resolve_pr_conflicts [EXTRACTED 0.95]
- **PR #661 Delivery Reliability Repairs** — prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_pr_661_conflict_scans_and_visible_previews, prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_dependency_graph_regression, prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_bounded_pr_inventory, prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_ref_race_retry [EXTRACTED 0.95]
- **Missing-build Preview Rollout** — prs_643_codex_preview_no_build_page_show_a_no_build_page_for_unassigned_pr_preview_urls_preview_wildcard_domains, prs_643_codex_preview_no_build_page_show_a_no_build_page_for_unassigned_pr_preview_urls_fixed_html_fallback, prs_643_codex_preview_no_build_page_show_a_no_build_page_for_unassigned_pr_preview_urls_protected_rollout [EXTRACTED 0.95]
- **Scheduled Preview Recovery Flow** — prs_642_preview_status_recovery, prs_642_scheduled_controller, prs_642_deployment_receipts, prs_642_vercel_deployment [EXTRACTED 0.95]
- **Verified Promotion Resolution Flow** — github_workflows_resolve_pr_conflicts_resolve_promotion, github_workflows_resolve_pr_conflicts_promotion_worker, github_workflows_resolve_pr_conflicts_rebase_conflict_round, github_workflows_resolve_pr_conflicts_refresh_promotion_graphify [EXTRACTED 0.95]
- **Verified Rebase Conflict Resolution Flow** — github_actions_rebase_conflict_round, concept_rebase_scratch_verification, github_actions_lopu_agent [EXTRACTED 0.95]
- **Serialized PR Review Flow** — github_workflows_resolve_pr_conflicts_review_detect, github_workflows_resolve_pr_conflicts_review_handoff, github_workflows_resolve_pr_conflicts_model_config, github_workflows_resolve_pr_conflicts_review [EXTRACTED 0.96]
- **Canonical Instruction Alias Layout** — agents_instructions, ai_all_instructions, claude_instructions [EXTRACTED 1.00]

## Communities (117 total, 41 thin omitted)

### Community 0 - "promote-features-to-main.mjs"
Cohesion: 0.05
Nodes (133): applyPicks(), attestationMatches(), botCommentsByLatestEvent(), buildPromotionDispatchRequest(), buildPromotionPlanContext(), cancelPromotionRetirement(), CFG, checkoutRemoteBranch() (+125 more)

### Community 1 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.08
Nodes (42): ACTIVE_STATES, assertPrebuiltOutput(), assertPreviewMaster(), assertVercelConfiguration(), assertWildcardFallbackRuntimes(), CLEANUP_ACTIONS, deploymentDetail(), deploymentListParams() (+34 more)

### Community 2 - "deploy-admin-pr-previews.mjs"
Cohesion: 0.08
Nodes (64): ACTIVE_STATES, assertCurrentPullRequest(), assertPrebuiltOutput(), assignAlias(), boundedInteger(), cleanupDeploymentIssue(), cleanupEnvironment(), commentBody() (+56 more)

### Community 3 - "graphify-cas.mjs"
Cohesion: 0.09
Nodes (60): activateSnapshot(), artifactHash(), baselineNodeCount(), compareSnapshotQuality(), computeSourceFingerprint(), copyPortableFiles(), DEFAULT_SNAPSHOT_RETENTION, dropNestedRepositories() (+52 more)

### Community 4 - "PR #643 — Missing-build page for unassigned PR preview URLs"
Cohesion: 0.22
Nodes (8): Cause and scope, Fixed HTML Fallback, PR #643 Missing-build Page, PR #643 — Missing-build page for unassigned PR preview URLs, Preview Wildcard Domains, Protected Rollout, Root response decision, Verification before merge

### Community 5 - "lopu-model-waterfall.mjs"
Cohesion: 0.12
Nodes (37): models, CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest(), exportBundle() (+29 more)

### Community 6 - "lopu-pr-lifecycle.mjs"
Cohesion: 0.20
Nodes (16): approved(), eligible(), identity(), managed(), pauses, redundant(), selectPulls(), settle() (+8 more)

### Community 7 - "promotion-pr-changelog.mjs"
Cohesion: 0.12
Nodes (41): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+33 more)

### Community 8 - "build-all-branch.mjs"
Cohesion: 0.16
Nodes (36): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), completeRefspecs, countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode() (+28 more)

### Community 9 - "lopu-cooperative-review.mjs"
Cohesion: 0.11
Nodes (28): checkpoint(), completedReport(), continuationNumbers(), finalize(), git(), HANDOVER_INSTRUCTIONS, initialize(), numbers() (+20 more)

### Community 10 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.12
Nodes (26): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertCapturedStdoutStaysClean(), assertRoute(), assertWorkflowSource(), CALLS_HELPER(), decodeBatch() (+18 more)

### Community 11 - "lopu-pr-status.mjs"
Cohesion: 0.17
Nodes (25): argument(), branchCode(), classifyInventory(), count(), dateParts(), desiredFactLabels(), escapeHtml(), FACT_LABEL_ORDER (+17 more)

### Community 12 - "workflow-control-plane-contract.mjs"
Cohesion: 0.13
Nodes (26): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertAdminWaterfallGrammar(), assertBareControlPlaneTree() (+18 more)

### Community 13 - "preview-fallback.mjs"
Cohesion: 0.15
Nodes (19): FALLBACK_BRANCH, FALLBACK_HEADER, FALLBACK_MARKER, fallbackDeploymentIssue(), fallbackDomainIssue(), fallbackPage(), fallbackResponseIssue(), installFallbackAliases() (+11 more)

### Community 14 - "refresh-promotion-graphify.sh"
Cohesion: 0.14
Nodes (24): assert_control_metadata_unchanged(), assert_tool_boundary(), current_grafts_state(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT (+16 more)

### Community 15 - "codeql-open-pr-backfill.mjs"
Cohesion: 0.21
Nodes (23): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), analysisSnapshotForPullRequest(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp() (+15 more)

### Community 16 - "extract-vercel-prebuilt.py"
Cohesion: 0.14
Nodes (5): extract_archive(), main(), _member_path(), self_test(), _validate_link()

### Community 17 - "ref_node_crypto"
Cohesion: 0.60
Nodes (4): rawIndexHash(), runGit(), semanticIndexHash(), sha256()

### Community 18 - "merge-main-develop-sync-pr.mjs"
Cohesion: 0.17
Nodes (18): assertHeadContainsMain(), assertSyncPullRequestShape(), exactSha(), EXPECTED_MERGE_REJECTIONS, githubRequest(), GitHubRequestError, headContainsMain(), mergeStandingSyncPullRequest() (+10 more)

### Community 20 - "promotion-worker-contract.sh"
Cohesion: 0.14
Nodes (17): BASE_REF, BASE_SHA, compute_plan_hash(), GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay() (+9 more)

### Community 21 - "feature-stack-waterfall.test.mjs"
Cohesion: 0.32
Nodes (14): canonicalFeatureStackPlan(), decodeFeatureStackPlan(), exactKeys(), featureStackId(), git(), selfTest(), validateWaterfall(), verifyFeatureStackHistory() (+6 more)

### Community 22 - "PR #603 — Admin preview publisher controller"
Cohesion: 0.13
Nodes (15): Admin Preview Publisher, Compatibility fix, Develop Preview Controller, Protected github-actions Branch, Thingtime GitHub App Bot, Outcome, PR #595, PR #603 — Admin preview publisher controller (+7 more)

### Community 23 - "native-compile-ci.py"
Cohesion: 0.13
Nodes (8): authority_drop(), drop_identity(), extract_candidate(), kernel_groups(), main(), preflight_failure(), trusted_failure(), validate_source()

### Community 24 - "prepare-round.sh"
Cohesion: 0.28
Nodes (14): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_index_entries(), hash_rebase_state(), rebase_in_progress() (+6 more)

### Community 25 - "promotion-worker.sh"
Cohesion: 0.37
Nodes (13): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+5 more)

### Community 26 - "reconcile"
Cohesion: 0.15
Nodes (33): assignAliasVerified(), choosePreferredDeployment(), cleanupComment(), cleanupDeployments(), cleanupPrResources(), createGithubDeployment(), dashboardUrl(), deploy() (+25 more)

### Community 27 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.14
Nodes (13): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, featureStackMergeIf, featureStackMergeJob, graphify, lopuAgent (+5 more)

### Community 28 - "Control-plane regression checklist"
Cohesion: 0.17
Nodes (12): Configured cross-provider waterfall, Control-plane regression checklist, Cooperative review handover, Event feedback and CI cancellation, Exact configured workflow model orders, Explicit stack model and endpoint waterfall, Feature Stack run status conversations, Feature Stack snapshot publication and merge gates (+4 more)

### Community 29 - "sync/main-into-develop PR"
Cohesion: 0.15
Nodes (14): Clean Synchronization Lane, develop Branch, GitHub Exact-Head REST Merge, Semantic Graphify Extraction, Local Codex Proxy, Lopu Conflict Resolver, main Branch, PR #475 (+6 more)

### Community 30 - "`github-actions` — the CI control plane"
Cohesion: 0.12
Nodes (16): Commander signed releases, Desktop and Recovery release pipeline, Discoverable preview status and recovery, Fork setup: Vercel develop previews, `github-actions` — the CI control plane, Known trade-off, Lopu principal repository manager, macOS signing and build identity (+8 more)

### Community 31 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 32 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 33 - "stage-graphify-snapshots.mjs"
Cohesion: 0.36
Nodes (11): addExisting(), filesUnder(), git(), LEGACY_ROOT, missingFromWorktree(), PORTABLE, removeFromIndex(), restoreTrackedFromHead() (+3 more)

### Community 34 - "control-plane-events.test.mjs"
Cohesion: 0.31
Nodes (5): ci, workflow, classifyConversation(), classifyQueuedConversation(), hasAutomationMarker()

### Community 35 - "Lopu Agent Action"
Cohesion: 0.31
Nodes (9): Saved Admin Model Waterfall, Isolated Rebase Scratch Verification, Lopu Agent Action, Rebase Conflict Round Action, Rebuild All Branch Job, Stack Rebase Worker Job, Feature Stack Merge Job, Model Configuration Job (+1 more)

### Community 36 - "PR #609 — Restore Lopu and preview admission"
Cohesion: 0.22
Nodes (8): Follow-up acceptance repair, Live diagnosis, Outcome, PR #609 — Restore Lopu and preview admission, Security boundary, Validation, Thingtime Credential Vault Router, Lopu Admission Contract

### Community 37 - "start.sh"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 38 - "Select Release Distribution"
Cohesion: 0.25
Nodes (8): Build Signed and Notarized Electron Release, Build Unsigned Electron Release, Derive SemVer PR Release Identity, Import Developer ID and Notarization Credentials, Resolve and Validate PR Source, Select Release Distribution, Thingtime Electron PR Release Workflow, Electron App Release

### Community 39 - "Resolve Promotion"
Cohesion: 0.25
Nodes (8): Graphify Refresh, Lopu Agent Composite Action, PR Progress Monitor, Promotion Worker Script, Rebase Conflict Round Action, Promotion Graphify Refresh Script, Resolve PR, Resolve Promotion

### Community 40 - "verify-promotion-source-authority.sh"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 41 - "PR #534 — Feature Stack progress heartbeat controller"
Cohesion: 0.29
Nodes (7): Feature Stack Progress Heartbeat Controller, Outcome, PR #534 — Feature Stack progress heartbeat controller, Feature Stack Progress Reporter, Safety and cost, Feature Stack Target Workers, Validation

### Community 42 - "Lopu Protected Repository Manager"
Cohesion: 0.33
Nodes (6): Graphify Content-addressed Snapshots, Lopu Protected Repository Manager, All Branch Workflow, All Branch Event Handoff Job, Maintain All Branch Job, GitHub Actions Control Plane Documentation

### Community 43 - "deploy-vercel-prebuilt.mjs"
Cohesion: 0.15
Nodes (37): applyOutputPolicy(), visit(), compatibilityAliasCandidates(), context(), deploymentArgs(), deploymentIssue(), exec, existing() (+29 more)

### Community 44 - "PR #506 — Auto-merge resolved main to develop sync PR"
Cohesion: 0.33
Nodes (5): Operational proof gate, PR #506 — Auto-merge resolved main to develop sync PR, Problem, Resolution, Validation

### Community 45 - "Feature Stack Status Responder"
Cohesion: 0.40
Nodes (5): Merge Workers, PR #781 — Feature Stack action status responder, Paired Product/API PR #782, Product Chat Capability, Feature Stack Status Responder

### Community 46 - "vercel.json"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 47 - "Classify Web CI Scope Job"
Cohesion: 0.40
Nodes (5): API Suite Job, Build Typecheck Ratchet Unit Tests Job, Product Contract Advisories, Classify Web CI Scope Job, Web CI Workflow

### Community 48 - "preview-labels.mjs"
Cohesion: 0.24
Nodes (11): colors, ensureLabel(), hasPreviewLabels(), lanes, prefix(), previewBuildTime(), previewBuiltLabel(), syncOnce() (+3 more)

### Community 49 - "Conflict Detector Job"
Cohesion: 0.40
Nodes (5): Conflict Detector Job, Ensure Lopu Label Definitions, Ensure Progress Comment, GitHub Read Retry Helper, Resolver Handoff Job

### Community 50 - "PR #492 — Load Lopu credentials from the Thingtime vault"
Cohesion: 0.40
Nodes (4): PR #492 — Load Lopu credentials from the Thingtime vault, Safety and regression focus, Scope, Validation log

### Community 51 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 52 - "resolve-canonical-instruction-type-conflicts.sh"
Cohesion: 0.83
Nodes (3): resolve-canonical-instruction-type-conflicts.sh script, stage_record(), tree_record()

### Community 53 - "Lopu PR Manager Workflow"
Cohesion: 0.50
Nodes (4): Rebase PR Stacks Workflow, Lopu PR Manager Workflow, Apply Lopu CodeQL Dispositions, Manage Rebases Job

### Community 54 - "Guarded Push"
Cohesion: 0.50
Nodes (4): Cascade to Stacked PRs, Comment on Resolved PR, Guarded Push, Requeue After Moving Ref Race

### Community 55 - "ref_node_child_process"
Cohesion: 0.31
Nodes (6): checkDisposition(), publishMerge(), baseSha, fixture(), head, success

### Community 56 - "Control-plane changelog"
Cohesion: 0.10
Nodes (20): 2026-09-05 — Cooperative review handover and preview recovery, 2026-09-05 — Desktop and Recovery cloud release repair, 2026-09-05 — Signed Commander releases and Recovery pairing, 2026-09-05 — Visible previews and conflict detector recovery, 2026-10-18 — Correct reusable workflow context, 2026-10-18 — Diagnose OpenAI preflight failures safely, 2026-10-18 — Execute the saved admin AI waterfall, 2026-10-23 — Build every Vercel deployment on GitHub Actions (+12 more)

### Community 90 - "main"
Cohesion: 0.15
Nodes (26): assertCurrentPullRequest(), assertPreviewBundle(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), boundedInteger(), classifyPullRequest() (+18 more)

### Community 92 - "PR #642: Discoverable preview status and missed-build repair"
Cohesion: 0.40
Nodes (4): Changes, Evidence and cause, PR #642: Discoverable preview status and missed-build repair, Validation and rollout

### Community 93 - "PR #634: Lopu comment admission and idempotent preview writes"
Cohesion: 0.29
Nodes (7): Control-Plane Verification Job, PR 634 Comment Admission Hardening, Behavior, Evidence and scope, PR #634: Lopu comment admission and idempotent preview writes, Rollout, Validation

### Community 94 - "rebase-related-edits.test.mjs"
Cohesion: 0.28
Nodes (14): actionPath, copyTrustedTree(), extractVerifierScript(), filesUnder(), hashNamedFiles(), hashRebaseState(), hashTrustedTree(), makeStoppedRebase() (+6 more)

### Community 95 - "PR #661: conflict scans and visible previews"
Cohesion: 0.33
Nodes (6): Bounded PR Inventory, Routing Dependency Graph Regression, PR #592, PR #661: conflict scans and visible previews, Preview Description Helper, Target Ref Race Retry

### Community 96 - "runSelfTest"
Cohesion: 0.14
Nodes (27): assertCustomDevelopEnvironment(), assertNoProtectedAlias(), cancelAndDeleteDeployment(), chooseStableDevelopDeployment(), createVercelDeployment(), customEnvironmentDomainNames(), deploymentIdentityIssue(), deploymentMetadata() (+19 more)

### Community 97 - "PR #637: Safe cooperative handover for Lopu reviews"
Cohesion: 0.33
Nodes (5): PR #611 recovery, PR #637: Safe cooperative handover for Lopu reviews, Protocol, Scope and evidence, Validation

### Community 98 - "[Unreleased]"
Cohesion: 0.50
Nodes (4): Added, Changed, Fixed, [Unreleased]

### Community 99 - "Prebuilt-only deployments (2026-10-23)"
Cohesion: 0.29
Nodes (7): Environment gateway publication, Existing workflow preflight verification, Native control continuity and bounded bootstrap, Prebuilt-only deployments (2026-10-23), Preview receipt runner context (2026-10-26), Protected native compilation, Published PR gateway API acceptance (2026-10-26)

### Community 100 - "PR 1017: GitHub Lopu admin model waterfall"
Cohesion: 0.67
Nodes (3): Post Agent Semantic Graphify Refresh, OpenAI Vault Credentials, PR 1017: GitHub Lopu admin model waterfall

### Community 101 - "ref_node_url"
Cohesion: 0.22
Nodes (6): assertPrReleaseContract(), count(), here, workflow, postPublishRefRace(), snapshot

### Community 102 - "feature-stack-progress.mjs"
Cohesion: 0.27
Nodes (12): githubJobs(), githubStackPullRequests(), postProgress(), progressSnapshot(), reconcile(), recoveryPayload(), run(), selfTest() (+4 more)

### Community 103 - "CHANGELOG.md"
Cohesion: 0.27
Nodes (3): Bound native negative-authority supervision, Control-plane regression checks, Native negative-authority supervision

### Community 105 - "supervise"
Cohesion: 0.14
Nodes (18): admit_runner(), arm_native(), build_environment(), detach_watchdog_io(), firewall_rules(), native_deadline(), phase(), publish_watchdog_evidence() (+10 more)

### Community 106 - "Protected unsigned native compilation"
Cohesion: 0.29
Nodes (7): Admission and entry point, Current acceptance limit, Darwin credential verification and trusted failures, Enforced network policy and cleanup, Protected unsigned native compilation, Trust boundary, Validation and acceptance

### Community 107 - "ref_node_fs"
Cohesion: 0.10
Nodes (16): allowed, workflow, allowed(), evaluate, expression, main, workflow, answerCommand() (+8 more)

### Community 109 - "cleanup"
Cohesion: 0.20
Nodes (8): acquire_cleanup_lock(), authority_probe(), cleanup(), command(), process_inventory(), record_remaining(), run(), start_owned_command()

### Community 111 - "Controller Job"
Cohesion: 0.67
Nodes (4): Build Job, Controller Job, Dispatch Job, Prepare Job

### Community 112 - "Thingtime Agent Instructions"
Cohesion: 0.67
Nodes (3): Thingtime Agent Instructions, Canonical AI Instructions, Claude Compatibility Instructions

### Community 113 - "preview-recovery.test.mjs"
Cohesion: 0.39
Nodes (6): previewWorkActive(), reconcilePreviewInventory(), recoveryAttempt(), recoverySourceIssue(), now, source

## Ambiguous Edges - Review These
- `deploy-admin-pr-previews.mjs` → `Admin Controller Job`  [AMBIGUOUS]
  .github/workflows/develop-pr-preview.yml · relation: calls
- `Lopu Agent Action` → `All Branch Workflow`  [AMBIGUOUS]
  .github/workflows/all-branch.yml · relation: references

## Knowledge Gaps
- **121 isolated node(s):** `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR`, `BASE_REF`, `BASE_SHA` (+116 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 473 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **41 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Controller Job` connect `Controller Job` to `extract-vercel-prebuilt.py`, `deploy-develop-pr-preview.mjs`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **What connects `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR` to the rest of the system?**
  _121 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `promote-features-to-main.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Why does `NativeCompileBoundaryTests` connect `NativeCompileBoundaryTests` to `.command_fixture`, `extract-vercel-prebuilt.py`, `.make_archive`, `.test_darwin_kernel_groups_use_fixed_public_symbol_and_exact_count`, `.cleanup_state`, `.test_kernel_accessor_reads_only_current_process_without_identity_mutation`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Should `deploy-develop-pr-preview.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.07777777777777778 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `deploy-admin-pr-previews.mjs` and `Admin Controller Job`?**
  _Edge tagged AMBIGUOUS (relation: calls) - confidence is low._
- **What is the exact relationship between `Lopu Agent Action` and `All Branch Workflow`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._