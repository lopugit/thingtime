# Graph Report - .  (2026-08-26)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 485 nodes · 1042 edges · 42 communities (25 shown, 17 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.59)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `fa4d0173`
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

## God Nodes (most connected - your core abstractions)
1. `selfTest()` - 48 edges
2. `runPromotion()` - 35 edges
3. `failureDetail()` - 28 edges
4. `deploy()` - 26 edges
5. `runSelfTest()` - 24 edges
6. `orphanedMergeHydrationIntegrationTest()` - 19 edges
7. `main()` - 15 edges
8. `repoFlag()` - 15 edges
9. `githubRequest()` - 14 edges
10. `boundedInteger()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Web CI Workflow` --references--> `Testing Checklist`  [INFERRED]
  .github/workflows/web-ci.yml → TESTING.md
- `Lopu rebase engine workflow` --references--> `Lopu rebase conflict round action`  [INFERRED]
  .github/workflows/rebase-pr-stacks.yml → .github/actions/rebase-conflict-round/action.yml
- `Lopu PR manager workflow` --references--> `Lopu agent composite action`  [INFERRED]
  .github/workflows/resolve-pr-conflicts.yml → .github/actions/lopu-agent/action.yml
- `Lopu internal all-branch integration workflow` --references--> `Lopu PR manager workflow`  [EXTRACTED]
  .github/workflows/all-branch.yml → .github/workflows/resolve-pr-conflicts.yml
- `Lopu PR manager workflow` --references--> `Lopu internal feature promotion workflow`  [INFERRED]
  .github/workflows/resolve-pr-conflicts.yml → .github/workflows/promote-features-to-main.yml

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Lopu Repository Management Lanes** — changelog_lopu_pr_manager, changelog_codeql_coverage, changelog_promotion_recovery, changelog_rebase_stack_recovery, changelog_all_branch_doctor [EXTRACTED 0.90]
- **Automations driven by the shared Lopu agent action** — github_actions_lopu_agent_action, github_actions_rebase_conflict_round_action_lopu, github_workflows_all_branch_rebuild, github_workflows_resolve_pr_conflicts [EXTRACTED 0.85]
- **develop → main promotion and back-merge flow** — github_workflows_promote_develop_to_main, github_workflows_promote_features_to_main, github_workflows_sync_main_into_develop, github_scripts_promotion_pr_changelog, github_scripts_promote_features_to_main [EXTRACTED 0.85]
- **Workflows routed through the CI provider router** — github_workflows_ci_provider_router, github_workflows_promote_develop_to_main, github_workflows_promote_features_to_main, github_workflows_rebase_pr_stacks [EXTRACTED 0.90]
- **Develop PR Preview Controller Flow** — github_workflows_develop_pr_preview_workflow, github_workflows_develop_pr_preview_dispatch_job, github_workflows_develop_pr_preview_repository_dispatch, github_workflows_develop_pr_preview_controller_event, github_workflows_develop_pr_preview_controller_job, github_workflows_develop_pr_preview_deploy_script [EXTRACTED 0.95]
- **Canonical AI Instruction Files** — agents_thingtime_ai_instructions, ai_all_thingtime_ai_instructions, claude_thingtime_ai_instructions [EXTRACTED 0.95]

## Communities (42 total, 17 thin omitted)

### Community 0 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.06
Nodes (95): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), assertVercelConfiguration(), assertWildcardFallbackRuntimes() (+87 more)

### Community 1 - "promotion-pr-changelog.mjs"
Cohesion: 0.09
Nodes (33): botCommentsByLatestEvent(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), externalStackPromotionState(), findBotPromotionRetirement(), groupFailureMessages(), groupKeyFor() (+25 more)

### Community 2 - "selfTest"
Cohesion: 0.11
Nodes (26): attestationMatches(), CFG, checkpointRecoveryDisposition(), createPromotionReviewCheckpoint(), encodePromotionAttestation(), env(), exactCheckpointPush(), EXEC_OPTS (+18 more)

