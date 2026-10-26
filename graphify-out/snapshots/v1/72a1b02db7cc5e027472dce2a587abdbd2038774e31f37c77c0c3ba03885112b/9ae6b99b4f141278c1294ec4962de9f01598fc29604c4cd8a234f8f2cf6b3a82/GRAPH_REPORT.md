# Graph Report - thingtime  (2026-10-26)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1340 nodes · 3155 edges · 77 communities (63 shown, 14 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 25 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `6c1b4dfb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- promote-features-to-main.mjs
- graphify-cas.mjs
- deploy-admin-pr-previews.mjs
- promotion-pr-changelog.mjs
- Thingtime AI instructions
- deploy-develop-pr-preview.mjs
- deploy-vercel-prebuilt.mjs
- build-all-branch.mjs
- runSelfTest
- lopu-cooperative-review.mjs
- lopu-model-waterfall.mjs
- ref_node_fs
- Control-plane changelog
- reconcile
- resolve-pr-conflicts-routing-contract.mjs
- prepare-round.sh
- lopu-pr-status.mjs
- workflow-control-plane-contract.mjs
- preview-fallback.mjs
- refresh-promotion-graphify.sh
- codeql-open-pr-backfill.mjs
- main
- resolve-pr-conflicts.yml
- ref_node_os
- merge-main-develop-sync-pr.mjs
- extract-vercel-prebuilt.py
- lopu-pr-lifecycle.mjs
- ref_node_path
- promotion-worker-contract.sh
- `github-actions` — the CI control plane
- PR #603 — Admin preview publisher controller
- control-plane-events.test.mjs
- rebase-related-edits.test.mjs
- promotion-worker.sh
- preview-labels.mjs
- promotion-worker-routing-contract.mjs
- Thingtime AI instructions
- stage-graphify-snapshots.mjs
- Control-plane regression checklist
- ref_node_child_process
- PR #609 — Restore Lopu and preview admission
- PR #643 — Missing-build page for unassigned PR preview URLs
- PR 1017: GitHub Lopu admin model waterfall
- graphify
- CHANGELOG.md
- preview-recovery.test.mjs
- start.sh
- Select Release Distribution
- verify-promotion-source-authority.sh
- PR #534 — Feature Stack progress heartbeat controller
- electron-release-gates.test.mjs
- README.md
- PR #506 — Auto-merge resolved main to develop sync PR
- PR #634: Lopu comment admission and idempotent preview writes
- PR #661: conflict scans and visible previews
- Feature Stack Status Responder
- vercel.json
- rebase-index-fingerprint.test.mjs
- PR #492 — Load Lopu credentials from the Thingtime vault
- PR #637: Safe cooperative handover for Lopu reviews
- safeHostname
- rebase-ownership-routing-contract.sh
- resolve-canonical-instruction-type-conflicts.sh
- mongodb/collectionNames.ts
- Lopu Agent Action
- Single CodeQL Analysis Owner
- Trusted Preview Build and Publish Pipeline
- Lopu internal develop promotion
- GitHub Native Auto-Merge
- Cooperative Handover Protocol
- Rebase Conflict Round Action
- CodeQL PR handoff workflow
- Commander Release Job
- Control Plane CI Workflow
- Vercel Prebuilt Deployment Workflow
- Lopu PR Lifecycle Workflow
- PR #611 Preview Recovery

## God Nodes (most connected - your core abstractions)
1. `runPromotion()` - 64 edges
2. `selfTest()` - 53 edges
3. `runSelfTest()` - 52 edges
4. `reconcile()` - 35 edges
5. `failureDetail()` - 28 edges
6. `deploy()` - 27 edges
7. `main()` - 22 edges
8. `orphanedMergeHydrationIntegrationTest()` - 21 edges
9. `publish()` - 21 edges
10. `Thingtime AI instructions` - 21 edges

