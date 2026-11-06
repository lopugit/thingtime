# Graph Report - thingtime-electron-xcodegen  (2026-11-06)

## Corpus Check
- 105 files · ~281,396 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 4, .jq 1)

## Summary
- 1501 nodes · 3545 edges · 109 communities (68 shown, 41 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 55 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `39c06129`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- promote-features-to-main.mjs
- deploy-admin-pr-previews.mjs
- deploy-vercel-prebuilt.mjs
- graphify-cas.mjs
- NativeCompileBoundaryTests
- lopu-model-waterfall.mjs
- deploy-develop-pr-preview.mjs
- promotion-pr-changelog.mjs
- preview-fallback.mjs
- build-all-branch.mjs
- lopu-cooperative-review.mjs
- ref_node_assert
- orphan-preview-cleanup.mjs
- Thingtime AI instructions
- resolve-pr-conflicts-routing-contract.mjs
- main
- lopu-pr-status.mjs
- workflow-control-plane-contract.mjs
- extract-vercel-prebuilt.py
- reconcile
- refresh-promotion-graphify.sh
- native-compile-ci.py
- codeql-open-pr-backfill.mjs
- runSelfTest
- ref_node_os
- merge-main-develop-sync-pr.mjs
- Review Job
- lopu-pr-lifecycle.mjs
- ref_node_path
- promotion-worker-contract.sh
- supervise
- rebase-related-edits.test.mjs
- prepare-round.sh
- promotion-worker.sh
- promotion-worker-routing-contract.mjs
- sync/main-into-develop PR
- Saved Agent overview workspace
- control-plane-events.test.mjs
- stage-graphify-snapshots.mjs
- Repository-aware Graphify router
- Admin Preview Publisher
- Resolve PR Conflicts Workflow
- PR #661: Conflict Scans and Visible Previews
- cleanup
- Resolve Promotion Job
- preview-recovery.test.mjs
- start.sh
- Select Release Distribution
- verify-promotion-source-authority.sh
- Resolve PR job
- Cascade to stacked PRs step
- Thingtime API v1 routes
- Lopu agent composite action
- requestJson
- electron-release-gates.test.mjs
- Thingtime AI instructions
- vercel.json
- safeHostname
- Feature Stack Status Responder
- Thingtime Character coordination
- Control-plane changelog
- remix/scripts/worktree-ports.cjs
- rebase-ownership-routing-contract.sh
- resolve-canonical-instruction-type-conflicts.sh
- ref_node_url
- Review Handoff Job
- api/utils/mongodb/collections.ts
- Feature Stack Progress Reporter
- PR 609 Codex Preview Manager Reliability
- Lopu PR Status Script
- Merge base into head step
- Web CI workflow
- parentId
- CodeQL analysis workflow
- Lopu internal develop promotion
- GitHub Native Auto-Merge
- Conflict Worker
- Continue Release Analysis
- Continue Review Session
- Comment on PR needs attention step
- Feature Stack Merge Gate Job
- Feature Stack Plan Job
- Feature Stack Receipt Reconciliation Job
- Continue Feature Stack Session
- Make Promotion Attestation
- Model Config Job
- Verified Lopu Publication Invocation
- Claude Design
- graphify-out/cache/semantic
- Semantic CAS cache variants
- Immutable Graphify snapshots
- Themes API family
- Legacy user collections
- Rebase conflict round action
- All-branch integration workflow
- Workflow control-plane CI
- Vercel prebuilt deployment workflow
- Develop PR preview workflow
- Lopu PR lifecycle workflow
- Native compile workflow
- CodeQL PR handoff workflow
- Commander Release Job
- PR 1225: Controlled environment gateway publication
- PR 1294: Remove orphan Vercel previews and reject pre-gateway source
- PR #492 Load Lopu credentials from Thingtime vault
- PR #611 Preview Recovery
- Ordinary PR gateway routing with preserved develop credentials

## God Nodes (most connected - your core abstractions)
1. `runPromotion()` - 64 edges
2. `runSelfTest()` - 53 edges
3. `selfTest()` - 53 edges
4. `NativeCompileBoundaryTests` - 48 edges
5. `Thingtime AI instructions` - 45 edges
6. `reconcile()` - 38 edges
7. `deploy()` - 31 edges
8. `publish()` - 28 edges
9. `failureDetail()` - 28 edges
10. `githubRequest()` - 23 edges

## Surprising Connections (you probably didn't know these)
- `Control-plane changelog` --references--> `PR 642 Preview Status Recovery`  [EXTRACTED]
  CHANGELOG.md → PRs/642-preview-status-recovery--discoverable-status-and-missed-build-repair.md
- `Thingtime AI instructions` --references--> `Control-plane regression checklist`  [EXTRACTED]
  AGENTS.md → .github/TESTING.md
- `Thingtime AI instructions` --references--> `Lopu agent composite action`  [EXTRACTED]
  AGENTS.md → .github/actions/lopu-agent/action.yml
- `Thingtime AI instructions` --references--> `Protected unsigned native compilation`  [EXTRACTED]
  AGENTS.md → .github/NATIVE_COMPILE.md
- `Control-plane changelog` --references--> `PR 1017: GitHub Lopu admin model waterfall`  [EXTRACTED]
  CHANGELOG.md → PRs/1017-codex-lopu-astra-vault-admin-model-waterfall.md

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
- **Controlled gateway publication targets** — prs_1225_codex_gateway_publisher_policy_publish_controlled_environment_gateway_owners, prs_codex_gateway_alias_propagation_standard_preview_target [EXTRACTED 0.91]
- **Rebase Publication, Validation, and Stack Cascade** — .github_workflows_rebase_pr_stacks_yml_conflict_round, .github_workflows_rebase_pr_stacks_yml_graphify_refresh, .github_workflows_rebase_pr_stacks_yml_dispatch_child_transplants, .github_workflows_rebase_pr_stacks_yml [EXTRACTED 0.94]
- **Commander Signed Release Pipeline** — github_workflows_commander_release_release [EXTRACTED 0.95]
- **Cooperative Review Handover Flow** — prs_637_codex_lopu_cooperative_handoff_safely_hand_batch_reviews_over_to_waiting_work_cooperative_handover_protocol, prs_637_codex_lopu_cooperative_handoff_safely_hand_batch_reviews_over_to_waiting_work_pr_637 [EXTRACTED 0.95]
- **Electron Release Distribution Flow** — github_workflows_electron_pr_release_resolve_validate_pr_source, github_workflows_electron_pr_release_select_release_distribution, github_workflows_electron_pr_release_derive_semver_pr_release_identity, github_workflows_electron_pr_release_build_signed_release, github_workflows_electron_pr_release_build_unsigned_release [EXTRACTED 0.95]
- **Feature Stack Progress Reporting** — prs_534_codex_feature_stack_progress_heartbeats_controller, prs_534_codex_feature_stack_progress_heartbeats_controller_reporter, prs_534_codex_feature_stack_progress_heartbeats_controller_target_workers [EXTRACTED 0.95]
- **PR #661 Delivery Reliability Repairs** — prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_pr_661, prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_dependency_graph_regression, prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_bounded_pr_inventory, prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_ref_race_retry [EXTRACTED 0.95]
- **Missing-build Preview Rollout** — prs_643_codex_preview_no_build_page_show_a_no_build_page_for_unassigned_pr_preview_urls_preview_wildcard_domains, prs_643_codex_preview_no_build_page_show_a_no_build_page_for_unassigned_pr_preview_urls_fixed_html_fallback, prs_643_codex_preview_no_build_page_show_a_no_build_page_for_unassigned_pr_preview_urls_protected_rollout [EXTRACTED 0.95]
- **Scheduled Preview Recovery Flow** — prs_642_preview_status_recovery, prs_642_scheduled_controller, prs_642_deployment_receipts, prs_642_vercel_deployment [EXTRACTED 0.95]
- **Thingtime data access and storage conventions** — agents_thingtime_api, agents_things_model, agents_parent_id, agents_things_v2, agents_api_mongodb_collections [EXTRACTED 0.96]
- **Promotion Resolution, Publication, and Advisory Analysis Flow** — .github_workflows_resolve_pr_conflicts_resolve_promotion, .github_workflows_resolve_pr_conflicts_promotion_worker, .github_workflows_resolve_pr_conflicts_refresh_promotion_graphify, .github_workflows_resolve_pr_conflicts_release_analysis [EXTRACTED 0.96]
- **PR Resolution and Rebase Control Plane** — .github_workflows_resolve_pr_conflicts_yml, .github_workflows_resolve_pr_conflicts_yml_detect, .github_workflows_resolve_pr_conflicts_yml_handoff, .github_workflows_resolve_pr_conflicts_yml_manage_rebases, .github_workflows_rebase_pr_stacks_yml [EXTRACTED 0.97]
- **Graphify snapshot publication flow** — agents_control_plane_router, agents_graphify_json, agents_graphify_snapshots_dir, agents_semantic_cas_dir, agents_graphify_manifest, agents_graphify_report [EXTRACTED 0.98]
- **PR resolver progress reporting** — .github_workflows_resolve_pr_conflicts_read_live_stats, .github_workflows_resolve_pr_conflicts_sync_progress_label_subset, .github_workflows_resolve_pr_conflicts_sync_progress_labels, .github_workflows_resolve_pr_conflicts_update_progress [EXTRACTED 0.98]
- **Thingtime API endpoint registration** — agents_product_api_v1_routes, agents_route_file, agents_route_import_map, agents_api_docs_registry [EXTRACTED 0.99]
- **Feature Stack Validation, Merge, and Receipt Flow** — .github_workflows_resolve_pr_conflicts_feature_stack_plan, .github_workflows_resolve_pr_conflicts_feature_stack_merge, .github_workflows_resolve_pr_conflicts_feature_stack_merge_gate, .github_workflows_resolve_pr_conflicts_feature_stack_reconcile_receipt [EXTRACTED 0.99]
- **Serialized PR resolution pipeline** — .github_workflows_resolve_pr_conflicts_admission_step, .github_workflows_resolve_pr_conflicts_merge_base_into_head, .github_workflows_resolve_pr_conflicts_resolve_conflicts, .github_workflows_resolve_pr_conflicts_verify_resolution, .github_workflows_resolve_pr_conflicts_push_merge_commit [EXTRACTED 0.99]
- **PR Review Lifecycle** — .github_workflows_resolve_pr_conflicts_review_detect, .github_workflows_resolve_pr_conflicts_review_handoff, .github_workflows_resolve_pr_conflicts_review [EXTRACTED 0.99]
- **CodeQL analysis ownership and ordering** — github_actions_workflows_codeql_analysis, github_actions_workflows_control_plane_ci, github_actions_workflows_rebase_pr_stacks [INFERRED 0.50]

## Communities (109 total, 41 thin omitted)

### Community 0 - "promote-features-to-main.mjs"
Cohesion: 0.05
Nodes (133): applyPicks(), attestationMatches(), botCommentsByLatestEvent(), buildPromotionDispatchRequest(), buildPromotionPlanContext(), cancelPromotionRetirement(), CFG, checkoutRemoteBranch() (+125 more)

### Community 1 - "deploy-admin-pr-previews.mjs"
Cohesion: 0.07
Nodes (67): ACTIVE_STATES, assertCurrentPullRequest(), assertPrebuiltOutput(), assignAlias(), boundedInteger(), cleanupDeploymentIssue(), cleanupEnvironment(), commentBody() (+59 more)

### Community 2 - "deploy-vercel-prebuilt.mjs"
Cohesion: 0.09
Nodes (62): Production storage runtime monitor workflow, applyOutputPolicy(), visit(), assertGatewaySource(), assertPreviewOpen(), compatibilityAliasCandidates(), context(), deploymentArgs() (+54 more)

### Community 3 - "graphify-cas.mjs"
Cohesion: 0.09
Nodes (60): activateSnapshot(), artifactHash(), baselineNodeCount(), compareSnapshotQuality(), computeSourceFingerprint(), copyPortableFiles(), DEFAULT_SNAPSHOT_RETENTION, dropNestedRepositories() (+52 more)

### Community 5 - "lopu-model-waterfall.mjs"
Cohesion: 0.12
Nodes (37): Thingtime credential vault, CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest(), exportBundle() (+29 more)

### Community 6 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.08
Nodes (41): ACTIVE_STATES, assertCustomDevelopEnvironment(), assertPrebuiltOutput(), assertPreviewMaster(), assertVercelConfiguration(), assertWildcardFallbackRuntimes(), CLEANUP_ACTIONS, cleanupDeployments() (+33 more)

### Community 7 - "promotion-pr-changelog.mjs"
Cohesion: 0.12
Nodes (41): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+33 more)

