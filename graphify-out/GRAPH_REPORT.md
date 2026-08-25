# Graph Report - lopu-durable-agent-queue  (2026-08-25)

## Corpus Check
- 21 files · ~125,809 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 552 nodes · 1195 edges · 46 communities (32 shown, 14 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.52)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `caefc746`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_deploy-develop-pr-preview.mjs|deploy-develop-pr-preview.mjs]]
- [[_COMMUNITY_promotion-pr-changelog.mjs|promotion-pr-changelog.mjs]]
- [[_COMMUNITY_build-all-branch.mjs|build-all-branch.mjs]]
- [[_COMMUNITY_failureDetail|failureDetail]]
- [[_COMMUNITY_selfTest|selfTest]]
- [[_COMMUNITY_prepare-round.sh|prepare-round.sh]]
- [[_COMMUNITY_promote-features-to-main.mjs|promote-features-to-main.mjs]]
- [[_COMMUNITY_workflow-control-plane-contract.mjs|workflow-control-plane-contract.mjs]]
- [[_COMMUNITY_refresh-promotion-graphify.sh|refresh-promotion-graphify.sh]]
- [[_COMMUNITY_promotion-worker-contract.sh|promotion-worker-contract.sh]]
- [[_COMMUNITY_Lopu PR manager Workflow|Lopu PR manager Workflow]]
- [[_COMMUNITY_runPromotion|runPromotion]]
- [[_COMMUNITY_promotion-worker.sh|promotion-worker.sh]]
- [[_COMMUNITY_repoFlag|repoFlag]]
- [[_COMMUNITY_resolve-pr-conflicts-routing-contract.mjs|resolve-pr-conflicts-routing-contract.mjs]]
- [[_COMMUNITY_run_contract Shell Function|run_contract Shell Function]]
- [[_COMMUNITY_Thingtime AI instructions|Thingtime AI instructions]]
- [[_COMMUNITY_CodeQL All Branches Workflow|CodeQL All Branches Workflow]]
- [[_COMMUNITY_recoverPromotionReviewCheckpoint|recoverPromotionReviewCheckpoint]]
- [[_COMMUNITY_analyze Job|analyze Job]]
- [[_COMMUNITY_`github-actions` — the CI control plane|`github-actions` — the CI control plane]]
- [[_COMMUNITY_start.sh|start.sh]]
- [[_COMMUNITY_Build And Publish Signed PR Release Job|Build And Publish Signed PR Release Job]]
- [[_COMMUNITY_promotion-worker-routing-contract.mjs|promotion-worker-routing-contract.mjs]]
- [[_COMMUNITY_verify-promotion-source-authority.sh|verify-promotion-source-authority.sh]]
- [[_COMMUNITY_vercel.json|vercel.json]]
- [[_COMMUNITY_electron-pr-release-contract.mjs|electron-pr-release-contract.mjs]]
- [[_COMMUNITY_Route CI Compute Provider Workflow|Route CI Compute Provider Workflow]]
- [[_COMMUNITY_rebase-ownership-routing-contract.sh|rebase-ownership-routing-contract.sh]]
- [[_COMMUNITY_controller publish or reconcile preview|controller: publish or reconcile preview]]
- [[_COMMUNITY_Build All Branch Script|Build All Branch Script]]
- [[_COMMUNITY_Web CI Workflow|Web CI Workflow]]
- [[_COMMUNITY_Electron App Release Workflow|Electron App Release Workflow]]
- [[_COMMUNITY_Web CI Workflow|Web CI Workflow]]
- [[_COMMUNITY_AI_ALL.md canonical instructions|AI_ALL.md canonical instructions]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_Fundamentals|Fundamentals]]
- [[_COMMUNITY_Commander App Release workflow|Commander App Release workflow]]
- [[_COMMUNITY_pr-conflict-resolver.yml (superseded)|pr-conflict-resolver.yml (superseded)]]
- [[_COMMUNITY_Bare Tree Invariant|Bare Tree Invariant]]
- [[_COMMUNITY_Develop PR Preview Controller|Develop PR Preview Controller]]
- [[_COMMUNITY_Thin Product Branch Listeners|Thin Product Branch Listeners]]
- [[_COMMUNITY_Vercel Git Deployment Kill Switch|Vercel Git Deployment Kill Switch]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_AI Conflict Resolution|AI Conflict Resolution]]

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
- `Promote Develop To Main Workflow` --references--> `Promotion PR Changelog Script`  [EXTRACTED]
  .github/workflows/promote-develop-to-main.yml → .github/scripts/promotion-pr-changelog.mjs
