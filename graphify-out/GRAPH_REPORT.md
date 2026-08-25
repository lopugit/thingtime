# Graph Report - .  (2026-08-25)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 558 nodes · 1214 edges · 46 communities (28 shown, 18 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.58)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `870dc664`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_deploy-develop-pr-preview.mjs|deploy-develop-pr-preview.mjs]]
- [[_COMMUNITY_run_contract Shell Function|run_contract Shell Function]]
- [[_COMMUNITY_promotion-pr-changelog.mjs|promotion-pr-changelog.mjs]]
- [[_COMMUNITY_build-all-branch.mjs|build-all-branch.mjs]]
- [[_COMMUNITY_failureDetail|failureDetail]]
- [[_COMMUNITY_selfTest|selfTest]]
- [[_COMMUNITY_prepare-round.sh|prepare-round.sh]]
- [[_COMMUNITY_promote-features-to-main.mjs|promote-features-to-main.mjs]]
- [[_COMMUNITY_workflow-control-plane-contract.mjs|workflow-control-plane-contract.mjs]]
- [[_COMMUNITY_refresh-promotion-graphify.sh|refresh-promotion-graphify.sh]]
- [[_COMMUNITY_promotion-worker-contract.sh|promotion-worker-contract.sh]]
- [[_COMMUNITY_runPromotion|runPromotion]]
- [[_COMMUNITY_promotion-worker.sh|promotion-worker.sh]]
- [[_COMMUNITY_repoFlag|repoFlag]]
- [[_COMMUNITY_resolve-pr-conflicts-routing-contract.mjs|resolve-pr-conflicts-routing-contract.mjs]]
- [[_COMMUNITY_Thingtime AI instructions|Thingtime AI instructions]]
- [[_COMMUNITY_recoverPromotionReviewCheckpoint|recoverPromotionReviewCheckpoint]]
- [[_COMMUNITY_start.sh|start.sh]]
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
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_AI_ALL.md canonical instructions|AI_ALL.md canonical instructions]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_Fundamentals|Fundamentals]]
- [[_COMMUNITY_Commander App Release workflow|Commander App Release workflow]]
- [[_COMMUNITY_pr-conflict-resolver.yml (superseded)|pr-conflict-resolver.yml (superseded)]]
- [[_COMMUNITY_`github-actions` — the CI control plane|`github-actions` — the CI control plane]]
- [[_COMMUNITY_Build And Publish Signed PR Release Job|Build And Publish Signed PR Release Job]]
- [[_COMMUNITY_AI-powered PR Conflict Resolution|AI-powered PR Conflict Resolution]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_ai-merge-paused Stop Label|ai-merge-paused Stop Label]]
- [[_COMMUNITY_Lopu PR Manager|Lopu PR Manager]]
- [[_COMMUNITY_Preview Wildcard Fallbacks|Preview Wildcard Fallbacks]]
- [[_COMMUNITY_Bare Tree Invariant|Bare Tree Invariant]]
- [[_COMMUNITY_Develop PR Preview Controller|Develop PR Preview Controller]]
- [[_COMMUNITY_github-actions CI Control Plane|github-actions CI Control Plane]]
- [[_COMMUNITY_Thin Product Branch Listeners|Thin Product Branch Listeners]]

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
10. `release job` - 15 edges

## Surprising Connections (you probably didn't know these)
- `Post-merge Graphify Refresh` --semantically_similar_to--> `Graphify Structural And Semantic Refresh`  [INFERRED] [semantically similar]
  .github/workflows/resolve-pr-conflicts.yml → CHANGELOG.md
- `Install release dependencies` --references--> `electron package version`  [INFERRED]
  .github/workflows/electron-pr-release.yml → electron/package.json
- `Derive SemVer PR release identity` --references--> `electron package version`  [EXTRACTED]
  .github/workflows/electron-pr-release.yml → electron/package.json
- `Build signed and notarized Electron release` --calls--> `electron dist script`  [EXTRACTED]
  .github/workflows/electron-pr-release.yml → electron/package.json
