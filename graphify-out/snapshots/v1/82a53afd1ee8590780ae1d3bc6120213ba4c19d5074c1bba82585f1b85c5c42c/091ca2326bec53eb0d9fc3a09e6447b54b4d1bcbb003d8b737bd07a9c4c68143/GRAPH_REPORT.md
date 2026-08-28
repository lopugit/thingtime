# Graph Report - /Users/lopu/.codex/tmp/thingtime-trusted-exclusion.tw8eY7/worktree  (2026-08-28)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 704 nodes · 1485 edges · 70 communities (37 shown, 33 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.59)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `fb718557`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_deploy-develop-pr-preview.mjs|deploy-develop-pr-preview.mjs]]
- [[_COMMUNITY_graphify-cas.mjs|graphify-cas.mjs]]
- [[_COMMUNITY_promotion-pr-changelog.mjs|promotion-pr-changelog.mjs]]
- [[_COMMUNITY_selfTest|selfTest]]
- [[_COMMUNITY_build-all-branch.mjs|build-all-branch.mjs]]
- [[_COMMUNITY_promote-features-to-main.mjs|promote-features-to-main.mjs]]
- [[_COMMUNITY_runPromotion|runPromotion]]
- [[_COMMUNITY_failureDetail|failureDetail]]
- [[_COMMUNITY_workflow-control-plane-contract.mjs|workflow-control-plane-contract.mjs]]
- [[_COMMUNITY_Lopu PR Manager Workflow|Lopu PR Manager Workflow]]
- [[_COMMUNITY_refresh-promotion-graphify.sh|refresh-promotion-graphify.sh]]
- [[_COMMUNITY_ai-merge-paused Label|ai-merge-paused Label]]
- [[_COMMUNITY_codeql-open-pr-backfill.mjs|codeql-open-pr-backfill.mjs]]
- [[_COMMUNITY_promotion-worker-contract.sh|promotion-worker-contract.sh]]
- [[_COMMUNITY_resolve-pr-conflicts-routing-contract.mjs|resolve-pr-conflicts-routing-contract.mjs]]
- [[_COMMUNITY_promotion-worker.sh|promotion-worker.sh]]
- [[_COMMUNITY_prepare-round.sh|prepare-round.sh]]
- [[_COMMUNITY_Thingtime AI instructions|Thingtime AI instructions]]
- [[_COMMUNITY_promotion-worker-routing-contract.mjs|promotion-worker-routing-contract.mjs]]
- [[_COMMUNITY_stage-graphify-snapshots.mjs|stage-graphify-snapshots.mjs]]
- [[_COMMUNITY_Publish or reconcile develop S3 preview job|Publish or reconcile develop S3 preview job]]
- [[_COMMUNITY_start.sh|start.sh]]
- [[_COMMUNITY_classify-claude-credential-failure.mjs|classify-claude-credential-failure.mjs]]
- [[_COMMUNITY_queueTrustedPromotionWorker|queueTrustedPromotionWorker]]
- [[_COMMUNITY_verify-promotion-source-authority.sh|verify-promotion-source-authority.sh]]
- [[_COMMUNITY_Rebuild Job|Rebuild Job]]
- [[_COMMUNITY_Copy Trusted Round Code Outside Model Workspace Step|Copy Trusted Round Code Outside Model Workspace Step]]
- [[_COMMUNITY_vercel.json|vercel.json]]
- [[_COMMUNITY_electron-pr-release-contract.mjs|electron-pr-release-contract.mjs]]
- [[_COMMUNITY_rebase-ownership-routing-contract.sh|rebase-ownership-routing-contract.sh]]
- [[_COMMUNITY_scope select one analysis owner|scope: select one analysis owner]]
- [[_COMMUNITY_Detect Stack Members Job|Detect Stack Members Job]]
- [[_COMMUNITY_PM2 Dev Servers|PM2 Dev Servers]]
- [[_COMMUNITY_Lopu internal develop promotion|Lopu internal develop promotion]]
- [[_COMMUNITY_Lopu Build Doctor Round 1|Lopu Build Doctor Round 1]]
- [[_COMMUNITY_Web CI Workflow|Web CI Workflow]]
- [[_COMMUNITY_CI Provider Router Workflow|CI Provider Router Workflow]]
- [[_COMMUNITY_Electron App Release Workflow|Electron App Release Workflow]]
- [[_COMMUNITY_Graphify CLI|Graphify CLI]]
- [[_COMMUNITY_Lopu Agent Action|Lopu Agent Action]]
- [[_COMMUNITY_Browser and UI Validation|Browser and UI Validation]]
- [[_COMMUNITY_Delivery Messaging|Delivery Messaging]]
- [[_COMMUNITY_GitHub PR Publishing|GitHub PR Publishing]]
- [[_COMMUNITY_iOS Release Flow|iOS Release Flow]]
- [[_COMMUNITY_Fundamentals|Fundamentals]]
- [[_COMMUNITY_Lopu agent action|Lopu agent action]]
- [[_COMMUNITY_Commander App Release workflow|Commander App Release workflow]]
- [[_COMMUNITY_Legacy PR conflict resolver (superseded)|Legacy PR conflict resolver (superseded)]]
- [[_COMMUNITY_Develop PR Preview Deployment Script|Develop PR Preview Deployment Script]]
- [[_COMMUNITY_Electron PR Release Workflow|Electron PR Release Workflow]]
- [[_COMMUNITY_`github-actions` — the CI control plane|`github-actions` — the CI control plane]]
- [[_COMMUNITY_rebase-index-fingerprint.test.mjs|rebase-index-fingerprint.test.mjs]]
- [[_COMMUNITY_Contract Advisories Job|Contract Advisories Job]]
- [[_COMMUNITY_AI_ALL|AI_ALL.md]]
- [[_COMMUNITY_API Endpoint Registration|API Endpoint Registration]]
- [[_COMMUNITY_API Utils Layer|API Utils Layer]]
- [[_COMMUNITY_Auth Sessions|Auth Sessions]]
- [[_COMMUNITY_Canonical Instruction File|Canonical Instruction File]]
- [[_COMMUNITY_FUNDAMENTALS|FUNDAMENTALS.md]]
- [[_COMMUNITY_Repository-Aware Graphify Router|Repository-Aware Graphify Router]]
- [[_COMMUNITY_Lopu Toast Notifications|Lopu Toast Notifications]]
- [[_COMMUNITY_Versioned MongoDB Collections|Versioned MongoDB Collections]]
- [[_COMMUNITY_Remix Linting|Remix Linting]]
- [[_COMMUNITY_Root AGENTS.md and CLAUDE.md Symlinks|Root AGENTS.md and CLAUDE.md Symlinks]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_Thingtime API|Thingtime API]]
- [[_COMMUNITY_Worktree Ports Script|Worktree Ports Script]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_CodeQL Backfill|CodeQL Backfill]]

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
- `Thingtime AI instructions` --semantically_similar_to--> `Thingtime AI Instructions`  [EXTRACTED] [semantically similar]
  AI_ALL.md → AGENTS.md
