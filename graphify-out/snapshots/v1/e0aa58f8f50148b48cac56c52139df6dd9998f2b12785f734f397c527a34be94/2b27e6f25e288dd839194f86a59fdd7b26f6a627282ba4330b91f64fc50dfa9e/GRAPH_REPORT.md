# Graph Report - /Users/lopu/.codex/tmp/thingtime-fleet-audit.Fm3j9U/worktree  (2026-08-28)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 704 nodes · 1486 edges · 72 communities (36 shown, 36 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `713d888d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Develop Preview Deployment|Develop Preview Deployment]]
- [[_COMMUNITY_Graphify Snapshot CAS|Graphify Snapshot CAS]]
- [[_COMMUNITY_Promotion PR Changelog|Promotion PR Changelog]]
- [[_COMMUNITY_All-Branch Build Validation|All-Branch Build Validation]]
- [[_COMMUNITY_CodeQL Graphify Workflows|CodeQL Graphify Workflows]]
- [[_COMMUNITY_Promotion Stack Analysis|Promotion Stack Analysis]]
- [[_COMMUNITY_Workflow Control Plane|Workflow Control Plane]]
- [[_COMMUNITY_Promotion Reservation Flow|Promotion Reservation Flow]]
- [[_COMMUNITY_Promotion PR Management|Promotion PR Management]]
- [[_COMMUNITY_Promotion Graphify Refresh|Promotion Graphify Refresh]]
- [[_COMMUNITY_CodeQL PR Backfill|CodeQL PR Backfill]]
- [[_COMMUNITY_Feature Promotion Recovery|Feature Promotion Recovery]]
- [[_COMMUNITY_Promotion Worker Contract|Promotion Worker Contract]]
- [[_COMMUNITY_PR Conflict Routing|PR Conflict Routing]]
- [[_COMMUNITY_Rebase Round Preparation|Rebase Round Preparation]]
- [[_COMMUNITY_Promotion Worker Script|Promotion Worker Script]]
- [[_COMMUNITY_Rebase Conflict Automation|Rebase Conflict Automation]]
- [[_COMMUNITY_Rebase Verifier Tests|Rebase Verifier Tests]]
- [[_COMMUNITY_Promotion Worker Routing|Promotion Worker Routing]]
- [[_COMMUNITY_Promotion Checkpoint Validation|Promotion Checkpoint Validation]]
- [[_COMMUNITY_Promotion Dispatch Queue|Promotion Dispatch Queue]]
- [[_COMMUNITY_Graphify Snapshot Staging|Graphify Snapshot Staging]]
- [[_COMMUNITY_Develop Preview Controller|Develop Preview Controller]]
- [[_COMMUNITY_Rebase Start Script|Rebase Start Script]]
- [[_COMMUNITY_Claude Credential Classification|Claude Credential Classification]]
- [[_COMMUNITY_Promotion Source Authority|Promotion Source Authority]]
- [[_COMMUNITY_Control Plane CI|Control Plane CI]]
- [[_COMMUNITY_Vercel Deployment Config|Vercel Deployment Config]]
- [[_COMMUNITY_Electron PR Release|Electron PR Release]]
- [[_COMMUNITY_Rebase Fingerprint Tests|Rebase Fingerprint Tests]]
- [[_COMMUNITY_Control Plane Changelog|Control Plane Changelog]]
- [[_COMMUNITY_Rebase Ownership Routing|Rebase Ownership Routing]]
- [[_COMMUNITY_Instruction Conflict Resolver|Instruction Conflict Resolver]]
- [[_COMMUNITY_Instruction Conflict Tests|Instruction Conflict Tests]]
- [[_COMMUNITY_Lopu Repository Manager|Lopu Repository Manager]]
- [[_COMMUNITY_Electron Release Workflow|Electron Release Workflow]]
- [[_COMMUNITY_All-Branch Integration|All-Branch Integration]]
- [[_COMMUNITY_Internal Branch Promotion|Internal Branch Promotion]]
- [[_COMMUNITY_Web CI Testing|Web CI Testing]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_Primary Snapshot Rebuild|Primary Snapshot Rebuild]]
- [[_COMMUNITY_Electron App Release|Electron App Release]]
- [[_COMMUNITY_Graphify CLI|Graphify CLI]]
- [[_COMMUNITY_Lopu Agent Action|Lopu Agent Action]]
- [[_COMMUNITY_Global AI Instructions|Global AI Instructions]]
- [[_COMMUNITY_API Endpoint Registration|API Endpoint Registration]]
- [[_COMMUNITY_API Utilities Layer|API Utilities Layer]]
- [[_COMMUNITY_Authentication Sessions|Authentication Sessions]]
- [[_COMMUNITY_Browser UI Validation|Browser UI Validation]]
- [[_COMMUNITY_Canonical Instruction File|Canonical Instruction File]]
- [[_COMMUNITY_Delivery Messaging|Delivery Messaging]]
- [[_COMMUNITY_Project Fundamentals|Project Fundamentals]]
- [[_COMMUNITY_GitHub PR Publishing|GitHub PR Publishing]]
- [[_COMMUNITY_Graphify Repository Router|Graphify Repository Router]]
- [[_COMMUNITY_Graphify Immutable Snapshots|Graphify Immutable Snapshots]]
- [[_COMMUNITY_iOS Release Flow|iOS Release Flow]]
- [[_COMMUNITY_Toast Notifications|Toast Notifications]]
- [[_COMMUNITY_MongoDB Collection Versioning|MongoDB Collection Versioning]]
- [[_COMMUNITY_PM2 Dev Servers|PM2 Dev Servers]]
- [[_COMMUNITY_Remix Linting|Remix Linting]]
- [[_COMMUNITY_Instruction Symlinks|Instruction Symlinks]]
- [[_COMMUNITY_Thingtime API|Thingtime API]]
- [[_COMMUNITY_Worktree Ports Script|Worktree Ports Script]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_Fundamentals|Fundamentals]]
- [[_COMMUNITY_Lopu Agent Action|Lopu Agent Action]]
- [[_COMMUNITY_CodeQL PR Handoff|CodeQL PR Handoff]]
- [[_COMMUNITY_Commander Release Workflow|Commander Release Workflow]]
- [[_COMMUNITY_Legacy Conflict Resolver|Legacy Conflict Resolver]]
- [[_COMMUNITY_Develop Preview Deployment|Develop Preview Deployment]]

