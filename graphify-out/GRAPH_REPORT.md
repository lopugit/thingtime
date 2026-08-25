# Graph Report - .  (2026-08-25)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 548 nodes · 1193 edges · 44 communities (30 shown, 14 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.52)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f5056912`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_deploy-develop-pr-preview.mjs|deploy-develop-pr-preview.mjs]]
- [[_COMMUNITY_promotion-pr-changelog.mjs|promotion-pr-changelog.mjs]]
- [[_COMMUNITY_build-all-branch.mjs|build-all-branch.mjs]]
- [[_COMMUNITY_selfTest|selfTest]]
- [[_COMMUNITY_runPromotion|runPromotion]]
- [[_COMMUNITY_failureDetail|failureDetail]]
- [[_COMMUNITY_workflow-control-plane-contract.mjs|workflow-control-plane-contract.mjs]]
- [[_COMMUNITY_refresh-promotion-graphify.sh|refresh-promotion-graphify.sh]]
- [[_COMMUNITY_promote-features-to-main.mjs|promote-features-to-main.mjs]]
- [[_COMMUNITY_promotion-worker-contract.sh|promotion-worker-contract.sh]]
- [[_COMMUNITY_Analyze Job|Analyze Job]]
- [[_COMMUNITY_promotion-worker.sh|promotion-worker.sh]]
- [[_COMMUNITY_resolve-pr-conflicts-routing-contract.mjs|resolve-pr-conflicts-routing-contract.mjs]]
- [[_COMMUNITY_prepare-round.sh|prepare-round.sh]]
- [[_COMMUNITY_run_contract Shell Function|run_contract Shell Function]]
- [[_COMMUNITY_Thingtime AI instructions|Thingtime AI instructions]]
- [[_COMMUNITY_promotion-worker-routing-contract.mjs|promotion-worker-routing-contract.mjs]]
- [[_COMMUNITY_promotion-worker-routing-contract.mjs|promotion-worker-routing-contract.mjs]]
- [[_COMMUNITY_Lopu Internal Feature Promotion Workflow|Lopu Internal Feature Promotion Workflow]]
- [[_COMMUNITY_start.sh|start.sh]]
- [[_COMMUNITY_Publish or reconcile develop S3 preview job|Publish or reconcile develop S3 preview job]]
- [[_COMMUNITY_classify-claude-credential-failure.mjs|classify-claude-credential-failure.mjs]]
- [[_COMMUNITY_Post-merge Graphify Refresh|Post-merge Graphify Refresh]]
- [[_COMMUNITY_start.sh|start.sh]]
- [[_COMMUNITY_Build And Publish Signed PR Release Job|Build And Publish Signed PR Release Job]]
- [[_COMMUNITY_queueTrustedPromotionWorker|queueTrustedPromotionWorker]]
- [[_COMMUNITY_verify-promotion-source-authority.sh|verify-promotion-source-authority.sh]]
- [[_COMMUNITY_rebase-ownership-routing-contract.sh|rebase-ownership-routing-contract.sh]]
- [[_COMMUNITY_vercel.json|vercel.json]]
- [[_COMMUNITY_electron-pr-release-contract.mjs|electron-pr-release-contract.mjs]]
- [[_COMMUNITY_Thingtime Electron PR Release Workflow|Thingtime Electron PR Release Workflow]]
- [[_COMMUNITY_rebase-ownership-routing-contract.sh|rebase-ownership-routing-contract.sh]]
- [[_COMMUNITY_Route CI Compute Provider Workflow|Route CI Compute Provider Workflow]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_Promotion PR Changelog Script|Promotion PR Changelog Script]]
- [[_COMMUNITY_Route CI Compute Provider Workflow|Route CI Compute Provider Workflow]]
- [[_COMMUNITY_Electron App Release Workflow|Electron App Release Workflow]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_AI_ALL.md canonical instructions|AI_ALL.md canonical instructions]]
- [[_COMMUNITY_`github-actions` — the CI control plane|`github-actions` — the CI control plane]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_Fundamentals|Fundamentals]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]

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
- `Web CI Workflow` --references--> `Testing Checklist`  [INFERRED]
  .github/workflows/web-ci.yml → TESTING.md
- `Lopu Internal Feature Promotion Workflow` --references--> `Lopu Internal Develop Promotion Workflow`  [EXTRACTED]
  .github/workflows/promote-features-to-main.yml → .github/workflows/promote-develop-to-main.yml
- `Resolve Rebase Conflict Set with Lopu` --calls--> `Lopu Agent Composite Action`  [EXTRACTED]
  .github/actions/rebase-conflict-round/action.yml → .github/actions/lopu-agent/action.yml