- `Promote Develop To Main Workflow` --references--> `Route CI Compute Provider Workflow`  [EXTRACTED]
  .github/workflows/promote-develop-to-main.yml → .github/workflows/ci-provider-router.yml
- `Sync Main Into Develop Workflow` --references--> `Route CI Compute Provider Workflow`  [EXTRACTED]
  .github/workflows/sync-main-into-develop.yml → .github/workflows/ci-provider-router.yml
- `Promote features to main workflow` --calls--> `CI provider router workflow`  [EXTRACTED]
  .github/workflows/promote-features-to-main.yml → .github/workflows/ci-provider-router.yml

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Lopu Control Plane PR Automation** — changelog_github_actions_control_plane, changelog_lopu_pr_management, changelog_promotion_lanes [EXTRACTED 0.86]
- **All Branch Rebuild and Doctor Flow** — github_workflows_all_branch_workflow, github_workflows_all_branch_rebuild_job, github_scripts_build_all_branch_build_all_branch, github_workflows_all_branch_claude_code_action [EXTRACTED 0.92]
- **Build Environment Setup** — github_workflows_all_branch_rebuild_job, github_workflows_all_branch_pnpm_action_setup, github_workflows_all_branch_actions_setup_node, github_workflows_all_branch_actions_checkout [EXTRACTED 0.90]
- **Graphify Post-resolution Refresh Pattern** — changelog_graphify_refresh, github_workflows_resolve_pr_conflicts_graphify_out_refresh, github_workflows_rebase_pr_stacks_lopu_rebase_engine [EXTRACTED 0.90]
- **Thin Product Listener Control-plane Pattern** — changelog_thin_product_listeners, github_workflows_resolve_pr_conflicts_thin_listener_contract, changelog_github_actions_branch [EXTRACTED 0.95]
- **CodeQL Advanced Setup Flow** — github_workflows_codeql_analysis_workflow, github_workflows_codeql_analysis_scope_job, github_workflows_codeql_analysis_analyze_job, github_workflows_codeql_analysis_codeql_init, github_workflows_codeql_analysis_codeql_analyze [EXTRACTED 0.95]
- **Signed Desktop PR Release Flow** — readme_signed_desktop_pr_releases, _github_workflows_electron_pr_release_workflow, _github_workflows_electron_pr_release_resolve_validate_source, _github_workflows_electron_pr_release_import_credentials, _github_workflows_electron_pr_release_publish_prerelease [EXTRACTED 0.90]
- **Control Plane Shape Contract** — readme_github_actions_control_plane, readme_bare_tree_invariant, readme_thin_listeners, readme_vercel_kill_switch, _github_workflows_control_plane_ci_workflow [EXTRACTED 0.90]
- **Isolated AI rebase conflict round flow** — github_actions_rebase_conflict_round_action_bootstrap, github_actions_rebase_conflict_round_action_prepare, github_actions_rebase_conflict_round_action_claude, github_actions_rebase_conflict_round_action_verify, github_scripts_rebase_stack_prepare_round [EXTRACTED 0.90]
- **Provider Routed CI Workflows** — _github_workflows_ci_provider_router_route_ci_compute_provider, _github_workflows_promote_develop_to_main_promote_develop_to_main, _github_workflows_promote_features_to_main_promote_features_to_main, _github_workflows_rebase_pr_stacks_rebase_prs_and_stacks, _github_workflows_resolve_pr_conflicts_resolve_pr_conflicts, _github_workflows_sync_main_into_develop_sync_main_into_develop [EXTRACTED 0.90]
- **Canonical AI Instruction Files** — agents_thingtime_ai_instructions, ai_all_thingtime_ai_instructions, claude_thingtime_ai_instructions [EXTRACTED 0.95]