### Community 8 - "preview-fallback.mjs"
Cohesion: 0.09
Nodes (30): FALLBACK_BRANCH, FALLBACK_HEADER, FALLBACK_MARKER, fallbackDeploymentIssue(), fallbackDomainIssue(), fallbackPage(), fallbackResponseIssue(), installFallbackAliases() (+22 more)

### Community 9 - "build-all-branch.mjs"
Cohesion: 0.16
Nodes (36): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), completeRefspecs, countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode() (+28 more)

### Community 10 - "lopu-cooperative-review.mjs"
Cohesion: 0.11
Nodes (28): checkpoint(), completedReport(), continuationNumbers(), finalize(), git(), HANDOVER_INSTRUCTIONS, initialize(), numbers() (+20 more)

### Community 11 - "ref_node_assert"
Cohesion: 0.12
Nodes (11): models, allowed, workflow, script, postPublishRefRace(), snapshot, rawIndexHash(), runGit() (+3 more)

### Community 12 - "orphan-preview-cleanup.mjs"
Cohesion: 0.15
Nodes (25): ACTIVE, assertPreviewHasOpenPullRequest(), completeInventory(), deploymentLane(), idOf(), missing(), openBranchPullRequests(), previewIdentity() (+17 more)

### Community 13 - "Thingtime AI instructions"
Cohesion: 0.06
Nodes (33): ensure-bcrypt, Browser automation preference, Canonical instruction file, claude-todo roadmap, DECISIONS.md, remix/scripts/dev-pm2.cjs, Dev server port coordination, drop-stale-collection-generations migration (+25 more)