### Community 3 - "build-all-branch.mjs"
Cohesion: 0.15
Nodes (30): cancelPromotionRetirement(), closeRedundantPass(), createPromotionPr(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata() (+22 more)

### Community 4 - "promote-features-to-main.mjs"
Cohesion: 0.15
Nodes (28): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers(), failureDetail() (+20 more)

### Community 5 - "runPromotion"
Cohesion: 0.13
Nodes (25): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertBareControlPlaneTree(), assertControlPlaneContract() (+17 more)

### Community 6 - "failureDetail"
Cohesion: 0.11
Nodes (21): Lopu agent composite action, Lopu rebase conflict round action, Copy trusted round code step, Resolve conflict set with Lopu step, Validate conflicts and create scratch step, Verify and continue rebase step, Lopu internal all-branch integration workflow, All-branch build doctor (+13 more)

### Community 7 - "workflow-control-plane-contract.mjs"
Cohesion: 0.12
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 8 - "refresh-promotion-graphify.sh"
Cohesion: 0.25
Nodes (19): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp(), flattenWorkflowRuns() (+11 more)

### Community 9 - "Rebuild Job"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay(), RESERVATION_SHA (+8 more)

### Community 10 - "codeql-open-pr-backfill.mjs"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 11 - "promotion-worker-contract.sh"
Cohesion: 0.22
Nodes (14): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), LOPU_ACTION_URL, positiveDecimal(), REBASE_ACTION_URL (+6 more)

### Community 12 - "promotion-worker.sh"
Cohesion: 0.17
Nodes (11): Thingtime AI Instructions, Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify (+3 more)

### Community 13 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.17
Nodes (11): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, graphify, lopuAgent, mainDevelopSyncWorkflow, promoter (+3 more)

### Community 14 - "prepare-round.sh"
Cohesion: 0.22
Nodes (10): ai-merge-paused Stop Label, All-branch Doctor, CodeQL Coverage and Triage, Control-plane Changelog, Graphify Semantic Refresh, LOPU_AGENT_BACKEND Selector, Lopu PR Manager, Partial Clone Hydration Recovery (+2 more)

### Community 15 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.20
Nodes (10): actions/checkout v4.4.0, develop-pr-preview-controller event, Publish or reconcile develop S3 preview job, .github/scripts/deploy-develop-pr-preview.mjs, Dispatch trusted default-branch controller job, GitHub repository dispatch API, VERCEL_DEVELOP_DEPLOY_TOKEN, vercel-develop-pr-control environment (+2 more)

### Community 16 - "Graphify Semantic Refresh"
Cohesion: 0.20
Nodes (9): Fork setup: Vercel develop previews, github-actions CI Control Plane, Known trade-off, Lopu principal repository manager, Signed desktop PR releases, Stable develop domain, The bare-tree invariant, Why it is bare (+1 more)

### Community 17 - "Run Lopu with Primary Claude Credential"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 18 - "Publish or reconcile develop S3 preview job"
Cohesion: 0.48
Nodes (6): CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest()

### Community 19 - "`github-actions` — the CI control plane"
Cohesion: 0.33
Nodes (7): buildPromotionDispatchRequest(), dispatchPromotionResolution(), exactReservationDeleteArgs(), exactReservationPushArgs(), promotionDispatchArgs(), queueTrustedPromotionWorker(), redispatchPromotionReservation()

### Community 20 - "start.sh"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 21 - "Lopu PR Manager"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 22 - "classify-claude-credential-failure.mjs"
Cohesion: 0.50
Nodes (4): assertPrReleaseContract(), count(), here, workflow

### Community 23 - "queueTrustedPromotionWorker"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 24 - "verify-promotion-source-authority.sh"
Cohesion: 0.50
Nodes (4): Lopu CodeQL all branches workflow, CodeQL analyze job, CodeQL scope job, CodeQL PR handoff workflow

## Knowledge Gaps
- **129 isolated node(s):** `CAPACITY_PATTERNS`, `CREDENTIAL_PATTERNS`, `REQUIRED_CATEGORIES`, `ACTIVE_RUN_STATUSES`, `TRUSTED_ASSOCIATIONS` (+124 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Feature promotion promote job` connect `failureDetail` to `selfTest`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **What connects `CAPACITY_PATTERNS`, `CREDENTIAL_PATTERNS`, `REQUIRED_CATEGORIES` to the rest of the system?**
  _129 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `deploy-develop-pr-preview.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.06332842415316642 - nodes in this community are weakly interconnected._
- **Should `promotion-pr-changelog.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.0928030303030303 - nodes in this community are weakly interconnected._
- **Should `selfTest` be split into smaller, more focused modules?**
  _Cohesion score 0.11494252873563218 - nodes in this community are weakly interconnected._
- **Should `promote-features-to-main.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.1455026455026455 - nodes in this community are weakly interconnected._
- **Should `runPromotion` be split into smaller, more focused modules?**
  _Cohesion score 0.13230769230769232 - nodes in this community are weakly interconnected._