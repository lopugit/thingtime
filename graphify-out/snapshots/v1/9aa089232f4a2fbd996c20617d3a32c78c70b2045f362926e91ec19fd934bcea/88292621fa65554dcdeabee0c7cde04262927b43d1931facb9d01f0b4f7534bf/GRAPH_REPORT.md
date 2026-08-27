# Graph Report - /Users/lopu/.codex/worktrees/thingtime-graphify-alias-hotfix  (2026-08-27)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 660 nodes · 1426 edges · 50 communities (34 shown, 16 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.59)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e11ef299`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Vercel Preview Deployment|Vercel Preview Deployment]]
- [[_COMMUNITY_Graphify Snapshot Management|Graphify Snapshot Management]]
- [[_COMMUNITY_Promotion PR Changelog|Promotion PR Changelog]]
- [[_COMMUNITY_Promotion Retirement Logic|Promotion Retirement Logic]]
- [[_COMMUNITY_Branch Build Doctor|Branch Build Doctor]]
- [[_COMMUNITY_Promotion Review Checkpoints|Promotion Review Checkpoints]]
- [[_COMMUNITY_Feature Promotion Runner|Feature Promotion Runner]]
- [[_COMMUNITY_Promotion Reservation Planning|Promotion Reservation Planning]]
- [[_COMMUNITY_Workflow Control Plane|Workflow Control Plane]]
- [[_COMMUNITY_Automation Workflow Overview|Automation Workflow Overview]]
- [[_COMMUNITY_Graphify Refresh Safety|Graphify Refresh Safety]]
- [[_COMMUNITY_Repository Automation Labels|Repository Automation Labels]]
- [[_COMMUNITY_CodeQL Run Backfill|CodeQL Run Backfill]]
- [[_COMMUNITY_Promotion Worker Contract|Promotion Worker Contract]]
- [[_COMMUNITY_Conflict Resolution Routing|Conflict Resolution Routing]]
- [[_COMMUNITY_Promotion Worker Script|Promotion Worker Script]]
- [[_COMMUNITY_Rebase Round Preparation|Rebase Round Preparation]]
- [[_COMMUNITY_Global AI Instructions|Global AI Instructions]]
- [[_COMMUNITY_Promotion Workflow Routing|Promotion Workflow Routing]]
- [[_COMMUNITY_Graphify Snapshot Staging|Graphify Snapshot Staging]]
- [[_COMMUNITY_Develop Preview Controller|Develop Preview Controller]]
- [[_COMMUNITY_Rebase Start Script|Rebase Start Script]]
- [[_COMMUNITY_Claude Credential Classification|Claude Credential Classification]]
- [[_COMMUNITY_Promotion Dispatch Queue|Promotion Dispatch Queue]]
- [[_COMMUNITY_Promotion Source Authority|Promotion Source Authority]]
- [[_COMMUNITY_All Branch Build Workflow|All Branch Build Workflow]]
- [[_COMMUNITY_Trusted Rebase Round|Trusted Rebase Round]]
- [[_COMMUNITY_Vercel Configuration|Vercel Configuration]]
- [[_COMMUNITY_Electron PR Release Contract|Electron PR Release Contract]]
- [[_COMMUNITY_Rebase Ownership Routing|Rebase Ownership Routing]]
- [[_COMMUNITY_CodeQL Analysis Workflow|CodeQL Analysis Workflow]]
- [[_COMMUNITY_Stack Member Detection|Stack Member Detection]]
- [[_COMMUNITY_Development Server Tooling|Development Server Tooling]]
- [[_COMMUNITY_Internal Branch Promotion|Internal Branch Promotion]]
- [[_COMMUNITY_Build Doctor Agent|Build Doctor Agent]]
- [[_COMMUNITY_Web CI Testing|Web CI Testing]]
- [[_COMMUNITY_CI Provider Routing|CI Provider Routing]]
- [[_COMMUNITY_Electron Release Workflow|Electron Release Workflow]]
- [[_COMMUNITY_Graphify CLI|Graphify CLI]]
- [[_COMMUNITY_Lopu Agent Action|Lopu Agent Action]]
- [[_COMMUNITY_UI Validation|UI Validation]]
- [[_COMMUNITY_Delivery Messaging|Delivery Messaging]]
- [[_COMMUNITY_GitHub PR Publishing|GitHub PR Publishing]]
- [[_COMMUNITY_iOS Release Flow|iOS Release Flow]]
- [[_COMMUNITY_Core Fundamentals|Core Fundamentals]]
- [[_COMMUNITY_Lopu Agent Action|Lopu Agent Action]]
- [[_COMMUNITY_Commander Release Workflow|Commander Release Workflow]]
- [[_COMMUNITY_Legacy Conflict Resolver|Legacy Conflict Resolver]]
- [[_COMMUNITY_Develop Preview Deployment|Develop Preview Deployment]]
- [[_COMMUNITY_Electron PR Release Workflow|Electron PR Release Workflow]]

