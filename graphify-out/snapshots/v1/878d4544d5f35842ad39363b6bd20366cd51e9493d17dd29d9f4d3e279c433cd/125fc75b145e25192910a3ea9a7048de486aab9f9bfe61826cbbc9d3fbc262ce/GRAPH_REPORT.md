# Graph Report - thingtime  (2026-10-30)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1487 nodes · 3525 edges · 115 communities (69 shown, 46 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 55 edges (avg confidence: 0.84)
- Token cost: 4,525 input · 1,018 output

## Graph Freshness
- Built from commit: `4a012fff`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Promotion Planning and Execution
- Admin Pull Request Previews
- Production Deployment Workflow
- Graph Snapshot Management
- Native Compilation Security Tests
- Credential Vault and Model Routing
- Develop Pull Request Previews
- Promotion Pull Request Changelogs
- Preview Fallback Handling
- Branch Build Automation
- Cooperative Code Review
- Release and Credential Tests
- Orphan Preview Cleanup
- AI Agent Instructions
- Pull Request Conflict Routing
- Trusted Pull Request Validation
- Pull Request Status Reporting
- Workflow Control Plane Contracts
- Secure Archive Extraction Tests
- Deployment Lifecycle Management
- Promotion Graph Refresh
- Protected Native Compilation
- CodeQL Pull Request Backfill
- Vercel Preview Deployment
- Feature Stack Chat and Progress
- Main Develop Synchronization
- Agent Workflow Scripts
- Pull Request Lifecycle Management
- Feature Stack Planning and Merging
- Promotion Worker Contracts
- Isolated Build Process Supervision
- Rebase State Fingerprinting Tests
- Rebase Conflict Preparation
- Promotion Worker Execution
- Promotion Workflow Routing
- Branch Synchronization and Review
- Agent Overview Workspace API
- Conversation Automation Gates
- Graphify Snapshot Staging
- Graphify Repository Integration
- Preview Deployment Controllers
- Pull Request Stack Maintenance
- Feature Stack Merge Publishing
- Process Cleanup and Watchdogs
- Feature Stack Merge Workflows
- Preview Recovery Automation
- Rebase Workflow Startup
- Electron Release Workflows
- Promotion Source Verification
- Pull Request Progress Updates
- Conflict Resolution Workflow Steps
- API Capability Manifest Registry
- AI Agent Provider Routing
- HTTP Retry Utilities
- Electron Release Gate Tests
- Rebase Index Fingerprinting
- Pull Request Inventory and Previews
- Vercel Project Configuration
- Deployment Hostname Validation
- Feature Stack Status Reporting
- Thingtime Character Coordination
- Control Plane Documentation
- Remix Development Scripts
- Rebase Ownership Contracts
- Canonical Instruction Conflict Resolution
- Preview Fallback Rollout
- Pull Request Review Handoffs
- Thingtime Collection Storage
- Feature Stack Progress Reporting
- Agent Preview and Admission Reliability
- Pull Request Status and Release Analysis
- Pull Request Conflict Resolution
- Web CI Workflows
- Browser and Credential Automation
- Remix PM2 Configuration
- Thingtime Parent Relationships
- CodeQL and Rebase Workflows
- Promotion Workflows
- Protected Branch Auto-Merge
- Cooperative Review Handoffs
- Conflict Resolution Workers
- Release Analysis Continuation
- Review Session Continuation
- Pull Request Attention Comments
- Feature Stack Merge Gates
- Feature Stack Planning Jobs
- Feature Stack Receipt Reconciliation
- Feature Stack Session Continuation
- Promotion Attestation
- Model Configuration Workflow
- Verified Publication Workflow
- Claude Design Projects
- Semantic Graph Cache
- Semantic Cache Variants
- Immutable Graph Snapshots
- Themes API
- Legacy User Collections
- Rebase Conflict Actions
- Branch Integration Workflow
- CI Control Plane
- Vercel Deployment Workflow
- PR Preview Workflow
- PR Lifecycle Management
- Native Compilation Workflow
- CodeQL PR Handoff
- Release Job Automation
- GitHub Admin Model Changes
- Controlled Gateway Publication
- Vercel Preview Cleanup
- Vault Credential Integration
- PR Comment Admission Security
- Preview Recovery Workflow
- PR Gateway Routing