- `Workflow Control-plane CI` --calls--> `classify-claude-credential-failure.mjs`  [EXTRACTED]
  .github/workflows/control-plane-ci.yml → .github/actions/lopu-agent/action.yml

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Lopu Repository Management Lanes** — changelog_lopu_pr_manager, changelog_codeql_triage, changelog_promotion_maintenance, changelog_all_branch_doctor, _github_workflows_resolve_pr_conflicts_conflict_resolution [EXTRACTED 0.90]
- **All Branch Rebuild Doctor Flow** — _github_workflows_all_branch_lopu_all_branch_integration, _github_workflows_all_branch_handoff_job, _github_workflows_all_branch_rebuild_job, _github_workflows_all_branch_build_all_branch_script, _github_workflows_all_branch_lopu_agent_action, _github_workflows_all_branch_union_build_check [EXTRACTED 0.95]
- **Thin Control Plane Architecture** — readme_ci_control_plane, readme_thin_listeners, readme_lopu_principal_repository_manager, readme_workflow_control_plane_contract, _github_workflows_resolve_pr_conflicts_thin_listener_contract [EXTRACTED 0.88]
- **Lopu Backend Selection and Credential Failover** — github_actions_lopu_agent_action_validate_backend, github_actions_lopu_agent_action_claude_primary, github_actions_lopu_agent_action_claude_fallback, github_actions_lopu_agent_action_codex_runner [EXTRACTED 0.95]
- **Rebase Conflict Resolution Flow** — github_workflows_rebase_pr_stacks_rebase_engine, github_actions_rebase_conflict_round_action_rebase_conflict_round, github_actions_rebase_conflict_round_action_prepare_round_script, github_actions_rebase_conflict_round_action_resolve_conflict_with_lopu, github_actions_lopu_agent_action_lopu_agent [EXTRACTED 0.88]
- **Central CodeQL PR Scan Flow** — changelog_codeql_pr_handoff, github_workflows_codeql_pr_handoff_lopu_codeql_pr_handoff, github_workflows_codeql_analysis_lopu_codeql_all_branches, github_workflows_codeql_analysis_codeql_analyze [EXTRACTED 0.92]
- **Develop PR Preview Controller Flow** — github_workflows_develop_pr_preview_workflow, github_workflows_develop_pr_preview_dispatch_job, github_workflows_develop_pr_preview_repository_dispatch, github_workflows_develop_pr_preview_controller_event, github_workflows_develop_pr_preview_controller_job, github_workflows_develop_pr_preview_deploy_script [EXTRACTED 0.95]
- **Provider Routed CI Workflows** — _github_workflows_ci_provider_router_route_ci_compute_provider, _github_workflows_promote_develop_to_main_promote_develop_to_main, _github_workflows_promote_features_to_main_promote_features_to_main, _github_workflows_rebase_pr_stacks_rebase_prs_and_stacks, _github_workflows_resolve_pr_conflicts_resolve_pr_conflicts, _github_workflows_sync_main_into_develop_sync_main_into_develop [EXTRACTED 0.90]
- **Canonical AI Instruction Files** — agents_thingtime_ai_instructions, ai_all_thingtime_ai_instructions, claude_thingtime_ai_instructions [EXTRACTED 0.95]

## Communities (44 total, 14 thin omitted)

### Community 0 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.06
Nodes (95): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), assertVercelConfiguration(), assertWildcardFallbackRuntimes() (+87 more)

### Community 1 - "promotion-pr-changelog.mjs"
Cohesion: 0.14
Nodes (35): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+27 more)

### Community 2 - "build-all-branch.mjs"
Cohesion: 0.18
Nodes (11): classify-claude-credential-failure.mjs, Run Lopu with Fallback Claude Credential, Run Lopu with Primary Claude Credential, Run Lopu with Codex, Lopu Agent Composite Action, Validate the Lopu Backend, prepare-round.sh, Lopu Rebase Conflict Round Composite Action (+3 more)

### Community 3 - "selfTest"
Cohesion: 0.09
Nodes (33): botCommentsByLatestEvent(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), externalStackPromotionState(), findBotPromotionRetirement(), groupFailureMessages(), groupKeyFor() (+25 more)

### Community 4 - "runPromotion"
Cohesion: 0.19
Nodes (31): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode(), git() (+23 more)

### Community 5 - "failureDetail"
Cohesion: 0.11
Nodes (26): attestationMatches(), CFG, checkpointRecoveryDisposition(), createPromotionReviewCheckpoint(), encodePromotionAttestation(), env(), exactCheckpointPush(), EXEC_OPTS (+18 more)