### Community 14 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.13
Nodes (26): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertCapturedStdoutStaysClean(), assertRoute(), assertWorkflowSource(), CALLS_HELPER(), decodeBatch() (+18 more)

### Community 15 - "main"
Cohesion: 0.15
Nodes (26): assertCurrentPullRequest(), assertPreviewBundle(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), boundedInteger(), dispatchPullRequestIssue() (+18 more)

### Community 16 - "lopu-pr-status.mjs"
Cohesion: 0.17
Nodes (25): argument(), branchCode(), classifyInventory(), count(), dateParts(), desiredFactLabels(), escapeHtml(), FACT_LABEL_ORDER (+17 more)

### Community 17 - "workflow-control-plane-contract.mjs"
Cohesion: 0.13
Nodes (26): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertAdminWaterfallGrammar(), assertBareControlPlaneTree() (+18 more)

### Community 18 - "extract-vercel-prebuilt.py"
Cohesion: 0.14
Nodes (5): extract_archive(), main(), _member_path(), self_test(), _validate_link()

### Community 19 - "reconcile"
Cohesion: 0.20
Nodes (26): assertNoProtectedAlias(), assignAliasVerified(), cleanupClosedPrResources(), cleanupComment(), cleanupPrResources(), createGithubDeployment(), dashboardUrl(), deploy() (+18 more)