## Surprising Connections (you probably didn't know these)
- `PR 1017: GitHub Lopu admin model waterfall` --references--> `Post-merge Graphify refresh`  [EXTRACTED]
  PRs/1017-codex-lopu-astra-vault-admin-model-waterfall.md → .github/workflows/resolve-pr-conflicts.yml
- `GitHub Exact-Head REST Merge` --references--> `develop branch`  [EXTRACTED]
  PRs/506-codex-auto-merge-main-develop-sync-pr.md → README.md
- `sync/main-into-develop PR` --references--> `develop branch`  [EXTRACTED]
  PRs/506-codex-auto-merge-main-develop-sync-pr.md → README.md
- `sync/main-into-develop PR` --references--> `main branch`  [EXTRACTED]
  PRs/506-codex-auto-merge-main-develop-sync-pr.md → README.md
- `API Suite Job` --references--> `Thingtime API`  [EXTRACTED]
  .github/workflows/web-ci.yml → AGENTS.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Shared CI provider routing contract** — github_workflows_promote_develop_to_main_route, github_workflows_promote_features_to_main_route [EXTRACTED 0.80]
- **develop→main promotion and back-sync automation** — github_workflows_promote_develop_to_main_workflow, github_workflows_promote_features_to_main_workflow, github_scripts_promote_features_to_main, github_scripts_promotion_pr_changelog [EXTRACTED 0.85]
- **Validation Check Suite** — prs_506_codex_auto_merge_main_develop_sync_pr_pr_506, prs_506_codex_auto_merge_main_develop_sync_pr_self_tests, prs_506_codex_auto_merge_main_develop_sync_pr_graphify_extraction, prs_506_codex_auto_merge_main_develop_sync_pr_local_codex_proxy [EXTRACTED 0.85]
- **Admin Preview Publication Flow** — prs_603_codex_admin_preview_publisher_controller_admin_preview_publisher, prs_603_codex_admin_preview_publisher_controller_github_actions_branch, prs_642_vercel_deployment [EXTRACTED 0.90]
- **Operational Proof Gate** — prs_506_codex_auto_merge_main_develop_sync_pr_pr_475, prs_506_codex_auto_merge_main_develop_sync_pr_protected_lopu_entrypoint, prs_506_codex_auto_merge_main_develop_sync_pr_sync_main_into_develop_pr, agents_main_branch, agents_develop_branch [EXTRACTED 0.90]
- **Paired Status Responder Rollout** — prs_781_codex_stack_progress_chat_controller_answer_feature_stack_status_questions_status_responder, prs_781_codex_stack_progress_chat_controller_answer_feature_stack_status_questions_product_chat_capability, prs_781_codex_stack_progress_chat_controller_answer_feature_stack_status_questions_product_api_pr_782 [EXTRACTED 0.90]
- **Terminal Merge Safety Gate** — prs_506_codex_auto_merge_main_develop_sync_pr_trusted_terminal_merger, prs_506_codex_auto_merge_main_develop_sync_pr_thingtime_repository, prs_506_codex_auto_merge_main_develop_sync_pr_sync_main_into_develop_pr, agents_develop_branch, agents_main_branch, prs_506_codex_auto_merge_main_develop_sync_pr_exact_head_rest_merge [EXTRACTED 0.90]
- **PR conflict merge, publish, and graph refresh lifecycle** — .github_workflows_resolve_pr_conflicts, conflict_resolution, graphify_refresh [EXTRACTED 0.94]
- **Atomic Thing records and relational child data** — agents_things_collection, agents_parentid, agents_reactions_comments, agents_thingtime_database [EXTRACTED 0.95]
- **Graphify immutable publication flow** — agents_graphify_router, agents_graphify_snapshots, agents_graphify_cache, agents_graphify_update [EXTRACTED 0.95]
- **Isolated rebase conflict resolution flow** — agents_rebase_conflict_round_action, agents_repo_less_scratch, agents_scratch_verifier, agents_rebase_stack_scripts [EXTRACTED 0.95]
- **Commander Signed Release Pipeline** — github_workflows_commander_release_release [EXTRACTED 0.95]
- **Cooperative Review Handover Flow** — prs_637_codex_lopu_cooperative_handoff_safely_hand_batch_reviews_over_to_waiting_work_cooperative_handover_protocol, prs_637_codex_lopu_cooperative_handoff_safely_hand_batch_reviews_over_to_waiting_work_pr_637 [EXTRACTED 0.95]
- **Electron Release Distribution Flow** — github_workflows_electron_pr_release_resolve_validate_pr_source, github_workflows_electron_pr_release_select_release_distribution, github_workflows_electron_pr_release_derive_semver_pr_release_identity, github_workflows_electron_pr_release_build_signed_release, github_workflows_electron_pr_release_build_unsigned_release [EXTRACTED 0.95]
- **Feature Stack Progress Reporting** — prs_534_codex_feature_stack_progress_heartbeats_controller, prs_534_codex_feature_stack_progress_heartbeats_controller_reporter, prs_534_codex_feature_stack_progress_heartbeats_controller_target_workers [EXTRACTED 0.95]
- **PR Resolution and Review Lifecycle** — github_workflows_resolve_pr_conflicts_yml_feature_stack_merge, github_workflows_resolve_pr_conflicts_yml_pr_review, github_workflows_resolve_pr_conflicts_yml_codeql_triage, github_workflows_resolve_pr_conflicts_yml_promotion_resolution, github_workflows_resolve_pr_conflicts_yml_pr_progress [EXTRACTED 0.95]
- **PR #661 Delivery Reliability Repairs** — prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_pr_661_conflict_scans_and_visible_previews, prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_dependency_graph_regression, prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_bounded_pr_inventory, prs_661_codex_pr_delivery_reliability_592_restore_conflict_scans_and_visible_previews_ref_race_retry [EXTRACTED 0.95]
- **Missing-build Preview Rollout** — prs_643_codex_preview_no_build_page_show_a_no_build_page_for_unassigned_pr_preview_urls_preview_wildcard_domains, prs_643_codex_preview_no_build_page_show_a_no_build_page_for_unassigned_pr_preview_urls_fixed_html_fallback, prs_643_codex_preview_no_build_page_show_a_no_build_page_for_unassigned_pr_preview_urls_protected_rollout [EXTRACTED 0.95]
- **Scheduled Preview Recovery Flow** — prs_642_preview_status_recovery, prs_642_scheduled_controller, prs_642_deployment_receipts, prs_642_vercel_deployment [EXTRACTED 0.95]
- **Gateway publication environment policy** — prs_1225_codex_gateway_publisher_policy_publish_controlled_environment_gateway_owners_pr1225_controlled_environment_gateway_publication, prs_codex_gateway_alias_propagation_standard_preview_target, controlled_gateway_routing [EXTRACTED 0.96]
- **Protected Lopu PR Management Control Plane** — github_workflows_resolve_pr_conflicts_yml, github_workflows_resolve_pr_conflicts_yml_detect, github_workflows_resolve_pr_conflicts_yml_review_detect, github_workflows_resolve_pr_conflicts_yml_handoff [EXTRACTED 0.96]
- **Safe Stacked PR Rebase Cascade** — github_workflows_rebase_pr_stacks_yml_snapshot_and_hold_direct_child_prs, github_workflows_rebase_pr_stacks_yml_force_push_fully_verified_rewritten_history_once, github_workflows_rebase_pr_stacks_yml_dispatch_exact_child_transplants [EXTRACTED 0.98]
- **Immutable Promotion and Feature Stack Validation** — github_workflows_resolve_pr_conflicts_yml_promotion_validate, github_workflows_resolve_pr_conflicts_yml_feature_stack_plan, github_workflows_resolve_pr_conflicts_yml_model_config, github_workflows_resolve_pr_conflicts_yml_feature_stack_merge [INFERRED 0.82]

