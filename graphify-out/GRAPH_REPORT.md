# Graph Report - thingtime  (2026-08-25)

## Corpus Check
- 21 files · ~130,793 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 583 nodes · 1206 edges · 60 communities (30 shown, 30 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.56)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `066484bd`
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
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_promotion-worker-routing-contract.mjs|promotion-worker-routing-contract.mjs]]
- [[_COMMUNITY_Lopu Internal Feature Promotion Workflow|Lopu Internal Feature Promotion Workflow]]
- [[_COMMUNITY_Lopu Agent Composite Action|Lopu Agent Composite Action]]
- [[_COMMUNITY_Publish or reconcile develop S3 preview job|Publish or reconcile develop S3 preview job]]
- [[_COMMUNITY_detect Job|detect Job]]
- [[_COMMUNITY_Post-merge Graphify Refresh|Post-merge Graphify Refresh]]
- [[_COMMUNITY_start.sh|start.sh]]
- [[_COMMUNITY_Build And Publish Signed PR Release Job|Build And Publish Signed PR Release Job]]
- [[_COMMUNITY_queueTrustedPromotionWorker|queueTrustedPromotionWorker]]
- [[_COMMUNITY_verify-promotion-source-authority.sh|verify-promotion-source-authority.sh]]
- [[_COMMUNITY_deploy-develop-pr-preview.mjs|deploy-develop-pr-preview.mjs]]
- [[_COMMUNITY_vercel.json|vercel.json]]
- [[_COMMUNITY_electron-pr-release-contract.mjs|electron-pr-release-contract.mjs]]
- [[_COMMUNITY_route Job|route Job]]
- [[_COMMUNITY_rebase-ownership-routing-contract.sh|rebase-ownership-routing-contract.sh]]
- [[_COMMUNITY_CodeQL Triage|CodeQL Triage]]
- [[_COMMUNITY_Web CI Workflow|Web CI Workflow]]
- [[_COMMUNITY_Promotion PR Changelog Script|Promotion PR Changelog Script]]
- [[_COMMUNITY_Route CI Compute Provider Workflow|Route CI Compute Provider Workflow]]
- [[_COMMUNITY_Electron App Release Workflow|Electron App Release Workflow]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_AI_ALL.md canonical instructions|AI_ALL.md canonical instructions]]
- [[_COMMUNITY_`github-actions` — the CI control plane|`github-actions` — the CI control plane]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_Fundamentals|Fundamentals]]
- [[_COMMUNITY_CI provider router workflow|CI provider router workflow]]
- [[_COMMUNITY_Commander App Release workflow|Commander App Release workflow]]
- [[_COMMUNITY_pr-conflict-resolver.yml (superseded)|pr-conflict-resolver.yml (superseded)]]
- [[_COMMUNITY_ai-merge-paused Label|ai-merge-paused Label]]
- [[_COMMUNITY_LOPU_AGENT_BACKEND|LOPU_AGENT_BACKEND]]
- [[_COMMUNITY_Lopu PR Manager|Lopu PR Manager]]
- [[_COMMUNITY_no-ai-merge Label|no-ai-merge Label]]
- [[_COMMUNITY_Promotion Lanes|Promotion Lanes]]
- [[_COMMUNITY_Stack Rebase Engine|Stack Rebase Engine]]
- [[_COMMUNITY_electron-pr-release.yml|electron-pr-release.yml]]
- [[_COMMUNITY_github-actions Branch|github-actions Branch]]
- [[_COMMUNITY_.githubactionslopu-agent|.github/actions/lopu-agent]]
- [[_COMMUNITY_Lopu PR Manager|Lopu PR Manager]]
- [[_COMMUNITY_Post-merge Graphify Refresh|Post-merge Graphify Refresh]]
- [[_COMMUNITY_Thin Product Branch Listeners|Thin Product Branch Listeners]]
- [[_COMMUNITY_Vercel Git Deployment Kill-switch|Vercel Git Deployment Kill-switch]]
- [[_COMMUNITY_workflow-control-plane-contract.mjs|workflow-control-plane-contract.mjs]]

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
- `Lopu CodeQL PR Handoff Workflow` --semantically_similar_to--> `CodeQL PR Handoff`  [INFERRED] [semantically similar]
  .github/workflows/codeql-pr-handoff.yml → CHANGELOG.md
- `Web CI Workflow` --references--> `Testing Checklist`  [INFERRED]
  .github/workflows/web-ci.yml → TESTING.md
- `Lopu CodeQL All Branches Workflow` --conceptually_related_to--> `Lopu CodeQL Triage`  [INFERRED]
  .github/workflows/codeql-analysis.yml → CHANGELOG.md
- `Lopu Agent Reference in Rebase Round` --references--> `Lopu Agent Composite Action`  [EXTRACTED]
  .github/actions/rebase-conflict-round/action.yml → .github/actions/lopu-agent/action.yml