### Community 20 - "refresh-promotion-graphify.sh"
Cohesion: 0.14
Nodes (24): assert_control_metadata_unchanged(), assert_tool_boundary(), current_grafts_state(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT (+16 more)

### Community 21 - "native-compile-ci.py"
Cohesion: 0.12
Nodes (11): acquire_cleanup_lock(), arm_native(), drop_identity(), extract_candidate(), kernel_groups(), main(), native_deadline(), preflight_failure() (+3 more)

### Community 22 - "codeql-open-pr-backfill.mjs"
Cohesion: 0.21
Nodes (23): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), analysisSnapshotForPullRequest(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp() (+15 more)

### Community 23 - "runSelfTest"
Cohesion: 0.19
Nodes (23): choosePreferredDeployment(), chooseStableDevelopDeployment(), classifyPullRequest(), createVercelDeployment(), deploymentIdentityIssue(), deploymentMetadata(), deployPrebuiltOutput(), guardPreviewUpload() (+15 more)

### Community 24 - "ref_node_os"
Cohesion: 0.16
Nodes (17): answerCommand(), answerQuestion(), CHAT_SYSTEM_PROMPT, safeRunContext(), serveRunChat(), githubJobs(), githubStackPullRequests(), postProgress() (+9 more)

### Community 25 - "merge-main-develop-sync-pr.mjs"
Cohesion: 0.17
Nodes (18): assertHeadContainsMain(), assertSyncPullRequestShape(), exactSha(), EXPECTED_MERGE_REJECTIONS, githubRequest(), GitHubRequestError, headContainsMain(), mergeStandingSyncPullRequest() (+10 more)

### Community 26 - "Review Job"
Cohesion: 0.12
Nodes (19): CodeQL Disposition Writer Invocation, CodeQL Dispositions Job, Apply CodeQL Dispositions, Feature Stack Chat Script, Feature Stack Progress Job, Feature Stack Progress Reporter Invocation, Feature Stack Progress Script, Feature Stack Verifier Script (+11 more)

### Community 27 - "lopu-pr-lifecycle.mjs"
Cohesion: 0.19
Nodes (17): checkDisposition(), approved(), eligible(), identity(), managed(), pauses, redundant(), selectPulls() (+9 more)

### Community 28 - "ref_node_path"
Cohesion: 0.30
Nodes (14): canonicalFeatureStackPlan(), decodeFeatureStackPlan(), exactKeys(), featureStackId(), git(), selfTest(), validateWaterfall(), verifyFeatureStackHistory() (+6 more)

### Community 29 - "promotion-worker-contract.sh"
Cohesion: 0.14
Nodes (17): BASE_REF, BASE_SHA, compute_plan_hash(), GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay() (+9 more)

### Community 30 - "supervise"
Cohesion: 0.17
Nodes (14): admit_runner(), build_environment(), firewall_rules(), phase(), require_hosted_runner(), run(), supervise(), as_build() (+6 more)

### Community 31 - "rebase-related-edits.test.mjs"
Cohesion: 0.28
Nodes (14): actionPath, copyTrustedTree(), extractVerifierScript(), filesUnder(), hashNamedFiles(), hashRebaseState(), hashTrustedTree(), makeStoppedRebase() (+6 more)

### Community 32 - "prepare-round.sh"
Cohesion: 0.28
Nodes (14): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_index_entries(), hash_rebase_state(), rebase_in_progress() (+6 more)

### Community 33 - "promotion-worker.sh"
Cohesion: 0.37
Nodes (13): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+5 more)