- `Test unsigned source before accessing signing credentials` --references--> `ThingtimeNode Swift package`  [EXTRACTED]
  .github/workflows/electron-pr-release.yml → macos/ThingtimeNode/Package.swift

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Owner-approved PR release trust gate** — _github_workflows_electron_pr_release_release, _github_workflows_electron_pr_release_source, _github_workflows_electron_pr_release_checkout_approved_pr_commit, _github_workflows_electron_pr_release_test_unsigned_source, _github_workflows_electron_pr_release_release_gate [EXTRACTED 0.85]
- **Signed vs unsigned distribution lane selection** — _github_workflows_electron_pr_release_distribution, _github_workflows_electron_pr_release_build_signed_release, _github_workflows_electron_pr_release_build_unsigned_release, _github_workflows_electron_pr_release_import_signing_credentials, _github_workflows_electron_pr_release_signed_lane, _github_workflows_electron_pr_release_unsigned_lane [EXTRACTED 0.85]
- **Version, assets, notes, and prerelease publication** — _github_workflows_electron_pr_release_version, _github_workflows_electron_pr_release_existing_release, _github_workflows_electron_pr_release_collect_release_assets, _github_workflows_electron_pr_release_generate_release_notes, _github_workflows_electron_pr_release_publish_prerelease [EXTRACTED 0.90]
- **Lopu PR Management Flow** — changelog_lopu_pr_manager, _github_workflows_resolve_pr_conflicts_workflow, _github_workflows_resolve_pr_conflicts_conflict_resolution, _github_workflows_resolve_pr_conflicts_detector_handoff, _github_workflows_resolve_pr_conflicts_graphify_refresh [EXTRACTED 0.88]
- **Control Plane Shape Contract** — readme_github_actions_control_plane, readme_bare_tree_invariant, readme_thin_listeners, readme_vercel_kill_switch, _github_workflows_control_plane_ci_workflow [EXTRACTED 0.90]
- **Isolated AI rebase conflict round flow** — github_actions_rebase_conflict_round_action_bootstrap, github_actions_rebase_conflict_round_action_prepare, github_actions_rebase_conflict_round_action_claude, github_actions_rebase_conflict_round_action_verify, github_scripts_rebase_stack_prepare_round [EXTRACTED 0.90]
- **Provider Routed CI Workflows** — _github_workflows_ci_provider_router_route_ci_compute_provider, _github_workflows_promote_develop_to_main_promote_develop_to_main, _github_workflows_promote_features_to_main_promote_features_to_main, _github_workflows_rebase_pr_stacks_rebase_prs_and_stacks, _github_workflows_resolve_pr_conflicts_resolve_pr_conflicts, _github_workflows_sync_main_into_develop_sync_main_into_develop [EXTRACTED 0.90]
- **Canonical AI Instruction Files** — agents_thingtime_ai_instructions, ai_all_thingtime_ai_instructions, claude_thingtime_ai_instructions [EXTRACTED 0.95]

## Communities (46 total, 18 thin omitted)

### Community 0 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.06
Nodes (95): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), assertVercelConfiguration(), assertWildcardFallbackRuntimes() (+87 more)

### Community 1 - "run_contract Shell Function"
Cohesion: 0.14
Nodes (35): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+27 more)

### Community 2 - "promotion-pr-changelog.mjs"
Cohesion: 0.19
Nodes (31): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode(), git() (+23 more)

### Community 3 - "build-all-branch.mjs"
Cohesion: 0.10
Nodes (30): botCommentsByLatestEvent(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), exactReservationDeleteArgs(), exactReservationPushArgs(), externalStackPromotionState(), findBotPromotionRetirement() (+22 more)

### Community 4 - "failureDetail"
Cohesion: 0.11
Nodes (28): anthropics/claude-code-action, AI rebase conflict round action, bootstrap: copy trusted round code, claude: resolve conflict set in scratch, prepare: validate conflicts and scratch, verify: scratch verification and rebase continue, assert_safe_regular_text_conflict(), clear_scratch() (+20 more)