## Communities (77 total, 14 thin omitted)

### Community 0 - "promote-features-to-main.mjs"
Cohesion: 0.05
Nodes (133): applyPicks(), attestationMatches(), botCommentsByLatestEvent(), buildPromotionDispatchRequest(), buildPromotionPlanContext(), cancelPromotionRetirement(), CFG, checkoutRemoteBranch() (+125 more)

### Community 1 - "graphify-cas.mjs"
Cohesion: 0.09
Nodes (60): activateSnapshot(), artifactHash(), baselineNodeCount(), compareSnapshotQuality(), computeSourceFingerprint(), copyPortableFiles(), DEFAULT_SNAPSHOT_RETENTION, dropNestedRepositories() (+52 more)

### Community 2 - "deploy-admin-pr-previews.mjs"
Cohesion: 0.08
Nodes (62): ACTIVE_STATES, assertCurrentPullRequest(), assertPrebuiltOutput(), assignAlias(), boundedInteger(), cleanupDeploymentIssue(), cleanupEnvironment(), commentBody() (+54 more)

### Community 3 - "promotion-pr-changelog.mjs"
Cohesion: 0.12
Nodes (41): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+33 more)

### Community 4 - "Thingtime AI instructions"
Cohesion: 0.06
Nodes (38): API Suite Job, Build Typecheck Ratchet Unit Tests Job, Product Contract Advisories, Classify Web CI Scope Job, Web CI Workflow, POST /api/v1/auth/register, API utils layer, httpOnly signed JWT cookie (+30 more)