### Community 34 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.14
Nodes (13): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, featureStackMergeIf, featureStackMergeJob, graphify, lopuAgent (+5 more)

### Community 35 - "sync/main-into-develop PR"
Cohesion: 0.15
Nodes (14): Clean Synchronization Lane, develop Branch, GitHub Exact-Head REST Merge, Semantic Graphify Extraction, Local Codex Proxy, Lopu Conflict Resolver, main Branch, PR #475 (+6 more)

### Community 36 - "Saved Agent overview workspace"
Cohesion: 0.17
Nodes (11): Saved Agent overview workspace, docs/agent-overview.md, Bearer token API support, api.agent-overview capability, Signed JWT session cookie, mongodb/config.ts, Private agent workspace schemas, sessions collection (+3 more)

### Community 37 - "control-plane-events.test.mjs"
Cohesion: 0.18
Nodes (7): ci, workflow, classifyConversation(), classifyQueuedConversation(), hasAutomationMarker(), previewSummaryBody(), publishPreviewSummary()

### Community 38 - "stage-graphify-snapshots.mjs"
Cohesion: 0.36
Nodes (11): addExisting(), filesUnder(), git(), LEGACY_ROOT, missingFromWorktree(), PORTABLE, removeFromIndex(), restoreTrackedFromHead() (+3 more)