## God Nodes (most connected - your core abstractions)
1. `selfTest()` - 48 edges
2. `runPromotion()` - 35 edges
3. `failureDetail()` - 28 edges
4. `deploy()` - 26 edges
5. `runSelfTest()` - 24 edges
6. `main()` - 20 edges
7. `orphanedMergeHydrationIntegrationTest()` - 19 edges
8. `main()` - 15 edges
9. `repoFlag()` - 15 edges
10. `buildMode()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Thingtime AI Instructions` --semantically_similar_to--> `Thingtime AI Instructions`  [EXTRACTED] [semantically similar]
  AI_ALL.md → AGENTS.md
- `Thingtime AI Instructions` --semantically_similar_to--> `Thingtime AI Instructions`  [EXTRACTED] [semantically similar]
  CLAUDE.md → AGENTS.md
- `Web CI Workflow` --references--> `Testing Checklist`  [INFERRED]
  .github/workflows/web-ci.yml → TESTING.md
- `Graphify Rules` --semantically_similar_to--> `Graphify Rules`  [EXTRACTED] [semantically similar]
  AI_ALL.md → AGENTS.md
- `Graphify Rules` --semantically_similar_to--> `Graphify Rules`  [EXTRACTED] [semantically similar]
  CLAUDE.md → AGENTS.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Lopu Control Plane Automation** — readme_lopu_pr_manager, github_workflows_resolve_pr_conflicts_lopu_pr_manager, github_workflows_rebase_pr_stacks_rebase_engine, readme_codeql_analyzer [EXTRACTED 1.00]
- **Lopu Repository Management Lanes** — changelog_lopu_pr_manager, changelog_conflict_resolution, changelog_promotion, changelog_rebase_stack, changelog_codeql_triage, changelog_develop_main_sync [EXTRACTED 0.95]
- **Graphify Publication Flow** — changelog_graphify_snapshot_activation, changelog_graphify_publisher, changelog_semantic_cache_variants, changelog_lopu_pr_manager [EXTRACTED 0.90]
- **Protected Control Plane Architecture** — changelog_control_plane, changelog_github_actions_branch, changelog_thin_listeners, changelog_protected_controller, changelog_lopu_pr_manager [EXTRACTED 0.92]
- **Canonical Instruction Symlink Layout** — agents_ai_all_md, agents_root_symlinks, ai_all_thingtime_ai_instructions, claude_thingtime_ai_instructions [EXTRACTED 1.00]
- **Thingtime Data Access Contract** — agents_thingtime_api, agents_api_utils_layer, agents_mongodb_collections, agents_auth_sessions [EXTRACTED 1.00]
- **Rebase Conflict Round Flow** — github_actions_rebase_conflict_round_action_lopu_rebase_conflict_round, github_actions_rebase_conflict_round_action_bootstrap_step, github_actions_rebase_conflict_round_action_prepare_round, github_actions_rebase_conflict_round_action_lopu_agent_action, github_actions_rebase_conflict_round_action_claude_continuation [EXTRACTED 0.90]
- **Shared CI provider routing contract** — github_workflows_ci_provider_router_workflow, github_workflows_promote_develop_to_main_route, github_workflows_promote_features_to_main_route, github_workflows_resolve_pr_conflicts_workflow [EXTRACTED 0.80]
- **develop→main promotion and back-sync automation** — github_workflows_promote_develop_to_main_workflow, github_workflows_promote_features_to_main_workflow, github_workflows_sync_main_into_develop_workflow, github_workflows_resolve_pr_conflicts_workflow, github_scripts_promote_features_to_main, github_scripts_promotion_pr_changelog [EXTRACTED 0.85]
- **All-branch Doctor Build and Repair Flow** — _github_workflows_all_branch_rebuild_job, _github_workflows_all_branch_build_all_branch_script, _github_workflows_all_branch_union_build_check, _github_workflows_all_branch_doctor_round_1, _github_workflows_all_branch_doctor_commit [EXTRACTED 0.90]
- **Develop PR Preview Controller Flow** — github_workflows_develop_pr_preview_workflow, github_workflows_develop_pr_preview_dispatch_job, github_workflows_develop_pr_preview_repository_dispatch, github_workflows_develop_pr_preview_controller_event, github_workflows_develop_pr_preview_controller_job, github_workflows_develop_pr_preview_deploy_script [EXTRACTED 0.95]

