# Graph Report - .  (2026-08-25)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 526 nodes · 1181 edges · 35 communities (25 shown, 10 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.57)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7e32084c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_deploy-develop-pr-preview.mjs|deploy-develop-pr-preview.mjs]]
- [[_COMMUNITY_prepare-round.sh|prepare-round.sh]]
- [[_COMMUNITY_promotion-pr-changelog.mjs|promotion-pr-changelog.mjs]]
- [[_COMMUNITY_failureDetail|failureDetail]]
- [[_COMMUNITY_workflow-control-plane-contract.mjs|workflow-control-plane-contract.mjs]]
- [[_COMMUNITY_build-all-branch.mjs|build-all-branch.mjs]]
- [[_COMMUNITY_selfTest|selfTest]]
- [[_COMMUNITY_promote-features-to-main.mjs|promote-features-to-main.mjs]]
- [[_COMMUNITY_runPromotion|runPromotion]]
- [[_COMMUNITY_refresh-promotion-graphify.sh|refresh-promotion-graphify.sh]]
- [[_COMMUNITY_recoverPromotionReviewCheckpoint|recoverPromotionReviewCheckpoint]]
- [[_COMMUNITY_promotion-worker-contract.sh|promotion-worker-contract.sh]]
- [[_COMMUNITY_promotion-worker.sh|promotion-worker.sh]]
- [[_COMMUNITY_resolve-pr-conflicts-routing-contract.mjs|resolve-pr-conflicts-routing-contract.mjs]]
- [[_COMMUNITY_start.sh|start.sh]]
- [[_COMMUNITY_promotion-worker-routing-contract.mjs|promotion-worker-routing-contract.mjs]]
- [[_COMMUNITY_verify-promotion-source-authority.sh|verify-promotion-source-authority.sh]]
- [[_COMMUNITY_Route CI Compute Provider Workflow|Route CI Compute Provider Workflow]]
- [[_COMMUNITY_rebase-ownership-routing-contract.sh|rebase-ownership-routing-contract.sh]]
- [[_COMMUNITY_Build All Branch Script|Build All Branch Script]]
- [[_COMMUNITY_controller publish or reconcile preview|controller: publish or reconcile preview]]
- [[_COMMUNITY_Web CI Workflow|Web CI Workflow]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_Electron App Release Workflow|Electron App Release Workflow]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_`github-actions` — the CI control plane|`github-actions` — the CI control plane]]
- [[_COMMUNITY_repoFlag|repoFlag]]
- [[_COMMUNITY_Thingtime AI instructions|Thingtime AI instructions]]
- [[_COMMUNITY_vercel.json|vercel.json]]
- [[_COMMUNITY_electron-pr-release-contract.mjs|electron-pr-release-contract.mjs]]
- [[_COMMUNITY_AI_ALL.md canonical instructions|AI_ALL.md canonical instructions]]
- [[_COMMUNITY_Lopu whole-PR repository review|Lopu whole-PR repository review]]
- [[_COMMUNITY_Unverified-lineage promotion review gating|Unverified-lineage promotion review gating]]

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
- `Signed Electron PR Release Workflow` --semantically_similar_to--> `Signed Desktop PR Release`  [INFERRED] [semantically similar]
  .github/workflows/electron-pr-release.yml → CHANGELOG.md
- `Post-merge Graphify Refresh` --semantically_similar_to--> `Graphify Structural And Semantic Refresh`  [INFERRED] [semantically similar]
  .github/workflows/resolve-pr-conflicts.yml → CHANGELOG.md
- `Web CI Workflow` --references--> `Testing Checklist`  [INFERRED]
  .github/workflows/web-ci.yml → TESTING.md
- `Build All Branch Workflow` --references--> `Build All Branch Script`  [EXTRACTED]
  .github/workflows/all-branch.yml → .github/scripts/build-all-branch.mjs
- `Promote Develop To Main Workflow` --references--> `Promotion PR Changelog Script`  [EXTRACTED]
  .github/workflows/promote-develop-to-main.yml → .github/scripts/promotion-pr-changelog.mjs

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Signed Desktop PR Release Flow** — readme_signed_desktop_pr_releases, _github_workflows_electron_pr_release_workflow, _github_workflows_electron_pr_release_resolve_validate_source, _github_workflows_electron_pr_release_import_credentials, _github_workflows_electron_pr_release_publish_prerelease [EXTRACTED 0.90]
- **Lopu PR Management Flow** — changelog_lopu_pr_manager, _github_workflows_resolve_pr_conflicts_workflow, _github_workflows_resolve_pr_conflicts_conflict_resolution, _github_workflows_resolve_pr_conflicts_detector_handoff, _github_workflows_resolve_pr_conflicts_graphify_refresh [EXTRACTED 0.88]
- **Control Plane Shape Contract** — readme_github_actions_control_plane, readme_bare_tree_invariant, readme_thin_listeners, readme_vercel_kill_switch, _github_workflows_control_plane_ci_workflow [EXTRACTED 0.90]
- **Isolated AI rebase conflict round flow** — github_actions_rebase_conflict_round_action_bootstrap, github_actions_rebase_conflict_round_action_prepare, github_actions_rebase_conflict_round_action_claude, github_actions_rebase_conflict_round_action_verify, github_scripts_rebase_stack_prepare_round [EXTRACTED 0.90]
- **Provider Routed CI Workflows** — _github_workflows_ci_provider_router_route_ci_compute_provider, _github_workflows_promote_develop_to_main_promote_develop_to_main, _github_workflows_promote_features_to_main_promote_features_to_main, _github_workflows_rebase_pr_stacks_rebase_prs_and_stacks, _github_workflows_resolve_pr_conflicts_resolve_pr_conflicts, _github_workflows_sync_main_into_develop_sync_main_into_develop [EXTRACTED 0.90]
- **Canonical AI Instruction Files** — agents_thingtime_ai_instructions, ai_all_thingtime_ai_instructions, claude_thingtime_ai_instructions [EXTRACTED 0.95]