### Community 5 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.09
Nodes (35): ACTIVE_STATES, assertPrebuiltOutput(), assertVercelConfiguration(), assertWildcardFallbackRuntimes(), CLEANUP_ACTIONS, cleanupComment(), deploymentDetail(), deploymentListParams() (+27 more)

### Community 6 - "deploy-vercel-prebuilt.mjs"
Cohesion: 0.15
Nodes (34): applyOutputPolicy(), visit(), compatibilityAliasCandidates(), context(), deploymentArgs(), exec, existing(), github() (+26 more)

### Community 7 - "build-all-branch.mjs"
Cohesion: 0.16
Nodes (36): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), completeRefspecs, countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode() (+28 more)

### Community 8 - "runSelfTest"
Cohesion: 0.11
Nodes (37): assertCustomDevelopEnvironment(), assertNoProtectedAlias(), assertPreviewMaster(), assertTrustedPullRequest(), cancelAndDeleteDeployment(), choosePreferredDeployment(), chooseStableDevelopDeployment(), classifyPullRequest() (+29 more)

### Community 9 - "lopu-cooperative-review.mjs"
Cohesion: 0.11
Nodes (28): checkpoint(), completedReport(), continuationNumbers(), finalize(), git(), HANDOVER_INSTRUCTIONS, initialize(), numbers() (+20 more)

### Community 10 - "lopu-model-waterfall.mjs"
Cohesion: 0.15
Nodes (31): models, exportBundle(), fetchBundle(), legacyCredentials(), main(), required(), safeCache(), validate() (+23 more)

### Community 11 - "ref_node_fs"
Cohesion: 0.10
Nodes (16): CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest(), allowed, workflow (+8 more)

### Community 12 - "Control-plane changelog"
Cohesion: 0.07
Nodes (32): CI control plane, develop branch, github-actions branch, main branch, 2026-09-05 — Cooperative review handover and preview recovery, 2026-09-05 — Desktop and Recovery cloud release repair, 2026-09-05 — Signed Commander releases and Recovery pairing, 2026-09-05 — Visible previews and conflict detector recovery (+24 more)

### Community 13 - "reconcile"
Cohesion: 0.19
Nodes (29): assertCurrentPullRequest(), assertTrustedPullRequestStack(), assignAliasVerified(), cleanupDeployments(), cleanupPrResources(), createGithubDeployment(), dashboardUrl(), deploy() (+21 more)