## Communities (50 total, 16 thin omitted)

### Community 0 - "Vercel Preview Deployment"
Cohesion: 0.06
Nodes (95): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), assertVercelConfiguration(), assertWildcardFallbackRuntimes() (+87 more)

### Community 1 - "Graphify Snapshot Management"
Cohesion: 0.11
Nodes (43): activateSnapshot(), artifactHash(), baselineNodeCount(), computeSourceFingerprint(), copyPortableFiles(), ensureSnapshot(), fail(), finalizeSnapshot() (+35 more)

### Community 2 - "Promotion PR Changelog"
Cohesion: 0.11
Nodes (42): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+34 more)

### Community 3 - "Promotion Retirement Logic"
Cohesion: 0.09
Nodes (33): botCommentsByLatestEvent(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), externalStackPromotionState(), findBotPromotionRetirement(), groupFailureMessages(), groupKeyFor() (+25 more)

### Community 4 - "Branch Build Doctor"
Cohesion: 0.19
Nodes (31): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode(), git() (+23 more)

### Community 5 - "Promotion Review Checkpoints"
Cohesion: 0.11
Nodes (26): attestationMatches(), CFG, checkpointRecoveryDisposition(), createPromotionReviewCheckpoint(), encodePromotionAttestation(), env(), exactCheckpointPush(), EXEC_OPTS (+18 more)

### Community 6 - "Feature Promotion Runner"
Cohesion: 0.15
Nodes (30): cancelPromotionRetirement(), closeRedundantPass(), createPromotionPr(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata() (+22 more)

### Community 7 - "Promotion Reservation Planning"
Cohesion: 0.15
Nodes (28): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers(), failureDetail() (+20 more)

### Community 8 - "Workflow Control Plane"
Cohesion: 0.13
Nodes (26): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, ALLOWED_MODELS, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertBareControlPlaneTree() (+18 more)

### Community 9 - "Automation Workflow Overview"
Cohesion: 0.08
Nodes (25): Repository-Aware Graphify Router, Graphify Rules, Graphify Immutable Snapshots, Graphify Rules, Graphify Rules, Comment Contract Advisories Job, Contract Advisories Job, Control-plane CI Verify Job (+17 more)

### Community 10 - "Graphify Refresh Safety"
Cohesion: 0.12
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 11 - "Repository Automation Labels"
Cohesion: 0.11
Nodes (22): ai-merge-paused Label, CodeQL Backfill, CodeQL Triage, Conflict Resolution, Control Plane, Develop Main Synchronization, github-actions Branch, Graphify Publisher (+14 more)

### Community 12 - "CodeQL Run Backfill"
Cohesion: 0.22
Nodes (21): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), analysisSnapshotForPullRequest(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp() (+13 more)

### Community 13 - "Promotion Worker Contract"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay(), RESERVATION_SHA (+8 more)

### Community 14 - "Conflict Resolution Routing"
Cohesion: 0.20
Nodes (16): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), decodeBatch(), encodeBatch(), LOPU_ACTION_URL (+8 more)

### Community 15 - "Promotion Worker Script"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 16 - "Rebase Round Preparation"
Cohesion: 0.27
Nodes (13): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_rebase_state(), rebase_in_progress(), secure_git_environment() (+5 more)

### Community 17 - "Global AI Instructions"
Cohesion: 0.17
Nodes (13): AI_ALL.md, API Endpoint Registration, API Utils Layer, Auth Sessions, Canonical Instruction File, FUNDAMENTALS.md, Lopu Toast Notifications, Versioned MongoDB Collections (+5 more)