## Communities (35 total, 10 thin omitted)

### Community 0 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.06
Nodes (95): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), assertVercelConfiguration(), assertWildcardFallbackRuntimes() (+87 more)

### Community 1 - "prepare-round.sh"
Cohesion: 0.05
Nodes (37): actions/checkout, build-all-branch.mjs, comment-contract-advisories Job, contract-advisories Job, deploy-develop-pr-preview.mjs, electron-pr-release-contract.mjs, actions/github-script, resolve-pr-conflicts-routing-contract.mjs (+29 more)

### Community 2 - "promotion-pr-changelog.mjs"
Cohesion: 0.14
Nodes (35): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+27 more)

### Community 3 - "failureDetail"
Cohesion: 0.19
Nodes (31): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode(), git() (+23 more)

### Community 4 - "workflow-control-plane-contract.mjs"
Cohesion: 0.13
Nodes (32): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), createPromotionReviewCheckpoint(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers() (+24 more)

### Community 5 - "build-all-branch.mjs"
Cohesion: 0.10
Nodes (30): botCommentsByLatestEvent(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), exactReservationDeleteArgs(), exactReservationPushArgs(), externalStackPromotionState(), findBotPromotionRetirement() (+22 more)

### Community 6 - "selfTest"
Cohesion: 0.11
Nodes (28): anthropics/claude-code-action, AI rebase conflict round action, bootstrap: copy trusted round code, claude: resolve conflict set in scratch, prepare: validate conflicts and scratch, verify: scratch verification and rebase continue, assert_safe_regular_text_conflict(), clear_scratch() (+20 more)

### Community 7 - "promote-features-to-main.mjs"
Cohesion: 0.12
Nodes (22): CFG, env(), EXEC_OPTS, flag(), gh(), ghJson(), git(), isExactPausedPromotionSnapshot() (+14 more)

### Community 8 - "runPromotion"
Cohesion: 0.13
Nodes (25): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, ALLOWED_MODELS, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertBareControlPlaneTree() (+17 more)

### Community 9 - "refresh-promotion-graphify.sh"
Cohesion: 0.13
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 10 - "recoverPromotionReviewCheckpoint"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay(), RESERVATION_SHA (+8 more)

### Community 11 - "promotion-worker-contract.sh"
Cohesion: 0.21
Nodes (17): cancelPromotionRetirement(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata(), findOpenPromotionNumber(), listRemotePromotionBranches(), processGroupsIndependently(), promotionBody() (+9 more)

### Community 12 - "promotion-worker.sh"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 13 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.27
Nodes (14): buildPromotionDispatchRequest(), closeRedundantPass(), createPromotionPr(), dispatchPromotionResolution(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), promotionDispatchArgs(), queueTrustedPromotionWorker() (+6 more)

### Community 14 - "start.sh"
Cohesion: 0.24
Nodes (13): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), positiveDecimal(), REBASE_ACTION_URL, REBASE_WORKFLOW_URL (+5 more)

### Community 15 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.17
Nodes (11): Thingtime AI Instructions, Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify (+3 more)

### Community 16 - "verify-promotion-source-authority.sh"
Cohesion: 0.27
Nodes (10): attestationMatches(), checkpointRecoveryDisposition(), encodePromotionAttestation(), exactCheckpointPush(), isObjectId(), liveRefShaWithActionsToken(), promotionAttestationBody(), promotionResolverRunDisposition() (+2 more)

### Community 17 - "Route CI Compute Provider Workflow"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 18 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.29
Nodes (6): action, graphify, promoter, rebaseWorkflow, worker, workflow

### Community 19 - "Build All Branch Script"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 20 - "controller: publish or reconcile preview"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 21 - "Web CI Workflow"
Cohesion: 0.50
Nodes (4): assertSignedPrReleaseContract(), count(), here, workflow

### Community 22 - "Thingtime AI Instructions"
Cohesion: 0.50
Nodes (4): Promotion PR Changelog Script, Route CI Compute Provider Workflow, Promote Develop To Main Workflow, Sync Main Into Develop Workflow

### Community 23 - "Electron App Release Workflow"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 24 - "Graphify Rules"
Cohesion: 1.00
Nodes (3): Develop S3 PR preview implementation, controller: publish or reconcile preview, dispatch: trusted default-branch controller

## Knowledge Gaps
- **123 isolated node(s):** `WORKFLOW_URL`, `REBASE_WORKFLOW_URL`, `REBASE_ACTION_URL`, `REPO_ROOT`, `BASE_BRANCHES` (+118 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `selfTest()` connect `build-all-branch.mjs` to `workflow-control-plane-contract.mjs`, `promote-features-to-main.mjs`, `promotion-worker-contract.sh`, `resolve-pr-conflicts-routing-contract.mjs`, `verify-promotion-source-authority.sh`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **What connects `WORKFLOW_URL`, `REBASE_WORKFLOW_URL`, `REBASE_ACTION_URL` to the rest of the system?**
  _123 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `deploy-develop-pr-preview.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.06332842415316642 - nodes in this community are weakly interconnected._
- **Should `prepare-round.sh` be split into smaller, more focused modules?**
  _Cohesion score 0.05405405405405406 - nodes in this community are weakly interconnected._
- **Should `promotion-pr-changelog.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.14126984126984127 - nodes in this community are weakly interconnected._
- **Should `workflow-control-plane-contract.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.12701612903225806 - nodes in this community are weakly interconnected._
- **Should `build-all-branch.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.10344827586206896 - nodes in this community are weakly interconnected._