### Community 14 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.12
Nodes (26): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertCapturedStdoutStaysClean(), assertRoute(), assertWorkflowSource(), CALLS_HELPER(), decodeBatch() (+18 more)

### Community 15 - "prepare-round.sh"
Cohesion: 0.11
Nodes (25): Claude exact-session continuation, Git rebase, GITHUB_ACTION_PATH, GITHUB_WORKSPACE, .lopu-waterfall-action, REBASE_HEAD, Rebase conflict-resolution model prompt, .github/scripts/rebase-stack (+17 more)

### Community 16 - "lopu-pr-status.mjs"
Cohesion: 0.17
Nodes (25): argument(), branchCode(), classifyInventory(), count(), dateParts(), desiredFactLabels(), escapeHtml(), FACT_LABEL_ORDER (+17 more)

### Community 17 - "workflow-control-plane-contract.mjs"
Cohesion: 0.13
Nodes (26): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertAdminWaterfallGrammar(), assertBareControlPlaneTree() (+18 more)

### Community 18 - "preview-fallback.mjs"
Cohesion: 0.14
Nodes (19): FALLBACK_BRANCH, FALLBACK_HEADER, FALLBACK_MARKER, fallbackDeploymentIssue(), fallbackDomainIssue(), fallbackPage(), fallbackResponseIssue(), installFallbackAliases() (+11 more)

### Community 19 - "refresh-promotion-graphify.sh"
Cohesion: 0.14
Nodes (24): assert_control_metadata_unchanged(), assert_tool_boundary(), current_grafts_state(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT (+16 more)

### Community 20 - "codeql-open-pr-backfill.mjs"
Cohesion: 0.21
Nodes (23): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), analysisSnapshotForPullRequest(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp() (+15 more)

### Community 21 - "main"
Cohesion: 0.16
Nodes (23): assertPreviewBundle(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), boundedInteger(), dispatchPullRequestIssue(), EligibilityError, exactPrefixedId(), expectedReadyAt() (+15 more)

### Community 22 - "resolve-pr-conflicts.yml"
Cohesion: 0.10
Nodes (22): Deterministic Scratch Validation, Rebase PR Stacks Workflow, Dispatch Exact Child Transplants, Force Push Verified Rewritten History, Requeue Moving-Ref Race, Snapshot and Hold Direct Child PRs, All Open PRs Inventory, CodeQL Triage (+14 more)

### Community 23 - "ref_node_os"
Cohesion: 0.16
Nodes (17): answerCommand(), answerQuestion(), CHAT_SYSTEM_PROMPT, safeRunContext(), serveRunChat(), githubJobs(), githubStackPullRequests(), postProgress() (+9 more)

### Community 24 - "merge-main-develop-sync-pr.mjs"
Cohesion: 0.17
Nodes (18): assertHeadContainsMain(), assertSyncPullRequestShape(), exactSha(), EXPECTED_MERGE_REJECTIONS, githubRequest(), GitHubRequestError, headContainsMain(), mergeStandingSyncPullRequest() (+10 more)

### Community 25 - "extract-vercel-prebuilt.py"
Cohesion: 0.19
Nodes (5): extract_archive(), main(), _member_path(), self_test(), _validate_link()

### Community 26 - "lopu-pr-lifecycle.mjs"
Cohesion: 0.20
Nodes (16): approved(), eligible(), identity(), managed(), pauses, redundant(), selectPulls(), settle() (+8 more)

### Community 27 - "ref_node_path"
Cohesion: 0.30
Nodes (14): canonicalFeatureStackPlan(), decodeFeatureStackPlan(), exactKeys(), featureStackId(), git(), selfTest(), validateWaterfall(), verifyFeatureStackHistory() (+6 more)

### Community 28 - "promotion-worker-contract.sh"
Cohesion: 0.14
Nodes (17): BASE_REF, BASE_SHA, compute_plan_hash(), GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay() (+9 more)

### Community 29 - "`github-actions` — the CI control plane"
Cohesion: 0.12
Nodes (17): Commander signed releases, Desktop and Recovery release pipeline, Discoverable preview status and recovery, Environment gateways for future product builds, Fork setup: Vercel develop previews, `github-actions` — the CI control plane, Known trade-off, Lopu principal repository manager (+9 more)

### Community 30 - "PR #603 — Admin preview publisher controller"
Cohesion: 0.13
Nodes (15): Admin Preview Publisher, Compatibility fix, Develop Preview Controller, Protected github-actions Branch, Thingtime GitHub App Bot, Outcome, PR #595, PR #603 — Admin preview publisher controller (+7 more)

### Community 31 - "control-plane-events.test.mjs"
Cohesion: 0.21
Nodes (7): ci, workflow, classifyConversation(), classifyQueuedConversation(), hasAutomationMarker(), previewSummaryBody(), publishPreviewSummary()

### Community 32 - "rebase-related-edits.test.mjs"
Cohesion: 0.28
Nodes (14): actionPath, copyTrustedTree(), extractVerifierScript(), filesUnder(), hashNamedFiles(), hashRebaseState(), hashTrustedTree(), makeStoppedRebase() (+6 more)

### Community 33 - "promotion-worker.sh"
Cohesion: 0.37
Nodes (13): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+5 more)