- `Lopu Build Doctor` --calls--> `Lopu Agent Composite Action`  [EXTRACTED]
  .github/workflows/all-branch.yml → .github/actions/lopu-agent/action.yml

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Rebase Stack Detection Flow** — _github_workflows_rebase_pr_stacks_lopu_rebase_engine, _github_workflows_rebase_pr_stacks_route_job, _github_workflows_rebase_pr_stacks_detect_job, _github_workflows_rebase_pr_stacks_stack_member_jq, _github_workflows_rebase_pr_stacks_rebase_owner_jq [EXTRACTED 0.85]
- **Lopu Repository Management Flow** — changelog_lopu_pr_manager, readme_lopu_pr_manager, github_workflows_resolve_pr_conflicts_lopu_pr_manager, readme_lopu_agent_action [EXTRACTED 0.90]
- **Central CodeQL PR Scan Flow** — changelog_codeql_pr_handoff, github_workflows_codeql_pr_handoff_lopu_codeql_pr_handoff, github_workflows_codeql_analysis_lopu_codeql_all_branches, github_workflows_codeql_analysis_codeql_analyze [EXTRACTED 0.92]
- **Graphify Semantic Refresh Flow** — changelog_post_merge_graphify, readme_post_merge_graphify, github_workflows_resolve_pr_conflicts_graphify_refresh, changelog_lopu_agent_backend [EXTRACTED 0.86]
- **Develop PR Preview Controller Flow** — github_workflows_develop_pr_preview_workflow, github_workflows_develop_pr_preview_dispatch_job, github_workflows_develop_pr_preview_repository_dispatch, github_workflows_develop_pr_preview_controller_event, github_workflows_develop_pr_preview_controller_job, github_workflows_develop_pr_preview_deploy_script [EXTRACTED 0.95]
- **Claude and Codex Backend Selection** — changelog_lopu_agent_backend_selector, _github_actions_lopu_agent_action_validate_lopu_backend, _github_actions_lopu_agent_action_claude_code_action, _github_actions_lopu_agent_action_codex_action [EXTRACTED 0.95]
- **Signed Desktop PR Release Flow** — readme_signed_desktop_pr_releases, _github_workflows_electron_pr_release_workflow, _github_workflows_electron_pr_release_resolve_validate_source, _github_workflows_electron_pr_release_import_credentials, _github_workflows_electron_pr_release_publish_prerelease [EXTRACTED 0.90]
- **Provider Routed CI Workflows** — _github_workflows_ci_provider_router_route_ci_compute_provider, _github_workflows_promote_develop_to_main_promote_develop_to_main, _github_workflows_promote_features_to_main_promote_features_to_main, _github_workflows_rebase_pr_stacks_rebase_prs_and_stacks, _github_workflows_resolve_pr_conflicts_resolve_pr_conflicts, _github_workflows_sync_main_into_develop_sync_main_into_develop [EXTRACTED 0.90]
- **Canonical AI Instruction Files** — agents_thingtime_ai_instructions, ai_all_thingtime_ai_instructions, claude_thingtime_ai_instructions [EXTRACTED 0.95]

## Communities (60 total, 30 thin omitted)

### Community 0 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.06
Nodes (95): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), assertVercelConfiguration(), assertWildcardFallbackRuntimes() (+87 more)

### Community 1 - "promotion-pr-changelog.mjs"
Cohesion: 0.14
Nodes (35): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+27 more)

### Community 2 - "build-all-branch.mjs"
Cohesion: 0.19
Nodes (31): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode(), git() (+23 more)

### Community 3 - "selfTest"
Cohesion: 0.09
Nodes (33): botCommentsByLatestEvent(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), externalStackPromotionState(), findBotPromotionRetirement(), groupFailureMessages(), groupKeyFor() (+25 more)