### Community 18 - "Promotion Workflow Routing"
Cohesion: 0.17
Nodes (11): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, graphify, lopuAgent, mainDevelopSyncWorkflow, promoter (+3 more)

### Community 19 - "Graphify Snapshot Staging"
Cohesion: 0.40
Nodes (9): addExisting(), filesUnder(), git(), LEGACY_ROOT, PORTABLE, restoreTrackedFromHead(), selfTest(), stageGraphifySnapshots() (+1 more)

### Community 20 - "Develop Preview Controller"
Cohesion: 0.20
Nodes (10): actions/checkout v4.4.0, develop-pr-preview-controller event, Publish or reconcile develop S3 preview job, .github/scripts/deploy-develop-pr-preview.mjs, Dispatch trusted default-branch controller job, GitHub repository dispatch API, VERCEL_DEVELOP_DEPLOY_TOKEN, vercel-develop-pr-control environment (+2 more)

### Community 21 - "Rebase Start Script"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 22 - "Claude Credential Classification"
Cohesion: 0.48
Nodes (6): CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest()

### Community 23 - "Promotion Dispatch Queue"
Cohesion: 0.33
Nodes (7): buildPromotionDispatchRequest(), dispatchPromotionResolution(), exactReservationDeleteArgs(), exactReservationPushArgs(), promotionDispatchArgs(), queueTrustedPromotionWorker(), redispatchPromotionReservation()

### Community 24 - "Promotion Source Authority"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 25 - "All Branch Build Workflow"
Cohesion: 0.33
Nodes (6): build-all-branch.mjs, Doctor Commit Command, Lopu Internal All-branch Integration Workflow, Build-doctor Model Waterfall Loader, Rebuild Job, Union Build Check

### Community 26 - "Trusted Rebase Round"
Cohesion: 0.40
Nodes (6): Copy Trusted Round Code Outside Model Workspace Step, Claude Continuation Step, hash_trusted_tree, lopu-agent Action, Lopu Rebase Conflict Round Action, prepare-round.sh

### Community 27 - "Vercel Configuration"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 28 - "Electron PR Release Contract"
Cohesion: 0.50
Nodes (4): assertPrReleaseContract(), count(), here, workflow

### Community 29 - "Rebase Ownership Routing"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 30 - "CodeQL Analysis Workflow"
Cohesion: 0.50
Nodes (4): analyze: CodeQL matrix job, scope: select one analysis owner, Lopu CodeQL all branches, CodeQL PR handoff workflow

### Community 31 - "Stack Member Detection"
Cohesion: 0.67
Nodes (4): Detect Stack Members Job, GitHub API, Rebase Owner JQ Rule, Stack Member JQ Rule

### Community 32 - "Development Server Tooling"
Cohesion: 0.67
Nodes (3): PM2 Dev Servers, Remix Linting, Worktree Ports Script

### Community 33 - "Internal Branch Promotion"
Cohesion: 1.00
Nodes (3): Lopu internal develop promotion, Lopu internal feature promotion, Sync main into develop

## Knowledge Gaps
- **161 isolated node(s):** `BASE_BRANCHES`, `MERGE_CONFIG`, `CAPACITY_PATTERNS`, `CREDENTIAL_PATTERNS`, `REQUIRED_CATEGORIES` (+156 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `promote: replay merged develop PRs` connect `Promotion PR Changelog` to `Promotion Review Checkpoints`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **What connects `BASE_BRANCHES`, `MERGE_CONFIG`, `CAPACITY_PATTERNS` to the rest of the system?**
  _161 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Vercel Preview Deployment` be split into smaller, more focused modules?**
  _Cohesion score 0.06332842415316642 - nodes in this community are weakly interconnected._
- **Should `Graphify Snapshot Management` be split into smaller, more focused modules?**
  _Cohesion score 0.11378353376503238 - nodes in this community are weakly interconnected._
- **Should `Promotion PR Changelog` be split into smaller, more focused modules?**
  _Cohesion score 0.10631229235880399 - nodes in this community are weakly interconnected._
- **Should `Promotion Retirement Logic` be split into smaller, more focused modules?**
  _Cohesion score 0.0928030303030303 - nodes in this community are weakly interconnected._
- **Should `Promotion Review Checkpoints` be split into smaller, more focused modules?**
  _Cohesion score 0.11494252873563218 - nodes in this community are weakly interconnected._