### Community 34 - "preview-labels.mjs"
Cohesion: 0.24
Nodes (11): colors, ensureLabel(), hasPreviewLabels(), lanes, prefix(), previewBuildTime(), previewBuiltLabel(), syncOnce() (+3 more)

### Community 35 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.14
Nodes (13): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, featureStackMergeIf, featureStackMergeJob, graphify, lopuAgent (+5 more)

### Community 36 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 37 - "stage-graphify-snapshots.mjs"
Cohesion: 0.36
Nodes (11): addExisting(), filesUnder(), git(), LEGACY_ROOT, missingFromWorktree(), PORTABLE, removeFromIndex(), restoreTrackedFromHead() (+3 more)

### Community 38 - "Control-plane regression checklist"
Cohesion: 0.17
Nodes (12): Configured cross-provider waterfall, Control-plane regression checklist, Cooperative review handover, Event feedback and CI cancellation, Exact configured workflow model orders, Explicit stack model and endpoint waterfall, Feature Stack run status conversations, Feature Stack snapshot publication and merge gates (+4 more)

### Community 39 - "ref_node_child_process"
Cohesion: 0.31
Nodes (6): checkDisposition(), publishMerge(), baseSha, fixture(), head, success

### Community 40 - "PR #609 — Restore Lopu and preview admission"
Cohesion: 0.22
Nodes (8): Follow-up acceptance repair, Live diagnosis, Outcome, PR #609 — Restore Lopu and preview admission, Security boundary, Validation, Thingtime Credential Vault Router, Lopu Admission Contract

### Community 41 - "PR #643 — Missing-build page for unassigned PR preview URLs"
Cohesion: 0.22
Nodes (8): Cause and scope, Fixed HTML Fallback, PR #643 Missing-build Page, PR #643 — Missing-build page for unassigned PR preview URLs, Preview Wildcard Domains, Protected Rollout, Root response decision, Verification before merge

### Community 42 - "PR 1017: GitHub Lopu admin model waterfall"
Cohesion: 0.29
Nodes (7): resolve-pr-conflicts workflow, PR conflict resolution and publication, Controlled gateway environment routing, Post-merge Graphify refresh, PR 1017: GitHub Lopu admin model waterfall, PR1225 — Controlled environment gateway publication, Ordinary PR gateway routing with preserved develop credentials

### Community 43 - "graphify"
Cohesion: 0.25
Nodes (6): Graphify semantic CAS cache, Graphify hooks, .github/scripts/graphify prune, Repository-aware Graphify router, Graphify immutable snapshots, .github/scripts/graphify update

