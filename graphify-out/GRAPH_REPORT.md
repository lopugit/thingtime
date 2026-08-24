# Graph Report - fix-preview-wildcard-develop  (2026-08-24)

## Corpus Check
- 20 files · ~118,362 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 502 nodes · 1158 edges · 32 communities (23 shown, 9 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.54)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9b1d5332`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_deploy-develop-pr-preview.mjs|deploy-develop-pr-preview.mjs]]
- [[_COMMUNITY_promotion-pr-changelog.mjs|promotion-pr-changelog.mjs]]
- [[_COMMUNITY_selfTest|selfTest]]
- [[_COMMUNITY_build-all-branch.mjs|build-all-branch.mjs]]
- [[_COMMUNITY_failureDetail|failureDetail]]
- [[_COMMUNITY_promote-features-to-main.mjs|promote-features-to-main.mjs]]
- [[_COMMUNITY_promotion-worker-routing-contract.mjs|promotion-worker-routing-contract.mjs]]
- [[_COMMUNITY_workflow-control-plane-contract.mjs|workflow-control-plane-contract.mjs]]
- [[_COMMUNITY_refresh-promotion-graphify.sh|refresh-promotion-graphify.sh]]
- [[_COMMUNITY_Route CI Compute Provider Workflow|Route CI Compute Provider Workflow]]
- [[_COMMUNITY_promotion-worker-contract.sh|promotion-worker-contract.sh]]
- [[_COMMUNITY_runPromotion|runPromotion]]
- [[_COMMUNITY_promotion-worker.sh|promotion-worker.sh]]
- [[_COMMUNITY_prepare-round.sh|prepare-round.sh]]
- [[_COMMUNITY_resolve-pr-conflicts-routing-contract.mjs|resolve-pr-conflicts-routing-contract.mjs]]
- [[_COMMUNITY_recoverPromotionReviewCheckpoint|recoverPromotionReviewCheckpoint]]
- [[_COMMUNITY_repoFlag|repoFlag]]
- [[_COMMUNITY_start.sh|start.sh]]
- [[_COMMUNITY_verify-promotion-source-authority.sh|verify-promotion-source-authority.sh]]
- [[_COMMUNITY_vercel.json|vercel.json]]
- [[_COMMUNITY_Thingtime AI instructions|Thingtime AI instructions]]
- [[_COMMUNITY_rebase-ownership-routing-contract.sh|rebase-ownership-routing-contract.sh]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_Electron App Release Workflow|Electron App Release Workflow]]
- [[_COMMUNITY_`github-actions` — the CI control plane|`github-actions` — the CI control plane]]
- [[_COMMUNITY_AI Rebase Conflict Round|AI Rebase Conflict Round]]
- [[_COMMUNITY_Web CI Workflow|Web CI Workflow]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_Fundamentals|Fundamentals]]

## God Nodes (most connected - your core abstractions)
1. `selfTest()` - 49 edges
2. `runPromotion()` - 35 edges
3. `failureDetail()` - 28 edges
4. `deploy()` - 26 edges
5. `runSelfTest()` - 24 edges
6. `main()` - 20 edges
7. `orphanedMergeHydrationIntegrationTest()` - 19 edges
8. `main()` - 15 edges
9. `repoFlag()` - 15 edges
10. `githubRequest()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Web CI Workflow` --references--> `Testing Checklist`  [INFERRED]
  .github/workflows/web-ci.yml → TESTING.md
- `AI Rebase Conflict Round` --references--> `Prepare Round Script`  [EXTRACTED]
  .github/actions/rebase-conflict-round/action.yml → .github/scripts/rebase-stack/prepare-round.sh
- `Build All Branch Workflow` --references--> `Build All Branch Script`  [EXTRACTED]
  .github/workflows/all-branch.yml → .github/scripts/build-all-branch.mjs
- `Workflow Control-plane CI` --references--> `Build All Branch Script`  [EXTRACTED]
  .github/workflows/control-plane-ci.yml → .github/scripts/build-all-branch.mjs
- `Promote Develop To Main Workflow` --references--> `Promotion PR Changelog Script`  [EXTRACTED]
  .github/workflows/promote-develop-to-main.yml → .github/scripts/promotion-pr-changelog.mjs

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Canonical AI Instruction Files** — agents_thingtime_ai_instructions, ai_all_thingtime_ai_instructions, claude_thingtime_ai_instructions [EXTRACTED 0.95]
- **Provider Routed CI Workflows** — _github_workflows_ci_provider_router_route_ci_compute_provider, _github_workflows_promote_develop_to_main_promote_develop_to_main, _github_workflows_promote_features_to_main_promote_features_to_main, _github_workflows_rebase_pr_stacks_rebase_prs_and_stacks, _github_workflows_resolve_pr_conflicts_resolve_pr_conflicts, _github_workflows_sync_main_into_develop_sync_main_into_develop [EXTRACTED 0.90]
- **Control Plane Branch Contract** — readme_ci_control_plane, changelog_control_plane_changelog, _github_workflows_control_plane_ci_workflow_control_plane_ci, _github_scripts_workflow_control_plane_contract_mjs [EXTRACTED 0.88]

## Communities (32 total, 9 thin omitted)

### Community 0 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.06
Nodes (95): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), assertVercelConfiguration(), assertWildcardFallbackRuntimes() (+87 more)

### Community 1 - "promotion-pr-changelog.mjs"
Cohesion: 0.14
Nodes (35): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+27 more)

### Community 2 - "selfTest"
Cohesion: 0.09
Nodes (34): botCommentsByLatestEvent(), buildPromotionDispatchRequest(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), dispatchPromotionResolution(), exactReservationDeleteArgs(), exactReservationPushArgs() (+26 more)

### Community 3 - "build-all-branch.mjs"
Cohesion: 0.19
Nodes (31): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode(), git() (+23 more)

### Community 4 - "failureDetail"
Cohesion: 0.13
Nodes (32): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), createPromotionReviewCheckpoint(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers() (+24 more)

### Community 5 - "promote-features-to-main.mjs"
Cohesion: 0.12
Nodes (23): CFG, cleanReplayQuarantinePolicy(), env(), EXEC_OPTS, flag(), gh(), ghJson(), git() (+15 more)

### Community 6 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.08
Nodes (23): action, aiBlock, checkpointPending, checkpointPush, cleanWorkerDispatch, commitGuard, commitsApi, contentPush (+15 more)

### Community 7 - "workflow-control-plane-contract.mjs"
Cohesion: 0.13
Nodes (25): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, ALLOWED_MODELS, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertBareControlPlaneTree() (+17 more)

### Community 8 - "refresh-promotion-graphify.sh"
Cohesion: 0.13
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 9 - "Route CI Compute Provider Workflow"
Cohesion: 0.22
Nodes (9): Build All Branch Script, Promote Features To Main Script, Promotion PR Changelog Script, Build All Branch Workflow, Route CI Compute Provider Workflow, Workflow Control-plane CI, Promote Develop To Main Workflow, Promote Features To Main Workflow (+1 more)

### Community 10 - "promotion-worker-contract.sh"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_review_replay(), RESERVATION_SHA (+8 more)

### Community 11 - "runPromotion"
Cohesion: 0.21
Nodes (17): cancelPromotionRetirement(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata(), findOpenPromotionNumber(), listRemotePromotionBranches(), processGroupsIndependently(), promotionBody() (+9 more)

### Community 12 - "promotion-worker.sh"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 13 - "prepare-round.sh"
Cohesion: 0.27
Nodes (13): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_rebase_state(), rebase_in_progress(), secure_git_environment() (+5 more)

### Community 14 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.24
Nodes (13): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), positiveDecimal(), REBASE_ACTION_URL, REBASE_WORKFLOW_URL (+5 more)

### Community 15 - "recoverPromotionReviewCheckpoint"
Cohesion: 0.27
Nodes (10): attestationMatches(), checkpointRecoveryDisposition(), encodePromotionAttestation(), exactCheckpointPush(), isObjectId(), liveRefShaWithActionsToken(), promotionAttestationBody(), promotionResolverRunDisposition() (+2 more)

### Community 16 - "repoFlag"
Cohesion: 0.44
Nodes (10): closeRedundantPass(), createPromotionPr(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), queueTrustedPromotionWorker(), repoFlag(), retargetPass(), tryGh() (+2 more)

### Community 17 - "start.sh"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 18 - "verify-promotion-source-authority.sh"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 19 - "vercel.json"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 20 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 21 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 24 - "`github-actions` — the CI control plane"
Cohesion: 0.15
Nodes (11): Added, Control-plane changelog, Fixed, [Unreleased], Fork setup: Vercel develop previews, `github-actions` — the CI control plane, Known trade-off, Stable develop domain (+3 more)

## Knowledge Gaps
- **122 isolated node(s):** `TRUSTED_ASSOCIATIONS`, `TRUSTED_PERMISSIONS`, `PR_EVENT_ACTIONS`, `ACTIVE_STATES`, `TERMINAL_FAILURE_STATES` (+117 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `selfTest()` connect `selfTest` to `runPromotion`, `failureDetail`, `promote-features-to-main.mjs`, `recoverPromotionReviewCheckpoint`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **Why does `runPromotion()` connect `runPromotion` to `selfTest`, `failureDetail`, `promote-features-to-main.mjs`, `recoverPromotionReviewCheckpoint`, `repoFlag`?**
  _High betweenness centrality (0.002) - this node is a cross-community bridge._
- **Why does `failureDetail()` connect `failureDetail` to `selfTest`, `promote-features-to-main.mjs`, `runPromotion`, `recoverPromotionReviewCheckpoint`, `repoFlag`?**
  _High betweenness centrality (0.001) - this node is a cross-community bridge._
- **What connects `TRUSTED_ASSOCIATIONS`, `TRUSTED_PERMISSIONS`, `PR_EVENT_ACTIONS` to the rest of the system?**
  _122 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `deploy-develop-pr-preview.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.06332842415316642 - nodes in this community are weakly interconnected._
- **Should `promotion-pr-changelog.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.14126984126984127 - nodes in this community are weakly interconnected._
- **Should `selfTest` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._