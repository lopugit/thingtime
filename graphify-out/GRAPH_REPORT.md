# Graph Report - lopu-batch-activation.rxgwYp  (2026-08-27)

## Corpus Check
- 23 files · ~141,493 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 582 nodes · 1250 edges · 56 communities (30 shown, 26 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.55)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8098626c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_deploy-develop-pr-preview.mjs|deploy-develop-pr-preview.mjs]]
- [[_COMMUNITY_selfTest|selfTest]]
- [[_COMMUNITY_build-all-branch.mjs|build-all-branch.mjs]]
- [[_COMMUNITY_promote-features-to-main.mjs|promote-features-to-main.mjs]]
- [[_COMMUNITY_runPromotion|runPromotion]]
- [[_COMMUNITY_failureDetail|failureDetail]]
- [[_COMMUNITY_workflow-control-plane-contract.mjs|workflow-control-plane-contract.mjs]]
- [[_COMMUNITY_prepare-round.sh|prepare-round.sh]]
- [[_COMMUNITY_refresh-promotion-graphify.sh|refresh-promotion-graphify.sh]]
- [[_COMMUNITY_codeql-open-pr-backfill.mjs|codeql-open-pr-backfill.mjs]]
- [[_COMMUNITY_promotion-worker-contract.sh|promotion-worker-contract.sh]]
- [[_COMMUNITY_resolve-pr-conflicts-routing-contract.mjs|resolve-pr-conflicts-routing-contract.mjs]]
- [[_COMMUNITY_Rebuild Job|Rebuild Job]]
- [[_COMMUNITY_promotion-worker.sh|promotion-worker.sh]]
- [[_COMMUNITY_scope select one analysis owner|scope: select one analysis owner]]
- [[_COMMUNITY_promotion-worker-routing-contract.mjs|promotion-worker-routing-contract.mjs]]
- [[_COMMUNITY_Publish or reconcile develop S3 preview job|Publish or reconcile develop S3 preview job]]
- [[_COMMUNITY_`github-actions` — the CI control plane|`github-actions` — the CI control plane]]
- [[_COMMUNITY_start.sh|start.sh]]
- [[_COMMUNITY_classify-claude-credential-failure.mjs|classify-claude-credential-failure.mjs]]
- [[_COMMUNITY_queueTrustedPromotionWorker|queueTrustedPromotionWorker]]
- [[_COMMUNITY_verify-promotion-source-authority.sh|verify-promotion-source-authority.sh]]
- [[_COMMUNITY_detect job|detect job]]
- [[_COMMUNITY_vercel.json|vercel.json]]
- [[_COMMUNITY_electron-pr-release-contract.mjs|electron-pr-release-contract.mjs]]
- [[_COMMUNITY_rebase-ownership-routing-contract.sh|rebase-ownership-routing-contract.sh]]
- [[_COMMUNITY_Lopu internal develop promotion|Lopu internal develop promotion]]
- [[_COMMUNITY_STACK_MEMBER_JQ|STACK_MEMBER_JQ]]
- [[_COMMUNITY_Lopu Build Doctor Round 1|Lopu Build Doctor Round 1]]
- [[_COMMUNITY_Web CI Workflow|Web CI Workflow]]
- [[_COMMUNITY_Contract Advisories|Contract Advisories]]
- [[_COMMUNITY_Electron App Release Workflow|Electron App Release Workflow]]
- [[_COMMUNITY_Graphify CLI|Graphify CLI]]
- [[_COMMUNITY_Lopu Agent Action|Lopu Agent Action]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_AI_ALL.md canonical instructions|AI_ALL.md canonical instructions]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_Fundamentals|Fundamentals]]
- [[_COMMUNITY_Commander App Release workflow|Commander App Release workflow]]
- [[_COMMUNITY_Develop PR Preview Deployment Script|Develop PR Preview Deployment Script]]
- [[_COMMUNITY_Electron PR Release Workflow|Electron PR Release Workflow]]
- [[_COMMUNITY_Thin Product Branch Listeners|Thin Product Branch Listeners]]
- [[_COMMUNITY_Vercel Git Deployment Kill Switch|Vercel Git Deployment Kill Switch]]
- [[_COMMUNITY_promotion-pr-changelog.mjs|promotion-pr-changelog.mjs]]
- [[_COMMUNITY_Thingtime AI instructions|Thingtime AI instructions]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_ai-merge-paused Stop Label|ai-merge-paused Stop Label]]
- [[_COMMUNITY_CodeQL Coverage and Triage|CodeQL Coverage and Triage]]
- [[_COMMUNITY_Graphify Semantic Refresh|Graphify Semantic Refresh]]
- [[_COMMUNITY_LOPU_AGENT_BACKEND Selector|LOPU_AGENT_BACKEND Selector]]
- [[_COMMUNITY_Lopu PR Manager|Lopu PR Manager]]
- [[_COMMUNITY_Partial Clone Hydration Recovery|Partial Clone Hydration Recovery]]
- [[_COMMUNITY_Promotion Recovery|Promotion Recovery]]
- [[_COMMUNITY_Rebase Stack Recovery|Rebase Stack Recovery]]
- [[_COMMUNITY_github-actions CI Control Plane|github-actions CI Control Plane]]
- [[_COMMUNITY_Legacy PR conflict resolver (superseded)|Legacy PR conflict resolver (superseded)]]

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
- `Lopu Internal All-branch Integration Workflow` --conceptually_related_to--> `All-branch Doctor`  [INFERRED]
  .github/workflows/all-branch.yml → CHANGELOG.md
