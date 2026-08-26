# Graph Report - .  (2026-08-26)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 532 nodes · 1150 edges · 43 communities (28 shown, 15 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.59)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `77bf73ec`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_deploy-develop-pr-preview.mjs|deploy-develop-pr-preview.mjs]]
- [[_COMMUNITY_promotion-pr-changelog.mjs|promotion-pr-changelog.mjs]]
- [[_COMMUNITY_selfTest|selfTest]]
- [[_COMMUNITY_build-all-branch.mjs|build-all-branch.mjs]]
- [[_COMMUNITY_promote-features-to-main.mjs|promote-features-to-main.mjs]]
- [[_COMMUNITY_runPromotion|runPromotion]]
- [[_COMMUNITY_failureDetail|failureDetail]]
- [[_COMMUNITY_workflow-control-plane-contract.mjs|workflow-control-plane-contract.mjs]]
- [[_COMMUNITY_refresh-promotion-graphify.sh|refresh-promotion-graphify.sh]]
- [[_COMMUNITY_Rebuild Job|Rebuild Job]]
- [[_COMMUNITY_codeql-open-pr-backfill.mjs|codeql-open-pr-backfill.mjs]]
- [[_COMMUNITY_promotion-worker-contract.sh|promotion-worker-contract.sh]]
- [[_COMMUNITY_promotion-worker.sh|promotion-worker.sh]]
- [[_COMMUNITY_resolve-pr-conflicts-routing-contract.mjs|resolve-pr-conflicts-routing-contract.mjs]]
- [[_COMMUNITY_prepare-round.sh|prepare-round.sh]]
- [[_COMMUNITY_promotion-worker-routing-contract.mjs|promotion-worker-routing-contract.mjs]]
- [[_COMMUNITY_Graphify Semantic Refresh|Graphify Semantic Refresh]]
- [[_COMMUNITY_Run Lopu with Primary Claude Credential|Run Lopu with Primary Claude Credential]]
- [[_COMMUNITY_Publish or reconcile develop S3 preview job|Publish or reconcile develop S3 preview job]]
- [[_COMMUNITY_`github-actions` — the CI control plane|`github-actions` — the CI control plane]]
- [[_COMMUNITY_start.sh|start.sh]]
- [[_COMMUNITY_Lopu PR Manager|Lopu PR Manager]]
- [[_COMMUNITY_classify-claude-credential-failure.mjs|classify-claude-credential-failure.mjs]]
- [[_COMMUNITY_queueTrustedPromotionWorker|queueTrustedPromotionWorker]]
- [[_COMMUNITY_verify-promotion-source-authority.sh|verify-promotion-source-authority.sh]]
- [[_COMMUNITY_detect job|detect job]]
- [[_COMMUNITY_vercel.json|vercel.json]]
- [[_COMMUNITY_electron-pr-release-contract.mjs|electron-pr-release-contract.mjs]]
- [[_COMMUNITY_rebase-ownership-routing-contract.sh|rebase-ownership-routing-contract.sh]]
- [[_COMMUNITY_Lopu Queues Unprivileged PR Scan Job|Lopu Queues Unprivileged PR Scan Job]]
- [[_COMMUNITY_STACK_MEMBER_JQ|STACK_MEMBER_JQ]]
- [[_COMMUNITY_Lopu Build Doctor Round 1|Lopu Build Doctor Round 1]]
- [[_COMMUNITY_Web CI Workflow|Web CI Workflow]]
- [[_COMMUNITY_Safe Main into Develop Sync PR|Safe Main into Develop Sync PR]]
- [[_COMMUNITY_Promotion PR Changelog Script|Promotion PR Changelog Script]]
- [[_COMMUNITY_Route CI Compute Provider Workflow|Route CI Compute Provider Workflow]]
- [[_COMMUNITY_Electron App Release Workflow|Electron App Release Workflow]]
- [[_COMMUNITY_Graphify CLI|Graphify CLI]]
- [[_COMMUNITY_Lopu Agent Action|Lopu Agent Action]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_AI_ALL.md canonical instructions|AI_ALL.md canonical instructions]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]

## God Nodes (most connected - your core abstractions)
1. `selfTest()` - 48 edges
2. `runPromotion()` - 35 edges
3. `failureDetail()` - 28 edges
4. `deploy()` - 26 edges
5. `runSelfTest()` - 24 edges
6. `orphanedMergeHydrationIntegrationTest()` - 19 edges
7. `main()` - 15 edges
8. `repoFlag()` - 15 edges
9. `buildMode()` - 14 edges
10. `githubRequest()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Web CI Workflow` --references--> `Testing Checklist`  [INFERRED]
  .github/workflows/web-ci.yml → TESTING.md