### Community 5 - "selfTest"
Cohesion: 0.13
Nodes (32): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), createPromotionReviewCheckpoint(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers() (+24 more)

### Community 6 - "prepare-round.sh"
Cohesion: 0.11
Nodes (25): Build signed and notarized Electron release, Build unsigned Electron release, Check out approved PR commit, Collect updater-compatible release assets, Select release distribution, Stop if this release already exists, Generate PR release notes, Import Developer ID and notarization credentials (+17 more)

### Community 7 - "promote-features-to-main.mjs"
Cohesion: 0.12
Nodes (22): CFG, env(), EXEC_OPTS, flag(), gh(), ghJson(), git(), isExactPausedPromotionSnapshot() (+14 more)

### Community 8 - "workflow-control-plane-contract.mjs"
Cohesion: 0.13
Nodes (25): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, ALLOWED_MODELS, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertBareControlPlaneTree() (+17 more)

### Community 9 - "refresh-promotion-graphify.sh"
Cohesion: 0.13
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 10 - "promotion-worker-contract.sh"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay(), RESERVATION_SHA (+8 more)

### Community 11 - "runPromotion"
Cohesion: 0.27
Nodes (14): buildPromotionDispatchRequest(), closeRedundantPass(), createPromotionPr(), dispatchPromotionResolution(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), promotionDispatchArgs(), queueTrustedPromotionWorker() (+6 more)

### Community 12 - "promotion-worker.sh"
Cohesion: 0.13
Nodes (13): Added, Changed, Control-plane changelog, Fixed, [Unreleased], Fork setup: Vercel develop previews, github-actions CI Control Plane, Known trade-off (+5 more)

### Community 13 - "repoFlag"
Cohesion: 0.27
Nodes (10): attestationMatches(), checkpointRecoveryDisposition(), encodePromotionAttestation(), exactCheckpointPush(), isObjectId(), liveRefShaWithActionsToken(), promotionAttestationBody(), promotionResolverRunDisposition() (+2 more)

### Community 14 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 15 - "Thingtime AI instructions"
Cohesion: 0.24
Nodes (13): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), positiveDecimal(), REBASE_ACTION_URL, REBASE_WORKFLOW_URL (+5 more)

### Community 16 - "recoverPromotionReviewCheckpoint"
Cohesion: 0.17
Nodes (12): actions/checkout, build-all-branch.mjs, comment-contract-advisories Job, contract-advisories Job, deploy-develop-pr-preview.mjs, electron-pr-release-contract.mjs, actions/github-script, resolve-pr-conflicts-routing-contract.mjs (+4 more)

### Community 17 - "start.sh"
Cohesion: 0.17
Nodes (11): Thingtime AI Instructions, Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify (+3 more)

### Community 18 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.21
Nodes (17): cancelPromotionRetirement(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata(), findOpenPromotionNumber(), listRemotePromotionBranches(), processGroupsIndependently(), promotionBody() (+9 more)

### Community 19 - "verify-promotion-source-authority.sh"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 20 - "vercel.json"
Cohesion: 0.29
Nodes (7): ai-merge-paused Label Handling, AI-powered PR Conflict Resolution, Detector Handoff, Post-merge Graphify Refresh, no-ai-merge Opt-out Label, Lopu PR Manager Workflow, Graphify Structural And Semantic Refresh

### Community 21 - "electron-pr-release-contract.mjs"
Cohesion: 0.29
Nodes (6): action, graphify, promoter, rebaseWorkflow, worker, workflow

### Community 22 - "Route CI Compute Provider Workflow"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 23 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 24 - "controller: publish or reconcile preview"
Cohesion: 0.50
Nodes (4): assertPrReleaseContract(), count(), here, workflow

### Community 25 - "Build All Branch Script"
Cohesion: 0.50
Nodes (4): Promotion PR Changelog Script, Route CI Compute Provider Workflow, Promote Develop To Main Workflow, Sync Main Into Develop Workflow

### Community 26 - "Web CI Workflow"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 27 - "Electron App Release Workflow"
Cohesion: 1.00
Nodes (3): Develop S3 PR preview implementation, controller: publish or reconcile preview, dispatch: trusted default-branch controller

## Knowledge Gaps
- **141 isolated node(s):** `BASE_BRANCHES`, `MERGE_CONFIG`, `TRUSTED_ASSOCIATIONS`, `TRUSTED_PERMISSIONS`, `PR_EVENT_ACTIONS` (+136 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `selfTest()` connect `build-all-branch.mjs` to `selfTest`, `promote-features-to-main.mjs`, `runPromotion`, `repoFlag`, `promotion-worker-routing-contract.mjs`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Why does `runPromotion()` connect `promotion-worker-routing-contract.mjs` to `build-all-branch.mjs`, `selfTest`, `promote-features-to-main.mjs`, `runPromotion`, `repoFlag`?**
  _High betweenness centrality (0.002) - this node is a cross-community bridge._
- **What connects `BASE_BRANCHES`, `MERGE_CONFIG`, `TRUSTED_ASSOCIATIONS` to the rest of the system?**
  _141 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `deploy-develop-pr-preview.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.06332842415316642 - nodes in this community are weakly interconnected._
- **Should `run_contract Shell Function` be split into smaller, more focused modules?**
  _Cohesion score 0.14126984126984127 - nodes in this community are weakly interconnected._
- **Should `build-all-branch.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.10344827586206896 - nodes in this community are weakly interconnected._
- **Should `failureDetail` be split into smaller, more focused modules?**
  _Cohesion score 0.10837438423645321 - nodes in this community are weakly interconnected._