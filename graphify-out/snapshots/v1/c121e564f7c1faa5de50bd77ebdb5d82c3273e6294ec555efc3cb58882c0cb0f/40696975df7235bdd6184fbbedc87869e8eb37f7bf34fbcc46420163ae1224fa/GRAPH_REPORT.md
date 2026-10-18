# Graph Report - thingtime  (2026-10-18)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1271 nodes · 2916 edges · 91 communities (57 shown, 34 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 25 edges (avg confidence: 0.84)
- Token cost: 3,541 input · 696 output

## Graph Freshness
- Built from commit: `3bc0f69d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Promotion Workflow Tests
- Develop Preview Deployment
- Admin Preview Deployment
- Graphify Snapshot Management
- Control Plane Changelog
- Credential Vault Models
- Feature Stack Progress
- Promotion PR Changelog
- All Branch Builder
- Cooperative Review Handover
- Conflict Resolution Routing
- PR Status Reporting
- Control Plane Contracts
- Preview Fallback Pages
- Promotion Graph Refresh
- CodeQL PR Backfill
- Secure Vercel Extraction
- Feature Stack Chat
- Main Develop Sync Merge
- Preview Race Tests
- Promotion Worker Contract
- Feature Stack Planning
- Admin Preview Publisher
- Rebase Edit Verification
- Rebase Round Preparation
- Promotion Worker Script
- Preview Label Management
- Promotion Worker Routing
- Control Plane Testing
- Repository Automation Architecture
- Control Plane Documentation
- Agent Instructions
- Claude Compatibility Instructions
- Graphify Snapshot Staging
- Control Plane Events
- Saved Model Waterfall
- Preview Manager Reliability
- Rebase Conflict Startup
- Electron Release Workflow
- PR Resolution Components
- Promotion Source Verification
- Stack Progress Heartbeat
- Graphify Control Plane
- Electron Release Gates
- Main Develop Sync Automation
- Stack Status Responder
- Vercel Configuration
- Web CI Workflow
- Electron PR Release Contract
- Conflict Resolution Jobs
- Credential Vault Controller
- Rebase Ownership Routing
- Instruction Conflict Resolution
- PR Rebase Management
- Stacked PR Cascading
- AI Instruction Files
- Preview Recovery UX
- Exact Head Preview
- CodeQL Analysis Jobs
- Lopu Promotion Workflows
- Residual Conflict Collection
- Review Handoff Jobs
- GitHub Auto Merge
- Cooperative Handover Protocol
- CodeQL Analysis Workflow
- CodeQL PR Handoff
- Commander Release Job
- Control Plane CI
- Contract Advisories Job
- Lopu PR Lifecycle
- Stack Rebase Detection
- Stack Rebase Handoff
- Conversation Gate Job
- Stack Merge Gate
- Stack Plan Job
- Stack Progress Job
- Conflict Batch Finalization
- PR Lifecycle Job
- CodeQL Backfill Job
- Develop Promotion Maintenance
- Feature Promotion Maintenance
- Main Develop Sync
- Verified Sync Merge
- Publication Target Recheck
- Promotion Validation Job
- Workflow Routing Job
- Lopu Label Synchronization
- Credential Vault Verification
- Preview Recovery
- Workflow Verification Checklist

## God Nodes (most connected - your core abstractions)
1. `runPromotion()` - 64 edges
2. `selfTest()` - 53 edges
3. `reconcile()` - 34 edges
4. `runSelfTest()` - 34 edges
5. `failureDetail()` - 28 edges
6. `deploy()` - 27 edges
7. `main()` - 22 edges
8. `orphanedMergeHydrationIntegrationTest()` - 21 edges
9. `githubRequest()` - 18 edges
10. `main()` - 17 edges

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

## Communities (91 total, 34 thin omitted)

### Community 0 - "Promotion Workflow Tests"
Cohesion: 0.05
Nodes (133): applyPicks(), attestationMatches(), botCommentsByLatestEvent(), buildPromotionDispatchRequest(), buildPromotionPlanContext(), cancelPromotionRetirement(), CFG, checkoutRemoteBranch() (+125 more)

### Community 1 - "Develop Preview Deployment"
Cohesion: 0.05
Nodes (119): ACTIVE_STATES, assertCurrentPullRequest(), assertPrebuiltOutput(), assertPreviewBundle(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack() (+111 more)

### Community 2 - "Admin Preview Deployment"
Cohesion: 0.08
Nodes (65): ACTIVE_STATES, assertCurrentPullRequest(), assertPrebuiltOutput(), assignAlias(), boundedInteger(), cleanupDeploymentIssue(), cleanupEnvironment(), commentBody() (+57 more)

### Community 3 - "Graphify Snapshot Management"
Cohesion: 0.09
Nodes (60): activateSnapshot(), artifactHash(), baselineNodeCount(), compareSnapshotQuality(), computeSourceFingerprint(), copyPortableFiles(), DEFAULT_SNAPSHOT_RETENTION, dropNestedRepositories() (+52 more)

### Community 4 - "Control Plane Changelog"
Cohesion: 0.04
Nodes (43): 2026-09-05 — Cooperative review handover and preview recovery, 2026-09-05 — Desktop and Recovery cloud release repair, 2026-09-05 — Signed Commander releases and Recovery pairing, 2026-09-05 — Visible previews and conflict detector recovery, 2026-10-18 — Execute the saved admin AI waterfall, Added, Changed, Control-plane changelog (+35 more)

### Community 5 - "Credential Vault Models"
Cohesion: 0.12
Nodes (37): models, CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest(), exportBundle() (+29 more)

### Community 6 - "Feature Stack Progress"
Cohesion: 0.09
Nodes (34): githubJobs(), githubStackPullRequests(), postProgress(), progressSnapshot(), reconcile(), recoveryPayload(), run(), selfTest() (+26 more)

### Community 7 - "Promotion PR Changelog"
Cohesion: 0.12
Nodes (41): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+33 more)

### Community 8 - "All Branch Builder"
Cohesion: 0.16
Nodes (36): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), completeRefspecs, countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode() (+28 more)

### Community 9 - "Cooperative Review Handover"
Cohesion: 0.11
Nodes (28): checkpoint(), completedReport(), continuationNumbers(), finalize(), git(), HANDOVER_INSTRUCTIONS, initialize(), numbers() (+20 more)

### Community 10 - "Conflict Resolution Routing"
Cohesion: 0.12
Nodes (26): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertCapturedStdoutStaysClean(), assertRoute(), assertWorkflowSource(), CALLS_HELPER(), decodeBatch() (+18 more)

### Community 11 - "PR Status Reporting"
Cohesion: 0.17
Nodes (25): argument(), branchCode(), classifyInventory(), count(), dateParts(), desiredFactLabels(), escapeHtml(), FACT_LABEL_ORDER (+17 more)

### Community 12 - "Control Plane Contracts"
Cohesion: 0.13
Nodes (26): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertAdminWaterfallGrammar(), assertBareControlPlaneTree() (+18 more)

### Community 13 - "Preview Fallback Pages"
Cohesion: 0.14
Nodes (18): FALLBACK_BRANCH, FALLBACK_HEADER, FALLBACK_MARKER, fallbackDeploymentIssue(), fallbackDomainIssue(), fallbackPage(), installFallbackAliases(), publishedPreviewResponseIssue() (+10 more)

### Community 14 - "Promotion Graph Refresh"
Cohesion: 0.14
Nodes (24): assert_control_metadata_unchanged(), assert_tool_boundary(), current_grafts_state(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT (+16 more)

### Community 15 - "CodeQL PR Backfill"
Cohesion: 0.21
Nodes (23): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), analysisSnapshotForPullRequest(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp() (+15 more)

### Community 16 - "Secure Vercel Extraction"
Cohesion: 0.15
Nodes (9): extract_archive(), main(), _member_path(), self_test(), _validate_link(), Build Job, Controller Job, Dispatch Job (+1 more)

### Community 17 - "Feature Stack Chat"
Cohesion: 0.14
Nodes (9): allowed, workflow, answerCommand(), answerQuestion(), CHAT_SYSTEM_PROMPT, safeRunContext(), serveRunChat(), script (+1 more)

### Community 18 - "Main Develop Sync Merge"
Cohesion: 0.17
Nodes (18): assertHeadContainsMain(), assertSyncPullRequestShape(), exactSha(), EXPECTED_MERGE_REJECTIONS, githubRequest(), GitHubRequestError, headContainsMain(), mergeStandingSyncPullRequest() (+10 more)

### Community 19 - "Preview Race Tests"
Cohesion: 0.19
Nodes (8): postPublishRefRace(), snapshot, previewSummaryBody(), publishPreviewSummary(), rawIndexHash(), runGit(), semanticIndexHash(), sha256()

### Community 20 - "Promotion Worker Contract"
Cohesion: 0.14
Nodes (17): BASE_REF, BASE_SHA, compute_plan_hash(), GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay() (+9 more)

### Community 21 - "Feature Stack Planning"
Cohesion: 0.32
Nodes (14): canonicalFeatureStackPlan(), decodeFeatureStackPlan(), exactKeys(), featureStackId(), git(), selfTest(), validateWaterfall(), verifyFeatureStackHistory() (+6 more)

### Community 22 - "Admin Preview Publisher"
Cohesion: 0.13
Nodes (15): Admin Preview Publisher, Compatibility fix, Develop Preview Controller, Protected github-actions Branch, Thingtime GitHub App Bot, Outcome, PR #595, PR #603 — Admin preview publisher controller (+7 more)

### Community 23 - "Rebase Edit Verification"
Cohesion: 0.28
Nodes (14): actionPath, copyTrustedTree(), extractVerifierScript(), filesUnder(), hashNamedFiles(), hashRebaseState(), hashTrustedTree(), makeStoppedRebase() (+6 more)

### Community 24 - "Rebase Round Preparation"
Cohesion: 0.28
Nodes (14): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_index_entries(), hash_rebase_state(), rebase_in_progress() (+6 more)

### Community 25 - "Promotion Worker Script"
Cohesion: 0.37
Nodes (13): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+5 more)

### Community 26 - "Preview Label Management"
Cohesion: 0.24
Nodes (11): colors, ensureLabel(), hasPreviewLabels(), lanes, prefix(), previewBuildTime(), previewBuiltLabel(), syncOnce() (+3 more)

### Community 27 - "Promotion Worker Routing"
Cohesion: 0.14
Nodes (13): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, featureStackMergeIf, featureStackMergeJob, graphify, lopuAgent (+5 more)

### Community 28 - "Control Plane Testing"
Cohesion: 0.14
Nodes (12): Configured cross-provider waterfall, Control-plane regression checklist, Cooperative review handover, Event feedback and CI cancellation, Exact configured workflow model orders, Explicit stack model and endpoint waterfall, Feature Stack run status conversations, Feature Stack snapshot publication and merge gates (+4 more)

### Community 29 - "Repository Automation Architecture"
Cohesion: 0.15
Nodes (14): Clean Synchronization Lane, develop Branch, GitHub Exact-Head REST Merge, Semantic Graphify Extraction, Local Codex Proxy, Lopu Conflict Resolver, main Branch, PR #475 (+6 more)

### Community 30 - "Control Plane Documentation"
Cohesion: 0.15
Nodes (13): Commander signed releases, Desktop and Recovery release pipeline, Fork setup: Vercel develop previews, `github-actions` — the CI control plane, Known trade-off, Lopu principal repository manager, macOS signing and build identity, PR delivery regression checks (+5 more)

### Community 31 - "Agent Instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 32 - "Claude Compatibility Instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 33 - "Graphify Snapshot Staging"
Cohesion: 0.36
Nodes (11): addExisting(), filesUnder(), git(), LEGACY_ROOT, missingFromWorktree(), PORTABLE, removeFromIndex(), restoreTrackedFromHead() (+3 more)

### Community 34 - "Control Plane Events"
Cohesion: 0.31
Nodes (5): ci, workflow, classifyConversation(), classifyQueuedConversation(), hasAutomationMarker()

### Community 35 - "Saved Model Waterfall"
Cohesion: 0.31
Nodes (9): Saved Admin Model Waterfall, Isolated Rebase Scratch Verification, Lopu Agent Action, Rebase Conflict Round Action, Rebuild All Branch Job, Stack Rebase Worker Job, Feature Stack Merge Job, Model Configuration Job (+1 more)

### Community 36 - "Preview Manager Reliability"
Cohesion: 0.22
Nodes (8): Follow-up acceptance repair, Live diagnosis, Outcome, PR #609 — Restore Lopu and preview admission, Security boundary, Validation, Thingtime Credential Vault Router, Lopu Admission Contract

### Community 37 - "Rebase Conflict Startup"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 38 - "Electron Release Workflow"
Cohesion: 0.25
Nodes (8): Build Signed and Notarized Electron Release, Build Unsigned Electron Release, Derive SemVer PR Release Identity, Import Developer ID and Notarization Credentials, Resolve and Validate PR Source, Select Release Distribution, Thingtime Electron PR Release Workflow, Electron App Release

### Community 39 - "PR Resolution Components"
Cohesion: 0.25
Nodes (8): Graphify Refresh, Lopu Agent Composite Action, PR Progress Monitor, Promotion Worker Script, Rebase Conflict Round Action, Promotion Graphify Refresh Script, Resolve PR, Resolve Promotion

### Community 40 - "Promotion Source Verification"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 41 - "Stack Progress Heartbeat"
Cohesion: 0.29
Nodes (7): Feature Stack Progress Heartbeat Controller, Outcome, PR #534 — Feature Stack progress heartbeat controller, Feature Stack Progress Reporter, Safety and cost, Feature Stack Target Workers, Validation

### Community 42 - "Graphify Control Plane"
Cohesion: 0.33
Nodes (6): Graphify Content-addressed Snapshots, Lopu Protected Repository Manager, All Branch Workflow, All Branch Event Handoff Job, Maintain All Branch Job, GitHub Actions Control Plane Documentation

### Community 43 - "Electron Release Gates"
Cohesion: 0.40
Nodes (5): allowed(), evaluate, expression, main, workflow

### Community 44 - "Main Develop Sync Automation"
Cohesion: 0.33
Nodes (5): Operational proof gate, PR #506 — Auto-merge resolved main to develop sync PR, Problem, Resolution, Validation

### Community 45 - "Stack Status Responder"
Cohesion: 0.40
Nodes (5): Merge Workers, PR #781 — Feature Stack action status responder, Paired Product/API PR #782, Product Chat Capability, Feature Stack Status Responder

### Community 46 - "Vercel Configuration"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 47 - "Web CI Workflow"
Cohesion: 0.40
Nodes (5): API Suite Job, Build Typecheck Ratchet Unit Tests Job, Product Contract Advisories, Classify Web CI Scope Job, Web CI Workflow

### Community 48 - "Electron PR Release Contract"
Cohesion: 0.50
Nodes (4): assertPrReleaseContract(), count(), here, workflow

### Community 49 - "Conflict Resolution Jobs"
Cohesion: 0.40
Nodes (5): Conflict Detector Job, Ensure Lopu Label Definitions, Ensure Progress Comment, GitHub Read Retry Helper, Resolver Handoff Job

### Community 50 - "Credential Vault Controller"
Cohesion: 0.40
Nodes (4): PR #492 — Load Lopu credentials from the Thingtime vault, Safety and regression focus, Scope, Validation log

### Community 51 - "Rebase Ownership Routing"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 52 - "Instruction Conflict Resolution"
Cohesion: 0.83
Nodes (3): resolve-canonical-instruction-type-conflicts.sh script, stage_record(), tree_record()

### Community 53 - "PR Rebase Management"
Cohesion: 0.50
Nodes (4): Rebase PR Stacks Workflow, Lopu PR Manager Workflow, Apply Lopu CodeQL Dispositions, Manage Rebases Job

### Community 54 - "Stacked PR Cascading"
Cohesion: 0.50
Nodes (4): Cascade to Stacked PRs, Comment on Resolved PR, Guarded Push, Requeue After Moving Ref Race

### Community 55 - "AI Instruction Files"
Cohesion: 0.67
Nodes (3): Thingtime Agent Instructions, Canonical AI Instructions, Claude Compatibility Instructions

### Community 56 - "Preview Recovery UX"
Cohesion: 0.67
Nodes (3): Discoverable preview status and recovery, Missing-build wildcard page, Working on it

## Ambiguous Edges - Review These
- `deploy-admin-pr-previews.mjs` → `Admin Controller Job`  [AMBIGUOUS]
  .github/workflows/develop-pr-preview.yml · relation: calls
- `Lopu Agent Action` → `All Branch Workflow`  [AMBIGUOUS]
  .github/workflows/all-branch.yml · relation: references

## Knowledge Gaps
- **122 isolated node(s):** `GIT_ATTR_NOSYSTEM`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_KEY_0`, `GIT_CONFIG_KEY_1` (+117 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 380 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **34 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `selfTest()` connect `Promotion Workflow Tests` to `Preview Race Tests`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **What connects `GIT_ATTR_NOSYSTEM`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_GLOBAL` to the rest of the system?**
  _122 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Promotion Workflow Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.05063571033720288 - nodes in this community are weakly interconnected._
- **Why does `Controller Job` connect `Secure Vercel Extraction` to `Develop Preview Deployment`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Should `Develop Preview Deployment` be split into smaller, more focused modules?**
  _Cohesion score 0.05496774193548387 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `deploy-admin-pr-previews.mjs` and `Admin Controller Job`?**
  _Edge tagged AMBIGUOUS (relation: calls) - confidence is low._
- **What is the exact relationship between `Lopu Agent Action` and `All Branch Workflow`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._