- `bootstrap: copy trusted round code` --references--> `Lopu agent action`  [EXTRACTED]
  .github/actions/rebase-conflict-round/action.yml → .github/actions/lopu-agent/action.yml
- `lopu: resolve rebase conflict set` --calls--> `Lopu agent action`  [EXTRACTED]
  .github/actions/rebase-conflict-round/action.yml → .github/actions/lopu-agent/action.yml
- `CodeQL PR handoff workflow` --references--> `Lopu CodeQL all branches`  [EXTRACTED]
  .github/workflows/codeql-pr-handoff.yml → .github/workflows/codeql-analysis.yml

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

## Communities (56 total, 26 thin omitted)

### Community 0 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.06
Nodes (95): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), assertVercelConfiguration(), assertWildcardFallbackRuntimes() (+87 more)

### Community 1 - "selfTest"
Cohesion: 0.09
Nodes (33): botCommentsByLatestEvent(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), externalStackPromotionState(), findBotPromotionRetirement(), groupFailureMessages(), groupKeyFor() (+25 more)

### Community 2 - "build-all-branch.mjs"
Cohesion: 0.19
Nodes (31): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode(), git() (+23 more)

### Community 3 - "promote-features-to-main.mjs"
Cohesion: 0.11
Nodes (26): attestationMatches(), CFG, checkpointRecoveryDisposition(), createPromotionReviewCheckpoint(), encodePromotionAttestation(), env(), exactCheckpointPush(), EXEC_OPTS (+18 more)

### Community 4 - "runPromotion"
Cohesion: 0.15
Nodes (30): cancelPromotionRetirement(), closeRedundantPass(), createPromotionPr(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata() (+22 more)

### Community 5 - "failureDetail"
Cohesion: 0.15
Nodes (28): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers(), failureDetail() (+20 more)

### Community 6 - "workflow-control-plane-contract.mjs"
Cohesion: 0.13
Nodes (26): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, ALLOWED_MODELS, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertBareControlPlaneTree() (+18 more)

### Community 7 - "prepare-round.sh"
Cohesion: 0.18
Nodes (19): Lopu agent action, Lopu rebase conflict round (composite action), bootstrap: copy trusted round code, lopu: resolve rebase conflict set, prepare: validate conflicts and create scratch, verify: recompute and continue rebase, assert_safe_regular_text_conflict(), clear_scratch() (+11 more)

### Community 8 - "refresh-promotion-graphify.sh"
Cohesion: 0.12
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 9 - "codeql-open-pr-backfill.mjs"
Cohesion: 0.25
Nodes (19): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp(), flattenWorkflowRuns() (+11 more)

### Community 10 - "promotion-worker-contract.sh"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay(), RESERVATION_SHA (+8 more)

### Community 11 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.20
Nodes (16): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), decodeBatch(), encodeBatch(), LOPU_ACTION_URL (+8 more)