### Community 39 - "Repository-aware Graphify router"
Cohesion: 0.20
Nodes (11): Repository-aware Graphify router, Graphify, Graphify cost data, Graphify git hooks, graphify-out/graph.json, Graphify manifest, Graphify union merge driver, GRAPH_REPORT.md (+3 more)

### Community 40 - "Admin Preview Publisher"
Cohesion: 0.20
Nodes (11): Admin Preview Publisher, Develop Preview Controller, PR #603 Admin Preview Publisher Controller, Protected github-actions Branch, Thingtime GitHub App Bot, PR #595, Per-SHA Deployment Receipts, PR 596 (+3 more)

### Community 41 - "Resolve PR Conflicts Workflow"
Cohesion: 0.29
Nodes (10): Rebase PR Stacks Workflow, Rebase Conflict Round, Dispatch Child PR Transplants, Refresh Graphify Outputs After Rebase, Resolve PR Conflicts Workflow, Detect Merge-Conflicting PRs, Hand Off Selected PR Batch, Maintain All Branch (+2 more)

### Community 42 - "PR #661: Conflict Scans and Visible Previews"
Cohesion: 0.33
Nodes (6): Bounded PR Inventory, Routing Dependency Graph Regression, PR #592, PR #661: Conflict Scans and Visible Previews, Preview Description Helper, Target Ref Race Retry

### Community 43 - "cleanup"
Cohesion: 0.22
Nodes (7): cleanup(), command(), detach_watchdog_io(), process_inventory(), publish_watchdog_evidence(), record_remaining(), start_watchdog()

### Community 44 - "Resolve Promotion Job"
Cohesion: 0.22
Nodes (9): Feature Stack Merge Job, Feature Stack Plan Script, Feature Stack Publish Merge Script, Promotion Graphify Refresh Invocation, Promotion Worker Script, Promotion Worker Invocation, Feature Stack Merge Publisher Invocation, Promotion Graphify Refresh Script (+1 more)

### Community 45 - "preview-recovery.test.mjs"
Cohesion: 0.39
Nodes (6): previewWorkActive(), reconcilePreviewInventory(), recoveryAttempt(), recoverySourceIssue(), now, source

### Community 46 - "start.sh"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 47 - "Select Release Distribution"
Cohesion: 0.25
Nodes (8): Build Signed and Notarized Electron Release, Build Unsigned Electron Release, Derive SemVer PR Release Identity, Import Developer ID and Notarization Credentials, Resolve and Validate PR Source, Select Release Distribution, Thingtime Electron PR Release Workflow, Electron App Release

### Community 48 - "verify-promotion-source-authority.sh"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 49 - "Resolve PR job"
Cohesion: 0.33
Nodes (6): Revalidate queued PR snapshot step, read_live_stats, Resolve PR job, sync_progress_label_subset, sync_progress_labels, update_progress

### Community 50 - "Cascade to stacked PRs step"
Cohesion: 0.33
Nodes (6): Cascade to stacked PRs step, Finalize conflict batch maintenance job, Rebuild Graphify structure and semantic extraction step, Push merge commit step, Regenerate pinned pnpm lockfile step, Verify resolution and commit step

### Community 51 - "Thingtime API v1 routes"
Cohesion: 0.40
Nodes (6): API capability manifests, apiEndpointDocs registry, apiV1RouteKeys, Thingtime API v1 routes, API route file, API catch-all import map

### Community 52 - "Lopu agent composite action"
Cohesion: 0.33
Nodes (6): claude-code-action, Codex action, Repository-scoped GitHub token, Lopu agent composite action, Generated .lopu-waterfall-action, OpenAI provider waterfall

### Community 53 - "requestJson"
Cohesion: 0.33
Nodes (5): HttpError, isRetryableHttpResponse(), parseErrorCode(), requestJson(), retryDelayMs()

### Community 54 - "electron-release-gates.test.mjs"
Cohesion: 0.32
Nodes (7): allowed(), evaluate, expression, main, runXcodegenProvisioning(), workflow, xcodegenProvisioningStep()

### Community 56 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 57 - "vercel.json"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 58 - "safeHostname"
Cohesion: 0.50
Nodes (5): deploymentUrl(), isHostnameLabel(), isS3BucketHostname(), safeCorsProbeUrl(), safeHostname()