- `graphify-out Directory` --conceptually_related_to--> `Graphify Refresh`  [INFERRED]
  .github/workflows/resolve-pr-conflicts.yml → CHANGELOG.md
- `Web CI Workflow` --references--> `Testing Checklist`  [INFERRED]
  .github/workflows/web-ci.yml → TESTING.md
- `Graphify Rules` --semantically_similar_to--> `Graphify Rules`  [EXTRACTED] [semantically similar]
  CLAUDE.md → AGENTS.md
- `Lopu CodeQL All Branches` --conceptually_related_to--> `CodeQL Triage`  [INFERRED]
  .github/workflows/codeql-analysis.yml → CHANGELOG.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Rebase Conflict Round Flow** — github_actions_rebase_conflict_round_action_lopu_rebase_conflict_round, github_actions_rebase_conflict_round_action_bootstrap_step, github_actions_rebase_conflict_round_action_prepare_step, github_actions_rebase_conflict_round_action_lopu_agent_step, github_actions_rebase_conflict_round_action_prepare_round_sh [EXTRACTED 0.90]
- **Control Plane Branch Architecture** — readme_github_actions_branch, readme_thin_listeners, readme_lopu_principal_repository_manager [EXTRACTED 0.95]
- **Lopu Control Plane Workflows** — changelog_lopu_pr_manager, changelog_github_actions_branch, changelog_product_branch_listeners, github_workflows_resolve_pr_conflicts_lopu_pr_manager [EXTRACTED 0.90]
- **Graphify Publication Pipeline** — changelog_graphify_refresh, changelog_graphify_snapshot_router, changelog_semantic_cache_cas, github_workflows_resolve_pr_conflicts_graphify_out [EXTRACTED 0.88]
- **Model-backed Repository Lanes** — changelog_conflict_resolution, changelog_promotion_lanes, changelog_rebase_stack_operations, changelog_codeql_triage, changelog_lopu_pr_manager [EXTRACTED 0.90]
- **Canonical Instruction Symlink Layout** — agents_ai_all_md, agents_root_symlinks, ai_all_thingtime_ai_instructions, claude_thingtime_ai_instructions [EXTRACTED 1.00]
- **Thingtime Data Access Contract** — agents_thingtime_api, agents_api_utils_layer, agents_mongodb_collections, agents_auth_sessions [EXTRACTED 1.00]
- **Shared CI provider routing contract** — github_workflows_ci_provider_router_workflow, github_workflows_promote_develop_to_main_route, github_workflows_promote_features_to_main_route, github_workflows_resolve_pr_conflicts_workflow [EXTRACTED 0.80]
- **develop→main promotion and back-sync automation** — github_workflows_promote_develop_to_main_workflow, github_workflows_promote_features_to_main_workflow, github_workflows_sync_main_into_develop_workflow, github_workflows_resolve_pr_conflicts_workflow, github_scripts_promote_features_to_main, github_scripts_promotion_pr_changelog [EXTRACTED 0.85]
- **Develop PR Preview Controller Flow** — github_workflows_develop_pr_preview_workflow, github_workflows_develop_pr_preview_dispatch_job, github_workflows_develop_pr_preview_repository_dispatch, github_workflows_develop_pr_preview_controller_event, github_workflows_develop_pr_preview_controller_job, github_workflows_develop_pr_preview_deploy_script [EXTRACTED 0.95]