## God Nodes (most connected - your core abstractions)
1. `selfTest()` - 49 edges
2. `runPromotion()` - 36 edges
3. `failureDetail()` - 28 edges
4. `deploy()` - 26 edges
5. `runSelfTest()` - 24 edges
6. `main()` - 20 edges
7. `orphanedMergeHydrationIntegrationTest()` - 19 edges
8. `main()` - 15 edges
9. `repoFlag()` - 15 edges
10. `githubRequest()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `graphify-out Directory` --semantically_similar_to--> `Graphify Snapshots`  [INFERRED] [semantically similar]
  .github/workflows/resolve-pr-conflicts.yml → CHANGELOG.md
- `Web CI Workflow` --references--> `Testing Checklist`  [INFERRED]
  .github/workflows/web-ci.yml → TESTING.md
- `Thingtime AI Instructions` --semantically_similar_to--> `Thingtime AI Instructions`  [EXTRACTED] [semantically similar]
  CLAUDE.md → AGENTS.md
- `Graphify Rules` --semantically_similar_to--> `Graphify Rules`  [EXTRACTED] [semantically similar]
  CLAUDE.md → AGENTS.md
- `Lopu CodeQL All Branches` --conceptually_related_to--> `CodeQL Triage`  [INFERRED]
  .github/workflows/codeql-analysis.yml → CHANGELOG.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Rebase Conflict Round Flow** — github_actions_rebase_conflict_round_action_lopu_rebase_conflict_round, github_actions_rebase_conflict_round_action_bootstrap_step, github_actions_rebase_conflict_round_action_prepare_step, github_actions_rebase_conflict_round_action_lopu_agent_step, github_actions_rebase_conflict_round_action_prepare_round_sh [EXTRACTED 0.90]
- **Control Plane Branch Architecture** — readme_github_actions_branch, readme_thin_listeners, readme_lopu_principal_repository_manager [EXTRACTED 0.95]
- **Lopu Control-plane Flow** — changelog_github_actions_branch, changelog_product_branch_listeners, github_workflows_resolve_pr_conflicts_lopu_pr_manager_workflow, github_workflows_resolve_pr_conflicts_workflow_call, github_workflows_resolve_pr_conflicts_workflow_dispatch_handoff [EXTRACTED 0.90]
- **Graphify Publication and Refresh Flow** — changelog_graphify_snapshot_stager, changelog_immutable_cas_layout, changelog_semantic_cache_variants, github_workflows_resolve_pr_conflicts_graphify_refresh, github_workflows_resolve_pr_conflicts_graphify_out [EXTRACTED 0.88]
- **Lopu Repository Management Lanes** — changelog_lopu_pr_manager, changelog_conflict_resolution, changelog_codeql_triage, changelog_promotion_lanes, changelog_all_branch_rebuild [EXTRACTED 0.86]
- **Canonical Instruction Symlink Layout** — agents_ai_all_md, agents_root_symlinks, ai_all_thingtime_ai_instructions, claude_thingtime_ai_instructions [EXTRACTED 1.00]
- **Thingtime Data Access Contract** — agents_thingtime_api, agents_api_utils_layer, agents_mongodb_collections, agents_auth_sessions [EXTRACTED 1.00]
- **Shared CI provider routing contract** — github_workflows_ci_provider_router_workflow, github_workflows_promote_develop_to_main_route, github_workflows_promote_features_to_main_route, github_workflows_resolve_pr_conflicts_workflow [EXTRACTED 0.80]
- **develop→main promotion and back-sync automation** — github_workflows_promote_develop_to_main_workflow, github_workflows_promote_features_to_main_workflow, github_workflows_sync_main_into_develop_workflow, github_workflows_resolve_pr_conflicts_workflow, github_scripts_promote_features_to_main, github_scripts_promotion_pr_changelog [EXTRACTED 0.85]
- **Develop PR Preview Controller Flow** — github_workflows_develop_pr_preview_workflow, github_workflows_develop_pr_preview_dispatch_job, github_workflows_develop_pr_preview_repository_dispatch, github_workflows_develop_pr_preview_controller_event, github_workflows_develop_pr_preview_controller_job, github_workflows_develop_pr_preview_deploy_script [EXTRACTED 0.95]

## Communities (72 total, 36 thin omitted)

### Community 0 - "Develop Preview Deployment"
Cohesion: 0.06
Nodes (95): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), assertVercelConfiguration(), assertWildcardFallbackRuntimes() (+87 more)

### Community 1 - "Graphify Snapshot CAS"
Cohesion: 0.10
Nodes (47): activateSnapshot(), artifactHash(), baselineNodeCount(), computeSourceFingerprint(), copyPortableFiles(), ensureSnapshot(), fail(), finalizeSnapshot() (+39 more)

### Community 2 - "Promotion PR Changelog"
Cohesion: 0.11
Nodes (42): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+34 more)

### Community 3 - "All-Branch Build Validation"
Cohesion: 0.16
Nodes (36): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), completeRefspecs, countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode() (+28 more)

### Community 4 - "CodeQL Graphify Workflows"
Cohesion: 0.07
Nodes (33): Analyze Job, github/codeql-action/analyze, github/codeql-action/init, Lopu CodeQL All Branches, Select One Analysis Owner, AI_ALL Instruction Symlinks, CodeQL Triage, Conflict Resolution (+25 more)

### Community 5 - "Promotion Stack Analysis"
Cohesion: 0.09
Nodes (33): botCommentsByLatestEvent(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), externalStackPromotionState(), findBotPromotionRetirement(), groupFailureMessages(), groupKeyFor() (+25 more)

### Community 6 - "Workflow Control Plane"
Cohesion: 0.13
Nodes (27): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertAdminTransportCap(), assertAdminWaterfallGrammar() (+19 more)

### Community 7 - "Promotion Reservation Flow"
Cohesion: 0.15
Nodes (27): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), createPromotionReviewCheckpoint(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers() (+19 more)

### Community 8 - "Promotion PR Management"
Cohesion: 0.18
Nodes (26): cancelPromotionRetirement(), closeRedundantPass(), createPromotionPr(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata() (+18 more)

### Community 9 - "Promotion Graphify Refresh"
Cohesion: 0.12
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 10 - "CodeQL PR Backfill"
Cohesion: 0.22
Nodes (21): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), analysisSnapshotForPullRequest(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp() (+13 more)

### Community 11 - "Feature Promotion Recovery"
Cohesion: 0.13
Nodes (18): CFG, checkpointRecoveryDisposition(), encodePromotionAttestation(), env(), EXEC_OPTS, flag(), isExactPausedPromotionSnapshot(), listSourceIssueComments() (+10 more)

### Community 12 - "Promotion Worker Contract"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay(), RESERVATION_SHA (+8 more)

### Community 13 - "PR Conflict Routing"
Cohesion: 0.20
Nodes (16): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), decodeBatch(), encodeBatch(), LOPU_ACTION_URL (+8 more)

### Community 14 - "Rebase Round Preparation"
Cohesion: 0.26
Nodes (14): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_index_entries(), hash_rebase_state(), rebase_in_progress() (+6 more)

### Community 15 - "Promotion Worker Script"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 16 - "Rebase Conflict Automation"
Cohesion: 0.15
Nodes (14): Copy Trusted Round Code Outside Model Workspace Step, graphify-cas.mjs, Lopu Agent Action, Resolve Rebase Conflict Set With Lopu Step, Lopu Rebase Conflict Round Action, prepare-round.sh, Validate Conflicts And Create Repo-Less Scratch Step, stage-graphify-snapshots.mjs (+6 more)

### Community 17 - "Rebase Verifier Tests"
Cohesion: 0.30
Nodes (13): actionPath, copyTrustedTree(), extractVerifierScript(), filesUnder(), hashNamedFiles(), hashRebaseState(), hashTrustedTree(), makeStoppedRebase() (+5 more)

### Community 18 - "Promotion Worker Routing"
Cohesion: 0.17
Nodes (11): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, graphify, lopuAgent, mainDevelopSyncWorkflow, promoter (+3 more)

### Community 19 - "Promotion Checkpoint Validation"
Cohesion: 0.27
Nodes (11): attestationMatches(), exactCheckpointPush(), inspectPromotionReviewCheckpoint(), isObjectId(), latestBotPromotionAttestationEvents(), liveRefShaWithActionsToken(), parsePromotionResolutionAttestations(), recoverPromotionReviewCheckpoint() (+3 more)

### Community 20 - "Promotion Dispatch Queue"
Cohesion: 0.24
Nodes (10): buildPromotionDispatchRequest(), dispatchPromotionResolution(), exactReservationDeleteArgs(), exactReservationPushArgs(), promotionBody(), promotionDispatchArgs(), queueTrustedPromotionWorker(), redispatchPromotionReservation() (+2 more)

### Community 21 - "Graphify Snapshot Staging"
Cohesion: 0.40
Nodes (9): addExisting(), filesUnder(), git(), LEGACY_ROOT, PORTABLE, restoreTrackedFromHead(), selfTest(), stageGraphifySnapshots() (+1 more)

### Community 22 - "Develop Preview Controller"
Cohesion: 0.20
Nodes (10): actions/checkout v4.4.0, develop-pr-preview-controller event, Publish or reconcile develop S3 preview job, .github/scripts/deploy-develop-pr-preview.mjs, Dispatch trusted default-branch controller job, GitHub repository dispatch API, VERCEL_DEVELOP_DEPLOY_TOKEN, vercel-develop-pr-control environment (+2 more)

### Community 23 - "Rebase Start Script"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 24 - "Claude Credential Classification"
Cohesion: 0.48
Nodes (6): CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest()

### Community 25 - "Promotion Source Authority"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 26 - "Control Plane CI"
Cohesion: 0.33
Nodes (6): actions/checkout, actions/github-script, Comment Contract Advisories Job, Contract Advisories Job, Verify Job, Workflow Control-Plane CI

### Community 27 - "Vercel Deployment Config"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 28 - "Electron PR Release"
Cohesion: 0.50
Nodes (4): assertPrReleaseContract(), count(), here, workflow

### Community 29 - "Rebase Fingerprint Tests"
Cohesion: 0.80
Nodes (4): rawIndexHash(), runGit(), semanticIndexHash(), sha256()

### Community 30 - "Control Plane Changelog"
Cohesion: 0.50
Nodes (4): Control-plane Changelog, Executable CI, github-actions Branch, Product Branch Thin Listeners

### Community 31 - "Rebase Ownership Routing"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 34 - "Lopu Repository Manager"
Cohesion: 0.50
Nodes (4): codeql-analysis.yml, .github/scripts/graphify Router, .github/actions/lopu-agent Interface, Lopu Principal Repository Manager

### Community 35 - "Electron Release Workflow"
Cohesion: 0.50
Nodes (4): Electron PR Release Workflow, github-actions Branch, Thin Product Branch Listeners, vercel.json

### Community 36 - "All-Branch Integration"
Cohesion: 0.67
Nodes (3): build-all-branch.mjs, Lopu Agent Action, Lopu Internal All-branch Integration

### Community 37 - "Internal Branch Promotion"
Cohesion: 1.00
Nodes (3): Lopu internal develop promotion, Lopu internal feature promotion, Sync main into develop

## Knowledge Gaps
- **181 isolated node(s):** `CAPACITY_PATTERNS`, `CREDENTIAL_PATTERNS`, `REQUIRED_CATEGORIES`, `ACTIVE_RUN_STATUSES`, `TRUSTED_ASSOCIATIONS` (+176 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **36 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `promote: replay merged develop PRs` connect `Promotion PR Changelog` to `Feature Promotion Recovery`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `CAPACITY_PATTERNS`, `CREDENTIAL_PATTERNS`, `REQUIRED_CATEGORIES` to the rest of the system?**
  _181 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Develop Preview Deployment` be split into smaller, more focused modules?**
  _Cohesion score 0.06332842415316642 - nodes in this community are weakly interconnected._
- **Should `Graphify Snapshot CAS` be split into smaller, more focused modules?**
  _Cohesion score 0.10180995475113122 - nodes in this community are weakly interconnected._
- **Should `Promotion PR Changelog` be split into smaller, more focused modules?**
  _Cohesion score 0.10631229235880399 - nodes in this community are weakly interconnected._
- **Should `CodeQL Graphify Workflows` be split into smaller, more focused modules?**
  _Cohesion score 0.06628787878787878 - nodes in this community are weakly interconnected._
- **Should `Promotion Stack Analysis` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._