- `Lopu Internal All-branch Integration Workflow` --conceptually_related_to--> `All-branch Doctor`  [INFERRED]
  .github/workflows/all-branch.yml → CHANGELOG.md
- `Lopu CodeQL all branches` --shares_data_with--> `Lopu PR manager (conflict resolver)`  [AMBIGUOUS]
  .github/workflows/codeql-analysis.yml → .github/workflows/resolve-pr-conflicts.yml
- `Lopu rebase conflict round (composite action)` --conceptually_related_to--> `Lopu PR manager (conflict resolver)`  [INFERRED]
  .github/actions/rebase-conflict-round/action.yml → .github/workflows/resolve-pr-conflicts.yml
- `Lopu PR manager (conflict resolver)` --conceptually_related_to--> `Lopu agent action`  [INFERRED]
  .github/workflows/resolve-pr-conflicts.yml → .github/actions/lopu-agent/action.yml

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **All-branch Doctor Build and Repair Flow** — _github_workflows_all_branch_rebuild_job, _github_workflows_all_branch_build_all_branch_script, _github_workflows_all_branch_union_build_check, _github_workflows_all_branch_doctor_round_1, _github_workflows_all_branch_doctor_commit [EXTRACTED 0.90]
- **Lopu Repository Management Lanes** — changelog_lopu_pr_manager, changelog_codeql_coverage, changelog_promotion_recovery, changelog_rebase_stack_recovery, changelog_all_branch_doctor [EXTRACTED 0.90]
- **Bounded Lopu rebase conflict round pipeline** — github_actions_rebase_conflict_round_action_bootstrap, github_actions_rebase_conflict_round_action_prepare, github_actions_rebase_conflict_round_action_lopu, github_actions_rebase_conflict_round_action_verify, github_scripts_rebase_stack_prepare_round, github_actions_lopu_agent_action [EXTRACTED 0.90]
- **develop→main promotion and back-sync automation** — github_workflows_promote_develop_to_main_workflow, github_workflows_promote_features_to_main_workflow, github_workflows_sync_main_into_develop_workflow, github_workflows_resolve_pr_conflicts_workflow, github_scripts_promote_features_to_main, github_scripts_promotion_pr_changelog [EXTRACTED 0.85]
- **Shared CI provider routing contract** — github_workflows_ci_provider_router_workflow, github_workflows_promote_develop_to_main_route, github_workflows_promote_features_to_main_route, github_workflows_resolve_pr_conflicts_workflow [EXTRACTED 0.80]
- **Develop PR Preview Controller Flow** — github_workflows_develop_pr_preview_workflow, github_workflows_develop_pr_preview_dispatch_job, github_workflows_develop_pr_preview_repository_dispatch, github_workflows_develop_pr_preview_controller_event, github_workflows_develop_pr_preview_controller_job, github_workflows_develop_pr_preview_deploy_script [EXTRACTED 0.95]
- **Canonical AI Instruction Files** — agents_thingtime_ai_instructions, ai_all_thingtime_ai_instructions, claude_thingtime_ai_instructions [EXTRACTED 0.95]

## Communities (43 total, 15 thin omitted)

### Community 0 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.06
Nodes (95): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), assertVercelConfiguration(), assertWildcardFallbackRuntimes() (+87 more)

### Community 1 - "promotion-pr-changelog.mjs"
Cohesion: 0.09
Nodes (33): botCommentsByLatestEvent(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), externalStackPromotionState(), findBotPromotionRetirement(), groupFailureMessages(), groupKeyFor() (+25 more)

### Community 2 - "selfTest"
Cohesion: 0.19
Nodes (31): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode(), git() (+23 more)

### Community 3 - "build-all-branch.mjs"
Cohesion: 0.11
Nodes (26): attestationMatches(), CFG, checkpointRecoveryDisposition(), createPromotionReviewCheckpoint(), encodePromotionAttestation(), env(), exactCheckpointPush(), EXEC_OPTS (+18 more)

### Community 4 - "promote-features-to-main.mjs"
Cohesion: 0.15
Nodes (30): cancelPromotionRetirement(), closeRedundantPass(), createPromotionPr(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata() (+22 more)

### Community 5 - "runPromotion"
Cohesion: 0.15
Nodes (28): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers(), failureDetail() (+20 more)

### Community 6 - "failureDetail"
Cohesion: 0.13
Nodes (26): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, ALLOWED_MODELS, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertBareControlPlaneTree() (+18 more)

### Community 7 - "workflow-control-plane-contract.mjs"
Cohesion: 0.10
Nodes (22): Lopu agent action, Lopu rebase conflict round (composite action), bootstrap: copy trusted round code, lopu: resolve rebase conflict set, prepare: validate conflicts and create scratch, verify: recompute and continue rebase, CI provider router, analyze: CodeQL matrix job (+14 more)

### Community 8 - "refresh-promotion-graphify.sh"
Cohesion: 0.12
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 9 - "Rebuild Job"
Cohesion: 0.25
Nodes (19): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp(), flattenWorkflowRuns() (+11 more)

### Community 10 - "codeql-open-pr-backfill.mjs"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay(), RESERVATION_SHA (+8 more)

### Community 11 - "promotion-worker-contract.sh"
Cohesion: 0.20
Nodes (16): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), decodeBatch(), encodeBatch(), LOPU_ACTION_URL (+8 more)