## Communities (70 total, 33 thin omitted)

### Community 0 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.06
Nodes (95): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), assertVercelConfiguration(), assertWildcardFallbackRuntimes() (+87 more)

### Community 1 - "graphify-cas.mjs"
Cohesion: 0.10
Nodes (47): activateSnapshot(), artifactHash(), baselineNodeCount(), computeSourceFingerprint(), copyPortableFiles(), ensureSnapshot(), fail(), finalizeSnapshot() (+39 more)

### Community 2 - "promotion-pr-changelog.mjs"
Cohesion: 0.11
Nodes (42): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+34 more)

### Community 3 - "selfTest"
Cohesion: 0.16
Nodes (36): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), completeRefspecs, countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode() (+28 more)

### Community 4 - "build-all-branch.mjs"
Cohesion: 0.09
Nodes (33): botCommentsByLatestEvent(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), externalStackPromotionState(), findBotPromotionRetirement(), groupFailureMessages(), groupKeyFor() (+25 more)

### Community 5 - "promote-features-to-main.mjs"
Cohesion: 0.13
Nodes (27): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertAdminTransportCap(), assertAdminWaterfallGrammar() (+19 more)

### Community 6 - "runPromotion"
Cohesion: 0.15
Nodes (27): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), createPromotionReviewCheckpoint(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers() (+19 more)

### Community 7 - "failureDetail"
Cohesion: 0.08
Nodes (26): Analyze Job, github/codeql-action/analyze, github/codeql-action/init, Lopu CodeQL All Branches, Select One Analysis Owner, ai-merge-paused Label, CodeQL Triage, Conflict Resolution (+18 more)

### Community 8 - "workflow-control-plane-contract.mjs"
Cohesion: 0.18
Nodes (26): cancelPromotionRetirement(), closeRedundantPass(), createPromotionPr(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata() (+18 more)

### Community 9 - "Lopu PR Manager Workflow"
Cohesion: 0.12
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 10 - "refresh-promotion-graphify.sh"
Cohesion: 0.22
Nodes (21): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), analysisSnapshotForPullRequest(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp() (+13 more)

### Community 11 - "ai-merge-paused Label"
Cohesion: 0.13
Nodes (18): CFG, checkpointRecoveryDisposition(), encodePromotionAttestation(), env(), EXEC_OPTS, flag(), isExactPausedPromotionSnapshot(), listSourceIssueComments() (+10 more)

### Community 12 - "codeql-open-pr-backfill.mjs"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay(), RESERVATION_SHA (+8 more)

### Community 13 - "promotion-worker-contract.sh"
Cohesion: 0.20
Nodes (16): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), decodeBatch(), encodeBatch(), LOPU_ACTION_URL (+8 more)

### Community 14 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.26
Nodes (14): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_index_entries(), hash_rebase_state(), rebase_in_progress() (+6 more)

### Community 15 - "promotion-worker.sh"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 16 - "prepare-round.sh"
Cohesion: 0.15
Nodes (14): Copy Trusted Round Code Outside Model Workspace Step, graphify-cas.mjs, Lopu Agent Action, Resolve Rebase Conflict Set With Lopu Step, Lopu Rebase Conflict Round Action, prepare-round.sh, Validate Conflicts And Create Repo-Less Scratch Step, stage-graphify-snapshots.mjs (+6 more)

### Community 17 - "Thingtime AI instructions"
Cohesion: 0.30
Nodes (13): actionPath, copyTrustedTree(), extractVerifierScript(), filesUnder(), hashNamedFiles(), hashRebaseState(), hashTrustedTree(), makeStoppedRebase() (+5 more)

### Community 18 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.15
Nodes (12): Thingtime AI Instructions, Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify (+4 more)

### Community 19 - "stage-graphify-snapshots.mjs"
Cohesion: 0.17
Nodes (11): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, graphify, lopuAgent, mainDevelopSyncWorkflow, promoter (+3 more)

### Community 20 - "Publish or reconcile develop S3 preview job"
Cohesion: 0.27
Nodes (11): attestationMatches(), exactCheckpointPush(), inspectPromotionReviewCheckpoint(), isObjectId(), latestBotPromotionAttestationEvents(), liveRefShaWithActionsToken(), parsePromotionResolutionAttestations(), recoverPromotionReviewCheckpoint() (+3 more)

### Community 21 - "start.sh"
Cohesion: 0.24
Nodes (10): buildPromotionDispatchRequest(), dispatchPromotionResolution(), exactReservationDeleteArgs(), exactReservationPushArgs(), promotionBody(), promotionDispatchArgs(), queueTrustedPromotionWorker(), redispatchPromotionReservation() (+2 more)

### Community 22 - "classify-claude-credential-failure.mjs"
Cohesion: 0.40
Nodes (9): addExisting(), filesUnder(), git(), LEGACY_ROOT, PORTABLE, restoreTrackedFromHead(), selfTest(), stageGraphifySnapshots() (+1 more)

### Community 23 - "queueTrustedPromotionWorker"
Cohesion: 0.20
Nodes (10): actions/checkout v4.4.0, develop-pr-preview-controller event, Publish or reconcile develop S3 preview job, .github/scripts/deploy-develop-pr-preview.mjs, Dispatch trusted default-branch controller job, GitHub repository dispatch API, VERCEL_DEVELOP_DEPLOY_TOKEN, vercel-develop-pr-control environment (+2 more)

### Community 24 - "verify-promotion-source-authority.sh"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 25 - "Rebuild Job"
Cohesion: 0.48
Nodes (6): CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest()

### Community 26 - "Copy Trusted Round Code Outside Model Workspace Step"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 27 - "vercel.json"
Cohesion: 0.33
Nodes (6): actions/checkout, actions/github-script, Comment Contract Advisories Job, Contract Advisories Job, Verify Job, Workflow Control-Plane CI

### Community 28 - "electron-pr-release-contract.mjs"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 29 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.50
Nodes (4): assertPrReleaseContract(), count(), here, workflow

### Community 30 - "scope: select one analysis owner"
Cohesion: 0.80
Nodes (4): rawIndexHash(), runGit(), semanticIndexHash(), sha256()

### Community 31 - "Detect Stack Members Job"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 34 - "Lopu Build Doctor Round 1"
Cohesion: 0.50
Nodes (4): codeql-analysis.yml, .github/scripts/graphify Router, .github/actions/lopu-agent Interface, Lopu Principal Repository Manager

### Community 35 - "Web CI Workflow"
Cohesion: 0.50
Nodes (4): Electron PR Release Workflow, github-actions Branch, Thin Product Branch Listeners, vercel.json

### Community 36 - "CI Provider Router Workflow"
Cohesion: 0.67
Nodes (3): build-all-branch.mjs, Lopu Agent Action, Lopu Internal All-branch Integration

### Community 37 - "Electron App Release Workflow"
Cohesion: 0.67
Nodes (3): Control-plane Changelog, github-actions Branch, Product Branch Thin Listeners

### Community 38 - "Graphify CLI"
Cohesion: 1.00
Nodes (3): Lopu internal develop promotion, Lopu internal feature promotion, Sync main into develop

## Knowledge Gaps
- **182 isolated node(s):** `CAPACITY_PATTERNS`, `CREDENTIAL_PATTERNS`, `REQUIRED_CATEGORIES`, `ACTIVE_RUN_STATUSES`, `TRUSTED_ASSOCIATIONS` (+177 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **33 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `promote: replay merged develop PRs` connect `promotion-pr-changelog.mjs` to `ai-merge-paused Label`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `CAPACITY_PATTERNS`, `CREDENTIAL_PATTERNS`, `REQUIRED_CATEGORIES` to the rest of the system?**
  _182 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `deploy-develop-pr-preview.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.06332842415316642 - nodes in this community are weakly interconnected._
- **Should `graphify-cas.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.10180995475113122 - nodes in this community are weakly interconnected._
- **Should `promotion-pr-changelog.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.10631229235880399 - nodes in this community are weakly interconnected._
- **Should `build-all-branch.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `promote-features-to-main.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.12698412698412698 - nodes in this community are weakly interconnected._