### Community 44 - "CHANGELOG.md"
Cohesion: 0.25
Nodes (4): Changes, Evidence and cause, PR #642: Discoverable preview status and missed-build repair, Validation and rollout

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

### Community 49 - "PR #534 — Feature Stack progress heartbeat controller"
Cohesion: 0.29
Nodes (7): Feature Stack Progress Heartbeat Controller, Outcome, PR #534 — Feature Stack progress heartbeat controller, Feature Stack Progress Reporter, Safety and cost, Feature Stack Target Workers, Validation

### Community 50 - "electron-release-gates.test.mjs"
Cohesion: 0.40
Nodes (5): allowed(), evaluate, expression, main, workflow

### Community 51 - "README.md"
Cohesion: 0.33
Nodes (4): Environment gateway publication, Existing workflow preflight verification, Prebuilt-only deployments (2026-10-23), Prebuilt-only Vercel deployments

### Community 52 - "PR #506 — Auto-merge resolved main to develop sync PR"
Cohesion: 0.33
Nodes (5): Operational proof gate, PR #506 — Auto-merge resolved main to develop sync PR, Problem, Resolution, Validation

### Community 53 - "PR #634: Lopu comment admission and idempotent preview writes"
Cohesion: 0.33
Nodes (6): PR 634 Comment Admission Hardening, Behavior, Evidence and scope, PR #634: Lopu comment admission and idempotent preview writes, Rollout, Validation

### Community 54 - "PR #661: conflict scans and visible previews"
Cohesion: 0.33
Nodes (6): Bounded PR Inventory, Routing Dependency Graph Regression, PR #592, PR #661: conflict scans and visible previews, Preview Description Helper, Target Ref Race Retry

### Community 55 - "Feature Stack Status Responder"
Cohesion: 0.40
Nodes (5): Merge Workers, PR #781 — Feature Stack action status responder, Paired Product/API PR #782, Product Chat Capability, Feature Stack Status Responder

### Community 56 - "vercel.json"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 57 - "rebase-index-fingerprint.test.mjs"
Cohesion: 0.80
Nodes (4): rawIndexHash(), runGit(), semanticIndexHash(), sha256()

### Community 58 - "PR #492 — Load Lopu credentials from the Thingtime vault"
Cohesion: 0.40
Nodes (4): PR #492 — Load Lopu credentials from the Thingtime vault, Safety and regression focus, Scope, Validation log

### Community 59 - "PR #637: Safe cooperative handover for Lopu reviews"
Cohesion: 0.40
Nodes (5): PR #611 recovery, PR #637: Safe cooperative handover for Lopu reviews, Protocol, Scope and evidence, Validation

### Community 60 - "safeHostname"
Cohesion: 0.67
Nodes (4): isHostnameLabel(), isS3BucketHostname(), safeCorsProbeUrl(), safeHostname()

### Community 61 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 62 - "resolve-canonical-instruction-type-conflicts.sh"
Cohesion: 0.83
Nodes (3): resolve-canonical-instruction-type-conflicts.sh script, stage_record(), tree_record()

## Knowledge Gaps
- **116 isolated node(s):** `GIT_ATTR_NOSYSTEM`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_KEY_0`, `GIT_CONFIG_KEY_1` (+111 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 387 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `selfTest()` connect `promote-features-to-main.mjs` to `ref_node_fs`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `GIT_ATTR_NOSYSTEM`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_GLOBAL` to the rest of the system?**
  _116 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `promote-features-to-main.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05063571033720288 - nodes in this community are weakly interconnected._
- **Why does `Control-plane changelog` connect `Control-plane changelog` to `CHANGELOG.md`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **Should `graphify-cas.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.08735733099209833 - nodes in this community are weakly interconnected._
- **Why does ``github-actions` — the CI control plane` connect ``github-actions` — the CI control plane` to `README.md`?**
  _High betweenness centrality (0.002) - this node is a cross-community bridge._
- **Should `deploy-admin-pr-previews.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.08231569425599276 - nodes in this community are weakly interconnected._