### Community 4 - "runPromotion"
Cohesion: 0.15
Nodes (30): cancelPromotionRetirement(), closeRedundantPass(), createPromotionPr(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata() (+22 more)

### Community 5 - "failureDetail"
Cohesion: 0.15
Nodes (28): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers(), failureDetail() (+20 more)

### Community 6 - "workflow-control-plane-contract.mjs"
Cohesion: 0.13
Nodes (25): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, ALLOWED_MODELS, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertBareControlPlaneTree() (+17 more)

### Community 7 - "refresh-promotion-graphify.sh"
Cohesion: 0.12
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 8 - "promote-features-to-main.mjs"
Cohesion: 0.11
Nodes (26): attestationMatches(), CFG, checkpointRecoveryDisposition(), createPromotionReviewCheckpoint(), encodePromotionAttestation(), env(), exactCheckpointPush(), EXEC_OPTS (+18 more)

### Community 9 - "promotion-worker-contract.sh"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay(), RESERVATION_SHA (+8 more)

### Community 10 - "Analyze Job"
Cohesion: 0.17
Nodes (12): CodeQL PR Handoff, Lopu CodeQL Triage, actions/checkout, Analyze Job, github/codeql-action/analyze, github/codeql-action/init, gh api, Lopu CodeQL All Branches Workflow (+4 more)

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
Nodes (12): actions/checkout, build-all-branch.mjs, comment-contract-advisories Job, contract-advisories Job, deploy-develop-pr-preview.mjs, electron-pr-release-contract.mjs, actions/github-script, resolve-pr-conflicts-routing-contract.mjs (+4 more)

### Community 15 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 17 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.17
Nodes (11): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, graphify, lopuAgent, mainDevelopSyncWorkflow, promoter (+3 more)

### Community 18 - "Lopu Internal Feature Promotion Workflow"
Cohesion: 0.18
Nodes (11): ci-provider-router.yml, promotion-pr-changelog.mjs, promotion-pr Job, route Job, Lopu Internal Develop Promotion Workflow, ci-provider-router.yml, lanes Job, promote-features-to-main.mjs (+3 more)

### Community 19 - "Lopu Agent Composite Action"
Cohesion: 0.20
Nodes (10): anthropics/claude-code-action, openai/codex-action, Lopu Agent Composite Action, Validate the Lopu Backend Step, Lopu Agent Reference in Rebase Round, prepare-round.sh, Lopu Rebase Conflict Round Action, Lopu All-Branch Integration Workflow (+2 more)

### Community 20 - "Publish or reconcile develop S3 preview job"
Cohesion: 0.20
Nodes (10): actions/checkout v4.4.0, develop-pr-preview-controller event, Publish or reconcile develop S3 preview job, .github/scripts/deploy-develop-pr-preview.mjs, Dispatch trusted default-branch controller job, GitHub repository dispatch API, VERCEL_DEVELOP_DEPLOY_TOKEN, vercel-develop-pr-control environment (+2 more)

### Community 21 - "detect Job"
Cohesion: 0.22
Nodes (9): branch_protected, ci-provider-router.yml, detect Job, live_ref_sha, Lopu Rebase Engine Workflow, REBASE_OWNER_JQ, remove_label_verified, route Job (+1 more)

### Community 23 - "start.sh"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 24 - "Build And Publish Signed PR Release Job"
Cohesion: 0.29
Nodes (7): Build Signed And Notarized Electron Release Step, Derive SemVer PR Release Identity Step, Import Developer ID And Notarization Credentials Step, Publish Prerelease Step, Build And Publish Signed PR Release Job, Resolve And Validate PR Source Step, Signed Electron PR Release Workflow

### Community 25 - "queueTrustedPromotionWorker"
Cohesion: 0.33
Nodes (7): buildPromotionDispatchRequest(), dispatchPromotionResolution(), exactReservationDeleteArgs(), exactReservationPushArgs(), promotionDispatchArgs(), queueTrustedPromotionWorker(), redispatchPromotionReservation()

### Community 26 - "verify-promotion-source-authority.sh"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 28 - "vercel.json"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 29 - "electron-pr-release-contract.mjs"
Cohesion: 0.50
Nodes (4): assertPrReleaseContract(), count(), here, workflow

### Community 30 - "route Job"
Cohesion: 0.50
Nodes (4): ci-provider-router.yml, route Job, sync Job, Lopu Internal Main Develop Synchronization Workflow

### Community 31 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 39 - "`github-actions` — the CI control plane"
Cohesion: 0.12
Nodes (14): Added, Changed, Control-plane changelog, Fixed, [Unreleased], Fork setup: Vercel develop previews, `github-actions` — the CI control plane, Known trade-off (+6 more)

## Ambiguous Edges - Review These
- `detect Job` → `branch_protected`  [AMBIGUOUS]
  .github/workflows/rebase-pr-stacks.yml · relation: calls
- `detect Job` → `live_ref_sha`  [AMBIGUOUS]
  .github/workflows/rebase-pr-stacks.yml · relation: calls
- `detect Job` → `remove_label_verified`  [AMBIGUOUS]
  .github/workflows/rebase-pr-stacks.yml · relation: calls

## Knowledge Gaps
- **176 isolated node(s):** `BASE_BRANCHES`, `MERGE_CONFIG`, `TRUSTED_ASSOCIATIONS`, `TRUSTED_PERMISSIONS`, `PR_EVENT_ACTIONS` (+171 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **30 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `detect Job` and `branch_protected`?**
  _Edge tagged AMBIGUOUS (relation: calls) - confidence is low._
- **What is the exact relationship between `detect Job` and `live_ref_sha`?**
  _Edge tagged AMBIGUOUS (relation: calls) - confidence is low._
- **What is the exact relationship between `detect Job` and `remove_label_verified`?**
  _Edge tagged AMBIGUOUS (relation: calls) - confidence is low._
- **Why does `selfTest()` connect `selfTest` to `promote-features-to-main.mjs`, `queueTrustedPromotionWorker`, `runPromotion`, `failureDetail`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Why does `runPromotion()` connect `runPromotion` to `promote-features-to-main.mjs`, `selfTest`, `failureDetail`?**
  _High betweenness centrality (0.001) - this node is a cross-community bridge._
- **Why does `failureDetail()` connect `failureDetail` to `promote-features-to-main.mjs`, `queueTrustedPromotionWorker`, `selfTest`, `runPromotion`?**
  _High betweenness centrality (0.001) - this node is a cross-community bridge._
- **What connects `BASE_BRANCHES`, `MERGE_CONFIG`, `TRUSTED_ASSOCIATIONS` to the rest of the system?**
  _176 weakly-connected nodes found - possible documentation gaps or missing edges._