## God Nodes (most connected - your core abstractions)
1. `runPromotion()` - 64 edges
2. `selfTest()` - 53 edges
3. `runSelfTest()` - 53 edges
4. `NativeCompileBoundaryTests` - 48 edges
5. `Thingtime AI instructions` - 45 edges
6. `reconcile()` - 38 edges
7. `deploy()` - 31 edges
8. `failureDetail()` - 28 edges
9. `publish()` - 28 edges
10. `githubRequest()` - 23 edges

## Surprising Connections (you probably didn't know these)
- `Thingtime AI instructions` --references--> `Control-plane regression checklist`  [EXTRACTED]
  AGENTS.md → .github/TESTING.md
- `Thingtime AI instructions` --references--> `Lopu agent composite action`  [EXTRACTED]
  AGENTS.md → .github/actions/lopu-agent/action.yml
- `Thingtime AI instructions` --references--> `Protected unsigned native compilation`  [EXTRACTED]
  AGENTS.md → .github/NATIVE_COMPILE.md
- `Control-plane README` --references--> `Protected unsigned native compilation`  [EXTRACTED]
  README.md → .github/NATIVE_COMPILE.md
- `assertCurrentPullRequest()` --calls--> `pullRequestIsLive()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/preview-retention-policy.mjs

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

## Communities (115 total, 46 thin omitted)

### Community 0 - "Promotion Planning and Execution"
Cohesion: 0.05
Nodes (133): applyPicks(), attestationMatches(), botCommentsByLatestEvent(), buildPromotionDispatchRequest(), buildPromotionPlanContext(), cancelPromotionRetirement(), CFG, checkoutRemoteBranch() (+125 more)

### Community 1 - "Admin Pull Request Previews"
Cohesion: 0.07
Nodes (67): ACTIVE_STATES, assertCurrentPullRequest(), assertPrebuiltOutput(), assignAlias(), boundedInteger(), cleanupDeploymentIssue(), cleanupEnvironment(), commentBody() (+59 more)

### Community 2 - "Production Deployment Workflow"
Cohesion: 0.09
Nodes (62): Production storage runtime monitor workflow, applyOutputPolicy(), visit(), assertGatewaySource(), assertPreviewOpen(), compatibilityAliasCandidates(), context(), deploymentArgs() (+54 more)

### Community 3 - "Graph Snapshot Management"
Cohesion: 0.09
Nodes (60): activateSnapshot(), artifactHash(), baselineNodeCount(), compareSnapshotQuality(), computeSourceFingerprint(), copyPortableFiles(), DEFAULT_SNAPSHOT_RETENTION, dropNestedRepositories() (+52 more)

### Community 5 - "Credential Vault and Model Routing"
Cohesion: 0.11
Nodes (38): Thingtime credential vault, models, CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest() (+30 more)

### Community 6 - "Develop Pull Request Previews"
Cohesion: 0.08
Nodes (41): ACTIVE_STATES, assertCustomDevelopEnvironment(), assertPrebuiltOutput(), assertPreviewMaster(), assertVercelConfiguration(), assertWildcardFallbackRuntimes(), CLEANUP_ACTIONS, cleanupDeployments() (+33 more)

### Community 7 - "Promotion Pull Request Changelogs"
Cohesion: 0.12
Nodes (41): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+33 more)

### Community 8 - "Preview Fallback Handling"
Cohesion: 0.09
Nodes (30): FALLBACK_BRANCH, FALLBACK_HEADER, FALLBACK_MARKER, fallbackDeploymentIssue(), fallbackDomainIssue(), fallbackPage(), fallbackResponseIssue(), installFallbackAliases() (+22 more)

### Community 9 - "Branch Build Automation"
Cohesion: 0.16
Nodes (36): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), completeRefspecs, countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode() (+28 more)

### Community 10 - "Cooperative Code Review"
Cohesion: 0.11
Nodes (28): checkpoint(), completedReport(), continuationNumbers(), finalize(), git(), HANDOVER_INSTRUCTIONS, initialize(), numbers() (+20 more)

### Community 11 - "Release and Credential Tests"
Cohesion: 0.10
Nodes (12): allowed, workflow, assertPrReleaseContract(), count(), here, workflow, script, postPublishRefRace() (+4 more)

### Community 12 - "Orphan Preview Cleanup"
Cohesion: 0.15
Nodes (25): ACTIVE, assertPreviewHasOpenPullRequest(), completeInventory(), deploymentLane(), idOf(), missing(), openBranchPullRequests(), previewIdentity() (+17 more)

### Community 13 - "AI Agent Instructions"
Cohesion: 0.07
Nodes (29): ensure-bcrypt, Canonical instruction file, claude-todo roadmap, DECISIONS.md, Dev server port coordination, drop-stale-collection-generations migration, Root PM2 ecosystem config, markitdown-filetypes.md (+21 more)

### Community 14 - "Pull Request Conflict Routing"
Cohesion: 0.13
Nodes (26): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertCapturedStdoutStaysClean(), assertRoute(), assertWorkflowSource(), CALLS_HELPER(), decodeBatch() (+18 more)

### Community 15 - "Trusted Pull Request Validation"
Cohesion: 0.15
Nodes (26): assertCurrentPullRequest(), assertPreviewBundle(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), boundedInteger(), dispatchPullRequestIssue() (+18 more)

### Community 16 - "Pull Request Status Reporting"
Cohesion: 0.17
Nodes (25): argument(), branchCode(), classifyInventory(), count(), dateParts(), desiredFactLabels(), escapeHtml(), FACT_LABEL_ORDER (+17 more)

### Community 17 - "Workflow Control Plane Contracts"
Cohesion: 0.13
Nodes (26): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertAdminWaterfallGrammar(), assertBareControlPlaneTree() (+18 more)

### Community 18 - "Secure Archive Extraction Tests"
Cohesion: 0.14
Nodes (5): extract_archive(), main(), _member_path(), self_test(), _validate_link()

### Community 19 - "Deployment Lifecycle Management"
Cohesion: 0.20
Nodes (26): assertNoProtectedAlias(), assignAliasVerified(), cleanupClosedPrResources(), cleanupComment(), cleanupPrResources(), createGithubDeployment(), dashboardUrl(), deploy() (+18 more)

### Community 20 - "Promotion Graph Refresh"
Cohesion: 0.14
Nodes (24): assert_control_metadata_unchanged(), assert_tool_boundary(), current_grafts_state(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT (+16 more)

### Community 21 - "Protected Native Compilation"
Cohesion: 0.12
Nodes (11): acquire_cleanup_lock(), arm_native(), drop_identity(), extract_candidate(), kernel_groups(), main(), native_deadline(), preflight_failure() (+3 more)

### Community 22 - "CodeQL Pull Request Backfill"
Cohesion: 0.21
Nodes (23): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), analysisSnapshotForPullRequest(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp() (+15 more)

### Community 23 - "Vercel Preview Deployment"
Cohesion: 0.19
Nodes (23): choosePreferredDeployment(), chooseStableDevelopDeployment(), classifyPullRequest(), createVercelDeployment(), deploymentIdentityIssue(), deploymentMetadata(), deployPrebuiltOutput(), guardPreviewUpload() (+15 more)

### Community 24 - "Feature Stack Chat and Progress"
Cohesion: 0.16
Nodes (17): answerCommand(), answerQuestion(), CHAT_SYSTEM_PROMPT, safeRunContext(), serveRunChat(), githubJobs(), githubStackPullRequests(), postProgress() (+9 more)

### Community 25 - "Main Develop Synchronization"
Cohesion: 0.17
Nodes (18): assertHeadContainsMain(), assertSyncPullRequestShape(), exactSha(), EXPECTED_MERGE_REJECTIONS, githubRequest(), GitHubRequestError, headContainsMain(), mergeStandingSyncPullRequest() (+10 more)

### Community 26 - "Agent Workflow Scripts"
Cohesion: 0.12
Nodes (19): CodeQL Disposition Writer Invocation, CodeQL Dispositions Job, Apply CodeQL Dispositions, Feature Stack Chat Script, Feature Stack Progress Job, Feature Stack Progress Reporter Invocation, Feature Stack Progress Script, Feature Stack Verifier Script (+11 more)

### Community 27 - "Pull Request Lifecycle Management"
Cohesion: 0.20
Nodes (16): approved(), eligible(), identity(), managed(), pauses, redundant(), selectPulls(), settle() (+8 more)

### Community 28 - "Feature Stack Planning and Merging"
Cohesion: 0.30
Nodes (14): canonicalFeatureStackPlan(), decodeFeatureStackPlan(), exactKeys(), featureStackId(), git(), selfTest(), validateWaterfall(), verifyFeatureStackHistory() (+6 more)

### Community 29 - "Promotion Worker Contracts"
Cohesion: 0.14
Nodes (17): BASE_REF, BASE_SHA, compute_plan_hash(), GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay() (+9 more)

### Community 30 - "Isolated Build Process Supervision"
Cohesion: 0.17
Nodes (14): admit_runner(), build_environment(), firewall_rules(), phase(), require_hosted_runner(), run(), supervise(), as_build() (+6 more)

### Community 31 - "Rebase State Fingerprinting Tests"
Cohesion: 0.28
Nodes (14): actionPath, copyTrustedTree(), extractVerifierScript(), filesUnder(), hashNamedFiles(), hashRebaseState(), hashTrustedTree(), makeStoppedRebase() (+6 more)

### Community 32 - "Rebase Conflict Preparation"
Cohesion: 0.28
Nodes (14): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_index_entries(), hash_rebase_state(), rebase_in_progress() (+6 more)

### Community 33 - "Promotion Worker Execution"
Cohesion: 0.37
Nodes (13): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+5 more)

### Community 34 - "Promotion Workflow Routing"
Cohesion: 0.14
Nodes (13): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, featureStackMergeIf, featureStackMergeJob, graphify, lopuAgent (+5 more)

### Community 35 - "Branch Synchronization and Review"
Cohesion: 0.15
Nodes (14): Clean Synchronization Lane, develop Branch, GitHub Exact-Head REST Merge, Semantic Graphify Extraction, Local Codex Proxy, Lopu Conflict Resolver, main Branch, PR #475 (+6 more)

### Community 36 - "Agent Overview Workspace API"
Cohesion: 0.17
Nodes (11): Saved Agent overview workspace, docs/agent-overview.md, Bearer token API support, api.agent-overview capability, Signed JWT session cookie, mongodb/config.ts, Private agent workspace schemas, sessions collection (+3 more)

### Community 37 - "Conversation Automation Gates"
Cohesion: 0.24
Nodes (5): ci, workflow, classifyConversation(), classifyQueuedConversation(), hasAutomationMarker()

### Community 38 - "Graphify Snapshot Staging"
Cohesion: 0.36
Nodes (11): addExisting(), filesUnder(), git(), LEGACY_ROOT, missingFromWorktree(), PORTABLE, removeFromIndex(), restoreTrackedFromHead() (+3 more)

### Community 39 - "Graphify Repository Integration"
Cohesion: 0.20
Nodes (11): Repository-aware Graphify router, Graphify, Graphify cost data, Graphify git hooks, graphify-out/graph.json, Graphify manifest, Graphify union merge driver, GRAPH_REPORT.md (+3 more)

### Community 40 - "Preview Deployment Controllers"
Cohesion: 0.20
Nodes (11): Admin Preview Publisher, Develop Preview Controller, PR #603 Admin Preview Publisher Controller, Protected github-actions Branch, Thingtime GitHub App Bot, PR #595, Per-SHA Deployment Receipts, PR 596 (+3 more)

### Community 41 - "Pull Request Stack Maintenance"
Cohesion: 0.29
Nodes (10): Rebase PR Stacks Workflow, Rebase Conflict Round, Dispatch Child PR Transplants, Refresh Graphify Outputs After Rebase, Resolve PR Conflicts Workflow, Detect Merge-Conflicting PRs, Hand Off Selected PR Batch, Maintain All Branch (+2 more)

### Community 42 - "Feature Stack Merge Publishing"
Cohesion: 0.31
Nodes (6): checkDisposition(), publishMerge(), baseSha, fixture(), head, success

### Community 43 - "Process Cleanup and Watchdogs"
Cohesion: 0.22
Nodes (7): cleanup(), command(), detach_watchdog_io(), process_inventory(), publish_watchdog_evidence(), record_remaining(), start_watchdog()

### Community 44 - "Feature Stack Merge Workflows"
Cohesion: 0.22
Nodes (9): Feature Stack Merge Job, Feature Stack Plan Script, Feature Stack Publish Merge Script, Promotion Graphify Refresh Invocation, Promotion Worker Script, Promotion Worker Invocation, Feature Stack Merge Publisher Invocation, Promotion Graphify Refresh Script (+1 more)

### Community 45 - "Preview Recovery Automation"
Cohesion: 0.39
Nodes (6): previewWorkActive(), reconcilePreviewInventory(), recoveryAttempt(), recoverySourceIssue(), now, source

### Community 46 - "Rebase Workflow Startup"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 47 - "Electron Release Workflows"
Cohesion: 0.25
Nodes (8): Build Signed and Notarized Electron Release, Build Unsigned Electron Release, Derive SemVer PR Release Identity, Import Developer ID and Notarization Credentials, Resolve and Validate PR Source, Select Release Distribution, Thingtime Electron PR Release Workflow, Electron App Release

### Community 48 - "Promotion Source Verification"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 49 - "Pull Request Progress Updates"
Cohesion: 0.33
Nodes (6): Revalidate queued PR snapshot step, read_live_stats, Resolve PR job, sync_progress_label_subset, sync_progress_labels, update_progress

### Community 50 - "Conflict Resolution Workflow Steps"
Cohesion: 0.33
Nodes (6): Cascade to stacked PRs step, Finalize conflict batch maintenance job, Rebuild Graphify structure and semantic extraction step, Push merge commit step, Regenerate pinned pnpm lockfile step, Verify resolution and commit step

### Community 51 - "API Capability Manifest Registry"
Cohesion: 0.40
Nodes (6): API capability manifests, apiEndpointDocs registry, apiV1RouteKeys, Thingtime API v1 routes, API route file, API catch-all import map

### Community 52 - "AI Agent Provider Routing"
Cohesion: 0.33
Nodes (6): claude-code-action, Codex action, Repository-scoped GitHub token, Lopu agent composite action, Generated .lopu-waterfall-action, OpenAI provider waterfall

### Community 53 - "HTTP Retry Utilities"
Cohesion: 0.33
Nodes (5): HttpError, isRetryableHttpResponse(), parseErrorCode(), requestJson(), retryDelayMs()

### Community 54 - "Electron Release Gate Tests"
Cohesion: 0.40
Nodes (5): allowed(), evaluate, expression, main, workflow

### Community 55 - "Rebase Index Fingerprinting"
Cohesion: 0.60
Nodes (4): rawIndexHash(), runGit(), semanticIndexHash(), sha256()

### Community 56 - "Pull Request Inventory and Previews"
Cohesion: 0.33
Nodes (6): Bounded PR Inventory, Routing Dependency Graph Regression, PR #592, PR #661: Conflict Scans and Visible Previews, Preview Description Helper, Target Ref Race Retry

### Community 57 - "Vercel Project Configuration"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 58 - "Deployment Hostname Validation"
Cohesion: 0.50
Nodes (5): deploymentUrl(), isHostnameLabel(), isS3BucketHostname(), safeCorsProbeUrl(), safeHostname()

### Community 59 - "Feature Stack Status Reporting"
Cohesion: 0.50
Nodes (5): PR #781 Feature Stack Action Status Responder, Merge Workers, Paired Product/API PR #782, Product Chat Capability, Feature Stack Status Responder

### Community 60 - "Thingtime Character Coordination"
Cohesion: 0.50
Nodes (4): api.auth-characters capability, Thingtime Character coordination, Thingtime Agents subspace, Characters API

### Community 61 - "Control Plane Documentation"
Cohesion: 0.67
Nodes (3): Control-plane changelog, Protected unsigned native compilation, Control-plane README

### Community 62 - "Remix Development Scripts"
Cohesion: 0.50
Nodes (4): remix/scripts/dev.mjs, remix/scripts/dev-nitro.cjs, remix/vite.config.ts, remix/scripts/worktree-ports.cjs

### Community 63 - "Rebase Ownership Contracts"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 64 - "Canonical Instruction Conflict Resolution"
Cohesion: 0.83
Nodes (3): resolve-canonical-instruction-type-conflicts.sh script, stage_record(), tree_record()

### Community 65 - "Preview Fallback Rollout"
Cohesion: 0.50
Nodes (4): Fixed HTML Fallback, PR #643 Missing-build Page, Preview Wildcard Domains, Protected Rollout

### Community 66 - "Pull Request Review Handoffs"
Cohesion: 0.67
Nodes (3): Lopu Review Queue Script, Review Handoff Job, Review Queue Helper Invocation

### Community 67 - "Thingtime Collection Storage"
Cohesion: 0.67
Nodes (3): api/utils/mongodb/collections.ts, mongodb/collectionNames.ts, things_v2 collection

### Community 68 - "Feature Stack Progress Reporting"
Cohesion: 0.67
Nodes (3): Feature Stack Progress Heartbeat Controller, Feature Stack Progress Reporter, Feature Stack Target Workers

### Community 69 - "Agent Preview and Admission Reliability"
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
- **196 isolated node(s):** `GIT_ATTR_NOSYSTEM`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_KEY_0`, `GIT_CONFIG_KEY_1` (+191 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 438 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **46 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Lopu agent composite action` connect `AI Agent Provider Routing` to `Cooperative Code Review`, `AI Agent Instructions`, `Credential Vault and Model Routing`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **What connects `GIT_ATTR_NOSYSTEM`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_GLOBAL` to the rest of the system?**
  _196 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Promotion Planning and Execution` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Why does `Thingtime AI instructions` connect `AI Agent Instructions` to `Thingtime Collection Storage`, `Agent Overview Workspace API`, `Graphify Repository Integration`, `Browser and Credential Automation`, `Remix PM2 Configuration`, `API Capability Manifest Registry`, `AI Agent Provider Routing`, `Thingtime Character Coordination`, `Control Plane Documentation`, `Remix Development Scripts`?**
  _High betweenness centrality (0.101) - this node is a cross-community bridge._
- **Should `Admin Pull Request Previews` be split into smaller, more focused modules?**
  _Cohesion score 0.07027027027027027 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Thingtime AI instructions` and `Thingtime AI instructions`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Lopu agent composite action` and `Lopu agent composite action`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._