## Communities (46 total, 14 thin omitted)

### Community 0 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.06
Nodes (95): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), assertVercelConfiguration(), assertWildcardFallbackRuntimes() (+87 more)

### Community 1 - "promotion-pr-changelog.mjs"
Cohesion: 0.14
Nodes (35): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+27 more)

### Community 2 - "build-all-branch.mjs"
Cohesion: 0.19
Nodes (31): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode(), git() (+23 more)

### Community 3 - "failureDetail"
Cohesion: 0.13
Nodes (32): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), createPromotionReviewCheckpoint(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers() (+24 more)

### Community 4 - "selfTest"
Cohesion: 0.10
Nodes (30): botCommentsByLatestEvent(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), exactReservationDeleteArgs(), exactReservationPushArgs(), externalStackPromotionState(), findBotPromotionRetirement() (+22 more)

### Community 5 - "prepare-round.sh"
Cohesion: 0.14
Nodes (14): ci-provider-router Workflow, detect Job, GitHub API, Lopu Rebase Engine, route Job, Scan Open Same-repository PRs Step, ai-merge-paused Label, Claude Resolution Agent (+6 more)

### Community 6 - "promote-features-to-main.mjs"
Cohesion: 0.12
Nodes (22): CFG, env(), EXEC_OPTS, flag(), gh(), ghJson(), git(), isExactPausedPromotionSnapshot() (+14 more)

### Community 7 - "workflow-control-plane-contract.mjs"
Cohesion: 0.13
Nodes (25): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, ALLOWED_MODELS, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertBareControlPlaneTree() (+17 more)

### Community 8 - "refresh-promotion-graphify.sh"
Cohesion: 0.13
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 9 - "promotion-worker-contract.sh"
Cohesion: 0.18
Nodes (19): anthropics/claude-code-action, AI rebase conflict round action, bootstrap: copy trusted round code, claude: resolve conflict set in scratch, prepare: validate conflicts and scratch, verify: scratch verification and rebase continue, assert_safe_regular_text_conflict(), clear_scratch() (+11 more)

### Community 10 - "Lopu PR manager Workflow"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay(), RESERVATION_SHA (+8 more)

### Community 11 - "runPromotion"
Cohesion: 0.21
Nodes (17): cancelPromotionRetirement(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata(), findOpenPromotionNumber(), listRemotePromotionBranches(), processGroupsIndependently(), promotionBody() (+9 more)

### Community 12 - "promotion-worker.sh"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 13 - "repoFlag"
Cohesion: 0.27
Nodes (14): buildPromotionDispatchRequest(), closeRedundantPass(), createPromotionPr(), dispatchPromotionResolution(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), promotionDispatchArgs(), queueTrustedPromotionWorker() (+6 more)

### Community 14 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.24
Nodes (13): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), positiveDecimal(), REBASE_ACTION_URL, REBASE_WORKFLOW_URL (+5 more)

### Community 15 - "run_contract Shell Function"
Cohesion: 0.17
Nodes (12): actions/checkout, build-all-branch.mjs, comment-contract-advisories Job, contract-advisories Job, deploy-develop-pr-preview.mjs, electron-pr-release-contract.mjs, actions/github-script, resolve-pr-conflicts-routing-contract.mjs (+4 more)

### Community 16 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Thingtime AI Instructions, Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify (+3 more)

### Community 17 - "CodeQL All Branches Workflow"
Cohesion: 0.27
Nodes (10): attestationMatches(), checkpointRecoveryDisposition(), encodePromotionAttestation(), exactCheckpointPush(), isObjectId(), liveRefShaWithActionsToken(), promotionAttestationBody(), promotionResolverRunDisposition() (+2 more)

### Community 18 - "recoverPromotionReviewCheckpoint"
Cohesion: 0.20
Nodes (10): Actions Language Analysis, analyze Job, actions/checkout v6.1.0, github/codeql-action/analyze v4, github/codeql-action/init v4, gh pr list, JavaScript TypeScript Language Analysis, jq Head Ref OID Check (+2 more)

### Community 19 - "analyze Job"
Cohesion: 0.22
Nodes (8): Fork setup: Vercel develop previews, github-actions CI Control Plane, Known trade-off, Signed desktop PR releases, Stable develop domain, The bare-tree invariant, Why it is bare, Working on it

### Community 20 - "`github-actions` — the CI control plane"
Cohesion: 0.25
Nodes (7): action, allBranchWorkflow, graphify, promoter, rebaseWorkflow, worker, workflow

### Community 21 - "start.sh"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 22 - "Build And Publish Signed PR Release Job"
Cohesion: 0.29
Nodes (7): Build Signed And Notarized Electron Release Step, Derive SemVer PR Release Identity Step, Import Developer ID And Notarization Credentials Step, Publish Prerelease Step, Build And Publish Signed PR Release Job, Resolve And Validate PR Source Step, Signed Electron PR Release Workflow

### Community 23 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 24 - "verify-promotion-source-authority.sh"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 25 - "vercel.json"
Cohesion: 0.50
Nodes (4): assertSignedPrReleaseContract(), count(), here, workflow

### Community 26 - "electron-pr-release-contract.mjs"
Cohesion: 0.40
Nodes (5): CI provider router workflow, Promote develop to main (omnibus), Promote features to main workflow, lanes: fan out the CI promotion lanes, Sync main into develop

### Community 27 - "Route CI Compute Provider Workflow"
Cohesion: 0.50
Nodes (4): Promotion PR Changelog Script, Route CI Compute Provider Workflow, Promote Develop To Main Workflow, Sync Main Into Develop Workflow

### Community 28 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 29 - "controller: publish or reconcile preview"
Cohesion: 0.50
Nodes (4): pull_request Trigger, push Trigger For github-actions, CodeQL All Branches Workflow, workflow_call Trigger

### Community 44 - "Thingtime AI Instructions"
Cohesion: 0.33
Nodes (5): Added, Changed, Control-plane changelog, Fixed, [Unreleased]

### Community 45 - "AI Conflict Resolution"
Cohesion: 1.00
Nodes (3): Develop S3 PR preview implementation, controller: publish or reconcile preview, dispatch: trusted default-branch controller

## Knowledge Gaps
- **149 isolated node(s):** `BASE_BRANCHES`, `MERGE_CONFIG`, `workflow`, `rebaseWorkflow`, `allBranchWorkflow` (+144 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `selfTest()` connect `selfTest` to `failureDetail`, `promote-features-to-main.mjs`, `runPromotion`, `repoFlag`, `CodeQL All Branches Workflow`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Why does `runPromotion()` connect `runPromotion` to `failureDetail`, `selfTest`, `promote-features-to-main.mjs`, `repoFlag`, `CodeQL All Branches Workflow`?**
  _High betweenness centrality (0.002) - this node is a cross-community bridge._
- **Why does `controller: publish or reconcile preview` connect `AI Conflict Resolution` to `deploy-develop-pr-preview.mjs`?**
  _High betweenness centrality (0.001) - this node is a cross-community bridge._
- **What connects `BASE_BRANCHES`, `MERGE_CONFIG`, `workflow` to the rest of the system?**
  _149 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `deploy-develop-pr-preview.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.06332842415316642 - nodes in this community are weakly interconnected._
- **Should `promotion-pr-changelog.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.14126984126984127 - nodes in this community are weakly interconnected._
- **Should `failureDetail` be split into smaller, more focused modules?**
  _Cohesion score 0.12701612903225806 - nodes in this community are weakly interconnected._