### Community 12 - "promotion-worker.sh"
Cohesion: 0.13
Nodes (16): build-all-branch.mjs, Doctor Commit Command, Lopu Internal All-branch Integration Workflow, Build-doctor Model Waterfall Loader, Rebuild Job, Union Build Check, ai-merge-paused Stop Label, All-branch Doctor (+8 more)

### Community 13 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 14 - "prepare-round.sh"
Cohesion: 0.17
Nodes (11): Thingtime AI Instructions, Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify (+3 more)

### Community 15 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.17
Nodes (11): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, graphify, lopuAgent, mainDevelopSyncWorkflow, promoter (+3 more)

### Community 16 - "Graphify Semantic Refresh"
Cohesion: 0.20
Nodes (10): actions/checkout v4.4.0, develop-pr-preview-controller event, Publish or reconcile develop S3 preview job, .github/scripts/deploy-develop-pr-preview.mjs, Dispatch trusted default-branch controller job, GitHub repository dispatch API, VERCEL_DEVELOP_DEPLOY_TOKEN, vercel-develop-pr-control environment (+2 more)

### Community 17 - "Run Lopu with Primary Claude Credential"
Cohesion: 0.20
Nodes (9): Fork setup: Vercel develop previews, github-actions CI Control Plane, Known trade-off, Lopu principal repository manager, Signed desktop PR releases, Stable develop domain, The bare-tree invariant, Why it is bare (+1 more)

### Community 18 - "Publish or reconcile develop S3 preview job"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 19 - "`github-actions` — the CI control plane"
Cohesion: 0.48
Nodes (6): CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest()

### Community 20 - "start.sh"
Cohesion: 0.33
Nodes (7): buildPromotionDispatchRequest(), dispatchPromotionResolution(), exactReservationDeleteArgs(), exactReservationPushArgs(), promotionDispatchArgs(), queueTrustedPromotionWorker(), redispatchPromotionReservation()

### Community 21 - "Lopu PR Manager"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 22 - "classify-claude-credential-failure.mjs"
Cohesion: 0.40
Nodes (6): ci-provider-router reusable workflow, detect job, GitHub API, Lopu rebase engine workflow, route job, Scan open same-repository PRs via the API

### Community 23 - "queueTrustedPromotionWorker"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 24 - "verify-promotion-source-authority.sh"
Cohesion: 0.50
Nodes (4): assertPrReleaseContract(), count(), here, workflow

### Community 25 - "detect job"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 26 - "vercel.json"
Cohesion: 1.00
Nodes (3): Lopu internal develop promotion, Lopu internal feature promotion, Sync main into develop

### Community 27 - "electron-pr-release-contract.mjs"
Cohesion: 0.67
Nodes (3): no-ai-rebase label, REBASE_OWNER_JQ, STACK_MEMBER_JQ

## Ambiguous Edges - Review These
- `Lopu CodeQL all branches` → `Lopu PR manager (conflict resolver)`  [AMBIGUOUS]
  .github/workflows/codeql-analysis.yml · relation: shares_data_with

## Knowledge Gaps
- **138 isolated node(s):** `BASE_BRANCHES`, `MERGE_CONFIG`, `CAPACITY_PATTERNS`, `CREDENTIAL_PATTERNS`, `REQUIRED_CATEGORIES` (+133 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Lopu CodeQL all branches` and `Lopu PR manager (conflict resolver)`?**
  _Edge tagged AMBIGUOUS (relation: shares_data_with) - confidence is low._
- **Why does `promote: replay merged develop PRs` connect `workflow-control-plane-contract.mjs` to `build-all-branch.mjs`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `BASE_BRANCHES`, `MERGE_CONFIG`, `CAPACITY_PATTERNS` to the rest of the system?**
  _138 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `deploy-develop-pr-preview.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.06332842415316642 - nodes in this community are weakly interconnected._
- **Should `promotion-pr-changelog.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.0928030303030303 - nodes in this community are weakly interconnected._
- **Should `build-all-branch.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.11494252873563218 - nodes in this community are weakly interconnected._
- **Should `runPromotion` be split into smaller, more focused modules?**
  _Cohesion score 0.1455026455026455 - nodes in this community are weakly interconnected._