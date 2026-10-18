# Graph Report - thingtime  (2026-10-18)

## Corpus Check
- 86 files · ~238,390 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 4, .jq 1)

## Summary
- 1251 nodes · 2919 edges · 74 communities (61 shown, 13 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 24 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `615de4bf`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- promote-features-to-main.mjs
- deploy-develop-pr-preview.mjs
- deploy-admin-pr-previews.mjs
- graphify-cas.mjs
- build-all-branch.mjs
- promotion-pr-changelog.mjs
- lopu-cooperative-review.mjs
- ref_node_fs
- preview-fallback.mjs
- resolve-pr-conflicts-routing-contract.mjs
- workflow-control-plane-contract.mjs
- lopu-pr-status.mjs
- refresh-promotion-graphify.sh
- codeql-open-pr-backfill.mjs
- feature-stack-progress.mjs
- extract-vercel-prebuilt.py
- merge-main-develop-sync-pr.mjs
- lopu-pr-lifecycle.mjs
- promotion-worker-contract.sh
- feature-stack-waterfall.test.mjs
- PR #603 — Admin preview publisher controller
- `github-actions` — the CI control plane
- control-plane-events.test.mjs
- rebase-related-edits.test.mjs
- prepare-round.sh
- promotion-worker.sh
- Lopu PR manager workflow
- lopu-model-waterfall.mjs
- promotion-worker-routing-contract.mjs
- sync/main-into-develop PR
- stage-graphify-snapshots.mjs
- Control-plane regression checklist
- Thingtime AI instructions
- Thingtime AI instructions
- CHANGELOG.md
- Control-plane changelog
- ref_node_url
- PR #609 — Restore Lopu and preview admission
- PR #643 — Missing-build page for unassigned PR preview URLs
- Rebase Stack Worker Job
- start.sh
- Select Release Distribution
- ref_node_child_process
- preview-labels.mjs
- verify-promotion-source-authority.sh
- PR #634: Lopu comment admission and idempotent preview writes
- PR #534 — Feature Stack progress heartbeat controller
- PR #661: conflict scans and visible previews
- route job
- PR #506 — Auto-merge resolved main to develop sync PR
- PR #637: Safe cooperative handover for Lopu reviews
- Feature Stack Status Responder
- vercel.json
- Classify Web CI Scope Job
- PR #492 — Load Lopu credentials from the Thingtime vault
- PR #642: Discoverable preview status and missed-build repair
- rebase-ownership-routing-contract.sh
- resolve-canonical-instruction-type-conflicts.sh
- feature_stack_merge job
- Exact Head Preview Publication
- CodeQL Analysis Job
- Comment Contract Advisories Job
- Lopu internal develop promotion
- GitHub Native Auto-Merge
- Cooperative Handover Protocol
- CodeQL PR handoff workflow
- Commander Release Job
- promotion_validate job
- Graphify Refresh
- Promotion Resolution
- PR #611 Preview Recovery
- electron-release-gates.test.mjs
- ref_node_crypto

## God Nodes (most connected - your core abstractions)
1. `runPromotion()` - 64 edges
2. `selfTest()` - 53 edges
3. `runSelfTest()` - 34 edges
4. `reconcile()` - 34 edges
5. `failureDetail()` - 28 edges
6. `deploy()` - 27 edges
7. `main()` - 22 edges
8. `orphanedMergeHydrationIntegrationTest()` - 21 edges
9. `githubRequest()` - 18 edges
10. `main()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `Astra Fallback Execution` --implements--> `Astra Medium Credential Fallback`  [EXTRACTED]
  .github/actions/lopu-agent/action.yml → README.md
- `Lopu Agent Composite Action` --implements--> `Astra Medium Credential Fallback`  [EXTRACTED]
  .github/actions/lopu-agent/action.yml → README.md
- `PR Lifecycle Settle Job` --conceptually_related_to--> `Rebase Stack Worker Job`  [INFERRED]
  .github/workflows/lopu-pr-lifecycle.yml → .github/workflows/rebase-pr-stacks.yml
- `PR 634 Comment Admission Hardening` --references--> `Control Plane CI Verify Job`  [EXTRACTED]
  PRs/634-control-plane-event-hardening--harden-lopu-comment-admission.md → .github/workflows/control-plane-ci.yml
- `classify()` --calls--> `classifyClaudeCredentialFailure()`  [EXTRACTED]
  .github/scripts/lopu-model-waterfall.mjs → .github/scripts/classify-claude-credential-failure.mjs

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Shared CI provider routing contract** — github_workflows_promote_develop_to_main_route, github_workflows_promote_features_to_main_route, github_workflows_resolve_pr_conflicts_workflow [EXTRACTED 0.80]
- **develop→main promotion and back-sync automation** — github_workflows_promote_develop_to_main_workflow, github_workflows_promote_features_to_main_workflow, github_workflows_resolve_pr_conflicts_workflow, github_scripts_promote_features_to_main, github_scripts_promotion_pr_changelog [EXTRACTED 0.85]
- **Validation Check Suite** — prs_506_codex_auto_merge_main_develop_sync_pr_pr_506, prs_506_codex_auto_merge_main_develop_sync_pr_self_tests, prs_506_codex_auto_merge_main_develop_sync_pr_graphify_extraction, prs_506_codex_auto_merge_main_develop_sync_pr_local_codex_proxy [EXTRACTED 0.85]
- **Admin Preview Publication Flow** — prs_603_codex_admin_preview_publisher_controller_admin_preview_publisher, prs_603_codex_admin_preview_publisher_controller_github_actions_branch, prs_642_vercel_deployment [EXTRACTED 0.90]
- **Operational Proof Gate** — prs_506_codex_auto_merge_main_develop_sync_pr_pr_475, prs_506_codex_auto_merge_main_develop_sync_pr_protected_lopu_entrypoint, prs_506_codex_auto_merge_main_develop_sync_pr_sync_main_into_develop_pr, prs_506_codex_auto_merge_main_develop_sync_pr_main_branch, prs_506_codex_auto_merge_main_develop_sync_pr_develop_branch [EXTRACTED 0.90]
- **Paired Status Responder Rollout** — prs_781_codex_stack_progress_chat_controller_answer_feature_stack_status_questions_status_responder, prs_781_codex_stack_progress_chat_controller_answer_feature_stack_status_questions_product_chat_capability, prs_781_codex_stack_progress_chat_controller_answer_feature_stack_status_questions_product_api_pr_782 [EXTRACTED 0.90]
- **Terminal Merge Safety Gate** — prs_506_codex_auto_merge_main_develop_sync_pr_trusted_terminal_merger, prs_506_codex_auto_merge_main_develop_sync_pr_thingtime_repository, prs_506_codex_auto_merge_main_develop_sync_pr_sync_main_into_develop_pr, prs_506_codex_auto_merge_main_develop_sync_pr_develop_branch, prs_506_codex_auto_merge_main_develop_sync_pr_main_branch, prs_506_codex_auto_merge_main_develop_sync_pr_exact_head_rest_merge [EXTRACTED 0.90]
- **Admin Selected Preview Delivery Flow** — github_workflows_develop_pr_preview_admin_prepare, github_workflows_develop_pr_preview_admin_build, github_workflows_develop_pr_preview_admin_controller, concept_preview_publication [EXTRACTED 0.95]
- **All Branch Build Doctor Flow** — github_workflows_all_branch_workflow, github_scripts_build_all_branch, github_actions_lopu_agent [EXTRACTED 0.95]
- **Single-Owner CodeQL Analysis Flow** — github_workflows_codeql_analysis_scope, github_workflows_codeql_analysis_analyze [EXTRACTED 0.95]
- **Commander Signed Release Pipeline** — github_workflows_commander_release_release [EXTRACTED 0.95]
- **Cooperative Review Handover Flow** — prs_637_codex_lopu_cooperative_handoff_safely_hand_batch_reviews_over_to_waiting_work_cooperative_handover_protocol, prs_637_codex_lopu_cooperative_handoff_safely_hand_batch_reviews_over_to_waiting_work_pr_637 [EXTRACTED 0.95]
- **Protected Develop Preview Delivery Flow** — github_workflows_develop_pr_preview_prepare, github_workflows_develop_pr_preview_build, github_workflows_develop_pr_preview_controller, concept_preview_publication [EXTRACTED 0.95]
- **Electron Release Distribution Flow** — github_workflows_electron_pr_release_resolve_validate_pr_source, github_workflows_electron_pr_release_select_release_distribution, github_workflows_electron_pr_release_derive_semver_pr_release_identity, github_workflows_electron_pr_release_build_signed_release, github_workflows_electron_pr_release_build_unsigned_release [EXTRACTED 0.95]
- **Feature Stack Validation and Integration Flow** — github_workflows_resolve_pr_conflicts_feature_stack_plan, github_workflows_resolve_pr_conflicts_model_config, github_workflows_resolve_pr_conflicts_feature_stack_merge [EXTRACTED 0.95]
- **Feature Stack Progress Reporting** — prs_534_codex_feature_stack_progress_heartbeats_controller, prs_534_codex_feature_stack_progress_heartbeats_controller_reporter, prs_534_codex_feature_stack_progress_heartbeats_controller_target_workers [EXTRACTED 0.95]
- **PR #661 Delivery Reliability Repairs** — prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_pr_661_conflict_scans_and_visible_previews, prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_dependency_graph_regression, prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_bounded_pr_inventory, prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_ref_race_retry [EXTRACTED 0.95]
- **Protected PR Resolution Control Plane** — github_workflows_resolve_pr_conflicts_route, github_workflows_resolve_pr_conflicts_detect, github_workflows_resolve_pr_conflicts_handoff, github_workflows_resolve_pr_conflicts_review_detect, github_workflows_resolve_pr_conflicts_review_handoff, github_workflows_resolve_pr_conflicts_review [EXTRACTED 0.95]
- **Missing-build Preview Rollout** — prs_643_codex_preview_no_build_page_show_a_no_build_page_for_unassigned_pr_preview_urls_preview_wildcard_domains, prs_643_codex_preview_no_build_page_show_a_no_build_page_for_unassigned_pr_preview_urls_fixed_html_fallback, prs_643_codex_preview_no_build_page_show_a_no_build_page_for_unassigned_pr_preview_urls_protected_rollout [EXTRACTED 0.95]
- **Scheduled Preview Recovery Flow** — prs_642_preview_status_recovery, prs_642_scheduled_controller, prs_642_deployment_receipts, prs_642_vercel_deployment [EXTRACTED 0.95]
- **Guarded Rebase Stack Execution Flow** — github_workflows_rebase_pr_stacks_route, github_workflows_rebase_pr_stacks_detect, github_workflows_rebase_pr_stacks_handoff, github_workflows_rebase_pr_stacks_rebase, github_actions_rebase_conflict_round_rebase_conflict_round [EXTRACTED 0.95]
- **Canonical AI Instruction Alias Scheme** — agents, ai_all, claude [EXTRACTED 1.00]

## Communities (74 total, 13 thin omitted)

### Community 0 - "promote-features-to-main.mjs"
Cohesion: 0.05
Nodes (130): applyPicks(), attestationMatches(), botCommentsByLatestEvent(), buildPromotionDispatchRequest(), buildPromotionPlanContext(), cancelPromotionRetirement(), CFG, checkoutRemoteBranch() (+122 more)

### Community 1 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.05
Nodes (119): ACTIVE_STATES, assertCurrentPullRequest(), assertPrebuiltOutput(), assertPreviewBundle(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack() (+111 more)

### Community 2 - "deploy-admin-pr-previews.mjs"
Cohesion: 0.08
Nodes (65): ACTIVE_STATES, assertCurrentPullRequest(), assertPrebuiltOutput(), assignAlias(), boundedInteger(), cleanupDeploymentIssue(), cleanupEnvironment(), commentBody() (+57 more)

### Community 3 - "graphify-cas.mjs"
Cohesion: 0.09
Nodes (60): activateSnapshot(), artifactHash(), baselineNodeCount(), compareSnapshotQuality(), computeSourceFingerprint(), copyPortableFiles(), DEFAULT_SNAPSHOT_RETENTION, dropNestedRepositories() (+52 more)

### Community 4 - "build-all-branch.mjs"
Cohesion: 0.12
Nodes (43): CodeQL Disposition Handoff, Isolated Rebase Scratch Verification, Lopu Agent Composite Action, Lopu Rebase Conflict Round, Rebase Scratch Verifier, assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode() (+35 more)

### Community 5 - "promotion-pr-changelog.mjs"
Cohesion: 0.12
Nodes (41): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+33 more)

### Community 6 - "lopu-cooperative-review.mjs"
Cohesion: 0.11
Nodes (28): checkpoint(), completedReport(), continuationNumbers(), finalize(), git(), HANDOVER_INSTRUCTIONS, initialize(), numbers() (+20 more)

### Community 7 - "ref_node_fs"
Cohesion: 0.11
Nodes (13): assertPrReleaseContract(), count(), here, workflow, allowed(), evaluate, expression, main (+5 more)

### Community 8 - "preview-fallback.mjs"
Cohesion: 0.14
Nodes (18): FALLBACK_BRANCH, FALLBACK_HEADER, FALLBACK_MARKER, fallbackDeploymentIssue(), fallbackDomainIssue(), fallbackPage(), installFallbackAliases(), publishedPreviewResponseIssue() (+10 more)

### Community 9 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.12
Nodes (26): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertCapturedStdoutStaysClean(), assertRoute(), assertWorkflowSource(), CALLS_HELPER(), decodeBatch() (+18 more)

### Community 10 - "workflow-control-plane-contract.mjs"
Cohesion: 0.13
Nodes (26): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertAdminWaterfallGrammar(), assertBareControlPlaneTree() (+18 more)

### Community 11 - "lopu-pr-status.mjs"
Cohesion: 0.17
Nodes (25): argument(), branchCode(), classifyInventory(), count(), dateParts(), desiredFactLabels(), escapeHtml(), FACT_LABEL_ORDER (+17 more)

### Community 12 - "refresh-promotion-graphify.sh"
Cohesion: 0.14
Nodes (24): assert_control_metadata_unchanged(), assert_tool_boundary(), current_grafts_state(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT (+16 more)

### Community 13 - "codeql-open-pr-backfill.mjs"
Cohesion: 0.21
Nodes (23): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), analysisSnapshotForPullRequest(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp() (+15 more)

### Community 14 - "feature-stack-progress.mjs"
Cohesion: 0.27
Nodes (12): githubJobs(), githubStackPullRequests(), postProgress(), progressSnapshot(), reconcile(), recoveryPayload(), run(), selfTest() (+4 more)

### Community 15 - "extract-vercel-prebuilt.py"
Cohesion: 0.15
Nodes (9): extract_archive(), main(), _member_path(), self_test(), _validate_link(), Build Job, Controller Job, Dispatch Job (+1 more)

### Community 16 - "merge-main-develop-sync-pr.mjs"
Cohesion: 0.17
Nodes (18): assertHeadContainsMain(), assertSyncPullRequestShape(), exactSha(), EXPECTED_MERGE_REJECTIONS, githubRequest(), GitHubRequestError, headContainsMain(), mergeStandingSyncPullRequest() (+10 more)

### Community 17 - "lopu-pr-lifecycle.mjs"
Cohesion: 0.20
Nodes (16): approved(), eligible(), identity(), managed(), pauses, redundant(), selectPulls(), settle() (+8 more)

### Community 18 - "promotion-worker-contract.sh"
Cohesion: 0.14
Nodes (17): BASE_REF, BASE_SHA, compute_plan_hash(), GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay() (+9 more)

### Community 19 - "feature-stack-waterfall.test.mjs"
Cohesion: 0.30
Nodes (14): canonicalFeatureStackPlan(), decodeFeatureStackPlan(), exactKeys(), featureStackId(), git(), selfTest(), validateWaterfall(), verifyFeatureStackHistory() (+6 more)

### Community 20 - "PR #603 — Admin preview publisher controller"
Cohesion: 0.13
Nodes (15): Admin Preview Publisher, Compatibility fix, Develop Preview Controller, Protected github-actions Branch, Thingtime GitHub App Bot, Outcome, PR #595, PR #603 — Admin preview publisher controller (+7 more)

### Community 21 - "`github-actions` — the CI control plane"
Cohesion: 0.12
Nodes (16): Astra Medium fallback using the Thingtime vault, Commander signed releases, Desktop and Recovery release pipeline, Discoverable preview status and recovery, Fork setup: Vercel develop previews, `github-actions` — the CI control plane, Known trade-off, Lopu principal repository manager (+8 more)

### Community 22 - "control-plane-events.test.mjs"
Cohesion: 0.21
Nodes (7): ci, workflow, classifyConversation(), classifyQueuedConversation(), hasAutomationMarker(), previewSummaryBody(), publishPreviewSummary()

### Community 23 - "rebase-related-edits.test.mjs"
Cohesion: 0.28
Nodes (14): actionPath, copyTrustedTree(), extractVerifierScript(), filesUnder(), hashNamedFiles(), hashRebaseState(), hashTrustedTree(), makeStoppedRebase() (+6 more)

### Community 24 - "prepare-round.sh"
Cohesion: 0.28
Nodes (14): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_index_entries(), hash_rebase_state(), rebase_in_progress() (+6 more)

### Community 25 - "promotion-worker.sh"
Cohesion: 0.37
Nodes (13): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+5 more)

### Community 26 - "Lopu PR manager workflow"
Cohesion: 0.13
Nodes (15): lanes: fan out CI promotion lanes, promote: replay merged develop PRs, route: provider router job, rebase-pr-stacks reusable workflow, Cascade to PRs Stacked on This Head, defer_ref_race, Failure Reporting, graph_not_collapsed (+7 more)

### Community 27 - "lopu-model-waterfall.mjs"
Cohesion: 0.15
Nodes (31): models, exportBundle(), fetchBundle(), legacyCredentials(), main(), required(), safeCache(), validate() (+23 more)

### Community 28 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.14
Nodes (13): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, featureStackMergeIf, featureStackMergeJob, graphify, lopuAgent (+5 more)

### Community 29 - "sync/main-into-develop PR"
Cohesion: 0.15
Nodes (14): Clean Synchronization Lane, develop Branch, GitHub Exact-Head REST Merge, Semantic Graphify Extraction, Local Codex Proxy, Lopu Conflict Resolver, main Branch, PR #475 (+6 more)

### Community 30 - "stage-graphify-snapshots.mjs"
Cohesion: 0.36
Nodes (11): addExisting(), filesUnder(), git(), LEGACY_ROOT, missingFromWorktree(), PORTABLE, removeFromIndex(), restoreTrackedFromHead() (+3 more)

### Community 31 - "Control-plane regression checklist"
Cohesion: 0.17
Nodes (12): Configured cross-provider waterfall, Control-plane regression checklist, Cooperative review handover, Event feedback and CI cancellation, Exact configured workflow model orders, Explicit stack model and endpoint waterfall, Feature Stack run status conversations, Feature Stack snapshot publication and merge gates (+4 more)

### Community 32 - "Thingtime AI instructions"
Cohesion: 0.18
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 33 - "Thingtime AI instructions"
Cohesion: 0.18
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 34 - "CHANGELOG.md"
Cohesion: 0.24
Nodes (6): Canonical AI Instructions, Astra Medium Credential Fallback, Graphify Content-Addressed Snapshots, Lopu Repository Manager, Astra Fallback Execution, PR 1017: GitHub Lopu admin model waterfall

### Community 35 - "Control-plane changelog"
Cohesion: 0.20
Nodes (10): 2026-09-05 — Cooperative review handover and preview recovery, 2026-09-05 — Desktop and Recovery cloud release repair, 2026-09-05 — Signed Commander releases and Recovery pairing, 2026-09-05 — Visible previews and conflict detector recovery, 2026-10-18 — Execute the saved admin AI waterfall, Added, Changed, Control-plane changelog (+2 more)

### Community 36 - "ref_node_url"
Cohesion: 0.29
Nodes (6): checkDisposition(), publishMerge(), baseSha, fixture(), head, success

### Community 37 - "PR #609 — Restore Lopu and preview admission"
Cohesion: 0.22
Nodes (8): Follow-up acceptance repair, Live diagnosis, Outcome, PR #609 — Restore Lopu and preview admission, Security boundary, Validation, Thingtime Credential Vault Router, Lopu Admission Contract

### Community 38 - "PR #643 — Missing-build page for unassigned PR preview URLs"
Cohesion: 0.22
Nodes (8): Cause and scope, Fixed HTML Fallback, PR #643 Missing-build Page, PR #643 — Missing-build page for unassigned PR preview URLs, Preview Wildcard Domains, Protected Rollout, Root response decision, Verification before merge

### Community 39 - "Rebase Stack Worker Job"
Cohesion: 0.29
Nodes (8): Rebase Conflict Round Action, PR Lifecycle Settle Job, Child Transplant Dispatch Step, Rebase Stack Detection Job, Graphify Refresh Step, Rebase Worker Handoff Job, Rebase Stack Worker Job, Rebase Provider Route Job

### Community 40 - "start.sh"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 41 - "Select Release Distribution"
Cohesion: 0.25
Nodes (8): Build Signed and Notarized Electron Release, Build Unsigned Electron Release, Derive SemVer PR Release Identity, Import Developer ID and Notarization Credentials, Resolve and Validate PR Source, Select Release Distribution, Thingtime Electron PR Release Workflow, Electron App Release

### Community 42 - "ref_node_child_process"
Cohesion: 0.19
Nodes (7): allowed, workflow, answerCommand(), answerQuestion(), CHAT_SYSTEM_PROMPT, safeRunContext(), serveRunChat()

### Community 43 - "preview-labels.mjs"
Cohesion: 0.24
Nodes (11): colors, ensureLabel(), hasPreviewLabels(), lanes, prefix(), previewBuildTime(), previewBuiltLabel(), syncOnce() (+3 more)

### Community 44 - "verify-promotion-source-authority.sh"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 45 - "PR #634: Lopu comment admission and idempotent preview writes"
Cohesion: 0.29
Nodes (7): Control Plane CI Verify Job, PR 634 Comment Admission Hardening, Behavior, Evidence and scope, PR #634: Lopu comment admission and idempotent preview writes, Rollout, Validation

### Community 46 - "PR #534 — Feature Stack progress heartbeat controller"
Cohesion: 0.29
Nodes (7): Feature Stack Progress Heartbeat Controller, Outcome, PR #534 — Feature Stack progress heartbeat controller, Feature Stack Progress Reporter, Safety and cost, Feature Stack Target Workers, Validation

### Community 47 - "PR #661: conflict scans and visible previews"
Cohesion: 0.29
Nodes (6): Bounded PR Inventory, Routing Dependency Graph Regression, PR #592, PR #661: conflict scans and visible previews, Preview Description Helper, Target Ref Race Retry

### Community 48 - "route job"
Cohesion: 0.33
Nodes (6): conversation_gate job, detect job, handoff job, review_detect job, review_handoff job, route job

### Community 49 - "PR #506 — Auto-merge resolved main to develop sync PR"
Cohesion: 0.33
Nodes (5): Operational proof gate, PR #506 — Auto-merge resolved main to develop sync PR, Problem, Resolution, Validation

### Community 50 - "PR #637: Safe cooperative handover for Lopu reviews"
Cohesion: 0.33
Nodes (5): PR #611 recovery, PR #637: Safe cooperative handover for Lopu reviews, Protocol, Scope and evidence, Validation

### Community 51 - "Feature Stack Status Responder"
Cohesion: 0.40
Nodes (5): Merge Workers, PR #781 — Feature Stack action status responder, Paired Product/API PR #782, Product Chat Capability, Feature Stack Status Responder

### Community 52 - "vercel.json"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 53 - "Classify Web CI Scope Job"
Cohesion: 0.40
Nodes (5): API Suite Job, Build Typecheck Ratchet Unit Tests Job, Product Contract Advisories, Classify Web CI Scope Job, Web CI Workflow

### Community 54 - "PR #492 — Load Lopu credentials from the Thingtime vault"
Cohesion: 0.40
Nodes (4): PR #492 — Load Lopu credentials from the Thingtime vault, Safety and regression focus, Scope, Validation log

### Community 55 - "PR #642: Discoverable preview status and missed-build repair"
Cohesion: 0.40
Nodes (4): Changes, Evidence and cause, PR #642: Discoverable preview status and missed-build repair, Validation and rollout

### Community 56 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 57 - "resolve-canonical-instruction-type-conflicts.sh"
Cohesion: 0.83
Nodes (3): resolve-canonical-instruction-type-conflicts.sh script, stage_record(), tree_record()

### Community 58 - "feature_stack_merge job"
Cohesion: 0.50
Nodes (4): feature_stack_merge job, feature_stack_plan job, model_config job, review job

### Community 72 - "electron-release-gates.test.mjs"
Cohesion: 0.48
Nodes (6): CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest()

### Community 73 - "ref_node_crypto"
Cohesion: 0.80
Nodes (4): rawIndexHash(), runGit(), semanticIndexHash(), sha256()

## Ambiguous Edges - Review These
- `deploy-admin-pr-previews.mjs` → `Admin Controller Job`  [AMBIGUOUS]
  .github/workflows/develop-pr-preview.yml · relation: calls

## Knowledge Gaps
- **101 isolated node(s):** `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR`, `BASE_REF`, `BASE_SHA` (+96 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 359 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Lopu Agent Composite Action` connect `build-all-branch.mjs` to `CHANGELOG.md`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **What connects `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR` to the rest of the system?**
  _101 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `promote-features-to-main.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05194805194805195 - nodes in this community are weakly interconnected._
- **Why does `Astra Medium Credential Fallback` connect `CHANGELOG.md` to `build-all-branch.mjs`?**
  _High betweenness centrality (0.104) - this node is a cross-community bridge._
- **Should `deploy-develop-pr-preview.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05496774193548387 - nodes in this community are weakly interconnected._
- **Should `deploy-admin-pr-previews.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.07743271221532091 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `deploy-admin-pr-previews.mjs` and `Admin Controller Job`?**
  _Edge tagged AMBIGUOUS (relation: calls) - confidence is low._