### Community 6 - "workflow-control-plane-contract.mjs"
Cohesion: 0.15
Nodes (30): cancelPromotionRetirement(), closeRedundantPass(), createPromotionPr(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata() (+22 more)

### Community 7 - "refresh-promotion-graphify.sh"
Cohesion: 0.15
Nodes (28): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers(), failureDetail() (+20 more)

### Community 8 - "promote-features-to-main.mjs"
Cohesion: 0.13
Nodes (25): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, ALLOWED_MODELS, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertBareControlPlaneTree() (+17 more)

### Community 9 - "promotion-worker-contract.sh"
Cohesion: 0.12
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 10 - "Analyze Job"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay(), RESERVATION_SHA (+8 more)

### Community 11 - "promotion-worker.sh"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 12 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.22
Nodes (14): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), LOPU_ACTION_URL, positiveDecimal(), REBASE_ACTION_URL (+6 more)

### Community 13 - "prepare-round.sh"
Cohesion: 0.27
Nodes (13): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_rebase_state(), rebase_in_progress(), secure_git_environment() (+5 more)

### Community 14 - "run_contract Shell Function"
Cohesion: 0.17
Nodes (11): Thingtime AI Instructions, Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify (+3 more)

### Community 15 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, graphify, lopuAgent, mainDevelopSyncWorkflow, promoter (+3 more)

### Community 16 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.18
Nodes (11): ci-provider-router.yml, promotion-pr-changelog.mjs, promotion-pr Job, route Job, Lopu Internal Develop Promotion Workflow, ci-provider-router.yml, lanes Job, promote-features-to-main.mjs (+3 more)

### Community 17 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.20
Nodes (10): actions/checkout v4.4.0, develop-pr-preview-controller event, Publish or reconcile develop S3 preview job, .github/scripts/deploy-develop-pr-preview.mjs, Dispatch trusted default-branch controller job, GitHub repository dispatch API, VERCEL_DEVELOP_DEPLOY_TOKEN, vercel-develop-pr-control environment (+2 more)

### Community 18 - "Lopu Internal Feature Promotion Workflow"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 19 - "start.sh"
Cohesion: 0.48
Nodes (6): CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest()

### Community 20 - "Publish or reconcile develop S3 preview job"
Cohesion: 0.33
Nodes (7): buildPromotionDispatchRequest(), dispatchPromotionResolution(), exactReservationDeleteArgs(), exactReservationPushArgs(), promotionDispatchArgs(), queueTrustedPromotionWorker(), redispatchPromotionReservation()

### Community 21 - "classify-claude-credential-failure.mjs"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 22 - "Post-merge Graphify Refresh"
Cohesion: 0.40
Nodes (6): ci-provider-router reusable workflow, detect job, GitHub API, Lopu rebase engine workflow, route job, Scan open same-repository PRs via the API

### Community 23 - "start.sh"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 24 - "Build And Publish Signed PR Release Job"
Cohesion: 0.50
Nodes (4): assertPrReleaseContract(), count(), here, workflow

### Community 25 - "queueTrustedPromotionWorker"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 26 - "verify-promotion-source-authority.sh"
Cohesion: 1.00
Nodes (3): CodeQL Analyze Job, Lopu CodeQL All Branches Workflow, Select One Analysis Owner Job

### Community 27 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.67
Nodes (3): gh workflow run codeql-analysis.yml, Lopu Queues Unprivileged PR Scan Job, Lopu CodeQL PR Handoff Workflow

### Community 28 - "vercel.json"
Cohesion: 0.67
Nodes (3): no-ai-rebase label, REBASE_OWNER_JQ, STACK_MEMBER_JQ

### Community 43 - "Thingtime AI Instructions"
Cohesion: 0.12
Nodes (14): Added, Changed, Control-plane changelog, Fixed, [Unreleased], Fork setup: Vercel develop previews, `github-actions` — the CI control plane, Known trade-off (+6 more)

## Knowledge Gaps
- **142 isolated node(s):** `BASE_BRANCHES`, `MERGE_CONFIG`, `here`, `githubRoot`, `workflows` (+137 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `selfTest()` connect `selfTest` to `Publish or reconcile develop S3 preview job`, `failureDetail`, `workflow-control-plane-contract.mjs`, `refresh-promotion-graphify.sh`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Why does `runPromotion()` connect `workflow-control-plane-contract.mjs` to `selfTest`, `failureDetail`, `refresh-promotion-graphify.sh`?**
  _High betweenness centrality (0.002) - this node is a cross-community bridge._
- **Why does `failureDetail()` connect `refresh-promotion-graphify.sh` to `selfTest`, `Publish or reconcile develop S3 preview job`, `failureDetail`, `workflow-control-plane-contract.mjs`?**
  _High betweenness centrality (0.001) - this node is a cross-community bridge._
- **What connects `BASE_BRANCHES`, `MERGE_CONFIG`, `here` to the rest of the system?**
  _142 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `deploy-develop-pr-preview.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.06332842415316642 - nodes in this community are weakly interconnected._
- **Should `promotion-pr-changelog.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.14126984126984127 - nodes in this community are weakly interconnected._
- **Should `selfTest` be split into smaller, more focused modules?**
  _Cohesion score 0.0928030303030303 - nodes in this community are weakly interconnected._