### Community 12 - "Rebuild Job"
Cohesion: 0.29
Nodes (7): build-all-branch.mjs, Doctor Commit Command, Lopu Internal All-branch Integration Workflow, Build-doctor Model Waterfall Loader, Rebuild Job, Union Build Check, All-branch Doctor

### Community 13 - "promotion-worker.sh"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 14 - "scope: select one analysis owner"
Cohesion: 0.50
Nodes (4): analyze: CodeQL matrix job, scope: select one analysis owner, Lopu CodeQL all branches, CodeQL PR handoff workflow

### Community 15 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.17
Nodes (11): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, graphify, lopuAgent, mainDevelopSyncWorkflow, promoter (+3 more)

### Community 16 - "Publish or reconcile develop S3 preview job"
Cohesion: 0.20
Nodes (10): actions/checkout v4.4.0, develop-pr-preview-controller event, Publish or reconcile develop S3 preview job, .github/scripts/deploy-develop-pr-preview.mjs, Dispatch trusted default-branch controller job, GitHub repository dispatch API, VERCEL_DEVELOP_DEPLOY_TOKEN, vercel-develop-pr-control environment (+2 more)

### Community 17 - "`github-actions` — the CI control plane"
Cohesion: 0.12
Nodes (14): Added, Changed, Control-plane changelog, Fixed, [Unreleased], Fork setup: Vercel develop previews, `github-actions` — the CI control plane, Known trade-off (+6 more)

### Community 18 - "start.sh"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 19 - "classify-claude-credential-failure.mjs"
Cohesion: 0.48
Nodes (6): CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest()

### Community 20 - "queueTrustedPromotionWorker"
Cohesion: 0.33
Nodes (7): buildPromotionDispatchRequest(), dispatchPromotionResolution(), exactReservationDeleteArgs(), exactReservationPushArgs(), promotionDispatchArgs(), queueTrustedPromotionWorker(), redispatchPromotionReservation()

### Community 21 - "verify-promotion-source-authority.sh"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 22 - "detect job"
Cohesion: 0.40
Nodes (6): ci-provider-router reusable workflow, detect job, GitHub API, Lopu rebase engine workflow, route job, Scan open same-repository PRs via the API

### Community 23 - "vercel.json"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 24 - "electron-pr-release-contract.mjs"
Cohesion: 0.50
Nodes (4): assertPrReleaseContract(), count(), here, workflow

### Community 25 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 26 - "Lopu internal develop promotion"
Cohesion: 1.00
Nodes (3): Lopu internal develop promotion, Lopu internal feature promotion, Sync main into develop

### Community 27 - "STACK_MEMBER_JQ"
Cohesion: 0.67
Nodes (3): no-ai-rebase label, REBASE_OWNER_JQ, STACK_MEMBER_JQ

### Community 43 - "promotion-pr-changelog.mjs"
Cohesion: 0.11
Nodes (42): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+34 more)

### Community 44 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

## Knowledge Gaps
- **152 isolated node(s):** `WORKFLOW_URL`, `REBASE_WORKFLOW_URL`, `REBASE_ACTION_URL`, `LOPU_ACTION_URL`, `REPO_ROOT` (+147 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **26 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `promote: replay merged develop PRs` connect `promotion-pr-changelog.mjs` to `promote-features-to-main.mjs`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **What connects `WORKFLOW_URL`, `REBASE_WORKFLOW_URL`, `REBASE_ACTION_URL` to the rest of the system?**
  _152 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `deploy-develop-pr-preview.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.06332842415316642 - nodes in this community are weakly interconnected._
- **Should `selfTest` be split into smaller, more focused modules?**
  _Cohesion score 0.0928030303030303 - nodes in this community are weakly interconnected._
- **Should `promote-features-to-main.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.11494252873563218 - nodes in this community are weakly interconnected._
- **Should `failureDetail` be split into smaller, more focused modules?**
  _Cohesion score 0.1455026455026455 - nodes in this community are weakly interconnected._
- **Should `workflow-control-plane-contract.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.12535612535612536 - nodes in this community are weakly interconnected._