### Community 59 - "Feature Stack Status Responder"
Cohesion: 0.50
Nodes (5): PR #781 Feature Stack Action Status Responder, Merge Workers, Paired Product/API PR #782, Product Chat Capability, Feature Stack Status Responder

### Community 60 - "Thingtime Character coordination"
Cohesion: 0.50
Nodes (4): api.auth-characters capability, Thingtime Character coordination, Thingtime Agents subspace, Characters API

### Community 61 - "Control-plane changelog"
Cohesion: 0.18
Nodes (11): Control-plane changelog, Protected unsigned native compilation, Control-plane README, PR 1017: GitHub Lopu admin model waterfall, PR 634 Comment Admission Hardening, Cooperative Handover Protocol, PR #637 Safe Cooperative Handover, Fixed HTML Fallback (+3 more)

### Community 62 - "remix/scripts/worktree-ports.cjs"
Cohesion: 0.50
Nodes (4): remix/scripts/dev.mjs, remix/scripts/dev-nitro.cjs, remix/vite.config.ts, remix/scripts/worktree-ports.cjs

### Community 63 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 64 - "resolve-canonical-instruction-type-conflicts.sh"
Cohesion: 0.83
Nodes (3): resolve-canonical-instruction-type-conflicts.sh script, stage_record(), tree_record()

### Community 65 - "ref_node_url"
Cohesion: 0.18
Nodes (9): assertPrReleaseContract(), count(), here, workflow, publishMerge(), baseSha, fixture(), head (+1 more)

### Community 66 - "Review Handoff Job"
Cohesion: 0.67
Nodes (3): Lopu Review Queue Script, Review Handoff Job, Review Queue Helper Invocation

### Community 67 - "api/utils/mongodb/collections.ts"
Cohesion: 0.67
Nodes (3): api/utils/mongodb/collections.ts, mongodb/collectionNames.ts, things_v2 collection

### Community 68 - "Feature Stack Progress Reporter"
Cohesion: 0.67
Nodes (3): Feature Stack Progress Heartbeat Controller, Feature Stack Progress Reporter, Feature Stack Target Workers

### Community 69 - "PR 609 Codex Preview Manager Reliability"
Cohesion: 0.67
Nodes (3): PR 609 Codex Preview Manager Reliability, Thingtime Credential Vault Router, Lopu Admission Contract

## Ambiguous Edges - Review These
- `Thingtime AI instructions` → `Thingtime AI instructions`  [AMBIGUOUS]
  CLAUDE.md · relation: references
- `Lopu agent composite action` → `Lopu agent composite action`  [AMBIGUOUS]
  .github/actions/lopu-agent/action.yml · relation: conceptually_related_to
- `Lopu PR Status Script` → `Release Analysis Inputs Preparation`  [AMBIGUOUS]
  .github/workflows/resolve-pr-conflicts.yml · relation: references
- `Merge base into head step` → `Resolve conflicts with Lopu step`  [AMBIGUOUS]
  .github/workflows/resolve-pr-conflicts.yml · relation: conceptually_related_to

## Knowledge Gaps
- **194 isolated node(s):** `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR`, `BASE_REF`, `BASE_SHA` (+189 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 447 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **41 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Lopu agent composite action` connect `Lopu agent composite action` to `lopu-cooperative-review.mjs`, `Thingtime AI instructions`, `lopu-model-waterfall.mjs`?**
  _High betweenness centrality (0.123) - this node is a cross-community bridge._
- **What connects `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR` to the rest of the system?**
  _194 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `promote-features-to-main.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Why does `Thingtime AI instructions` connect `Thingtime AI instructions` to `api/utils/mongodb/collections.ts`, `Saved Agent overview workspace`, `Repository-aware Graphify router`, `Thingtime API v1 routes`, `Lopu agent composite action`, `Thingtime Character coordination`, `Control-plane changelog`, `remix/scripts/worktree-ports.cjs`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **Should `deploy-admin-pr-previews.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.07027027027027027 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Thingtime AI instructions` and `Thingtime AI instructions`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Lopu agent composite action` and `Lopu agent composite action`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._