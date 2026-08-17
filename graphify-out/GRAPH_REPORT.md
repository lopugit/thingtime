# Graph Report - .  (2026-08-17)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 444 nodes · 1042 edges · 18 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.58)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ae1e862c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]

## God Nodes (most connected - your core abstractions)
1. `selfTest()` - 49 edges
2. `runPromotion()` - 35 edges
3. `failureDetail()` - 28 edges
4. `deploy()` - 26 edges
5. `main()` - 20 edges
6. `orphanedMergeHydrationIntegrationTest()` - 19 edges
7. `runSelfTest()` - 17 edges
8. `repoFlag()` - 15 edges
9. `main()` - 14 edges
10. `validateReusablePromotionBranch()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `README — github-actions CI control plane` --references--> `workflow-caller-contract.mjs (thin-listener contract)`  [EXTRACTED]
  README.md → remix/scripts/workflow-caller-contract.mjs
- `Electron App Release workflow` --conceptually_related_to--> `Thin-listener control-plane pattern`  [AMBIGUOUS]
  .github/workflows/electron-release.yml → README.md
- `workflow-caller-contract.mjs (thin-listener contract)` --implements--> `Thin-listener control-plane pattern`  [EXTRACTED]
  remix/scripts/workflow-caller-contract.mjs → README.md
- `Resolve PR conflicts (AI)` --references--> `workflow-caller-contract.mjs (thin-listener contract)`  [EXTRACTED]
  .github/workflows/resolve-pr-conflicts.yml → remix/scripts/workflow-caller-contract.mjs
- `Web CI workflow` --calls--> `workflow-caller-contract.mjs (thin-listener contract)`  [EXTRACTED]
  .github/workflows/web-ci.yml → remix/scripts/workflow-caller-contract.mjs

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Workflows routed through the CI provider router** — github_workflows_ci_provider_router, github_workflows_promote_develop_to_main, github_workflows_promote_features_to_main, github_workflows_rebase_pr_stacks, github_workflows_sync_main_into_develop, github_workflows_resolve_pr_conflicts [EXTRACTED 0.90]
- **Deterministic contract advisory suite** — github_workflows_control_plane_ci_contract_advisories, github_scripts_workflow_control_plane_contract, github_scripts_resolve_pr_conflicts_routing_contract, github_scripts_rebase_ownership_routing_contract, github_scripts_promotion_worker_routing_contract, github_scripts_promotion_worker_contract, github_scripts_promote_features_to_main, github_scripts_promotion_pr_changelog, github_scripts_deploy_develop_pr_preview [EXTRACTED 0.90]
- **AI conflict/rebase resolution flow** — github_workflows_rebase_pr_stacks, github_actions_rebase_conflict_round_action, github_scripts_prepare_round, github_workflows_resolve_pr_conflicts, ai_all_graphify [INFERRED 0.80]

## Communities (18 total, 0 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (78): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertVercelConfiguration(), assignAliasVerified(), boundedInteger() (+70 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (38): AGENTS.md (symlink to AI_ALL.md), AI_ALL.md — canonical AI instructions, Three-place API endpoint registration rule, Everything-is-a-thing data model, FUNDAMENTALS non-negotiables reference, graphify knowledge-graph workflow, Worktree dev-port derivation rule, Control-plane changelog (+30 more)

### Community 2 - "Community 2"
Cohesion: 0.14
Nodes (35): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+27 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (34): botCommentsByLatestEvent(), buildPromotionDispatchRequest(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), dispatchPromotionResolution(), exactReservationDeleteArgs(), exactReservationPushArgs() (+26 more)

### Community 4 - "Community 4"
Cohesion: 0.13
Nodes (32): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), createPromotionReviewCheckpoint(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers() (+24 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (23): CFG, cleanReplayQuarantinePolicy(), env(), EXEC_OPTS, flag(), gh(), ghJson(), git() (+15 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (23): action, aiBlock, checkpointPending, checkpointPush, cleanWorkerDispatch, commitGuard, commitsApi, contentPush (+15 more)

### Community 7 - "Community 7"
Cohesion: 0.13
Nodes (24): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, ALLOWED_MODELS, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertBareControlPlaneTree() (+16 more)

### Community 8 - "Community 8"
Cohesion: 0.13
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 9 - "Community 9"
Cohesion: 0.10
Nodes (20): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_review_replay(), RESERVATION_SHA (+12 more)

### Community 10 - "Community 10"
Cohesion: 0.21
Nodes (17): cancelPromotionRetirement(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata(), findOpenPromotionNumber(), listRemotePromotionBranches(), processGroupsIndependently(), promotionBody() (+9 more)

### Community 11 - "Community 11"
Cohesion: 0.22
Nodes (15): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), decodeBatch(), encodeBatch(), positiveDecimal() (+7 more)

### Community 12 - "Community 12"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 13 - "Community 13"
Cohesion: 0.27
Nodes (13): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_rebase_state(), rebase_in_progress(), secure_git_environment() (+5 more)

### Community 14 - "Community 14"
Cohesion: 0.27
Nodes (10): attestationMatches(), checkpointRecoveryDisposition(), encodePromotionAttestation(), exactCheckpointPush(), isObjectId(), liveRefShaWithActionsToken(), promotionAttestationBody(), promotionResolverRunDisposition() (+2 more)

### Community 15 - "Community 15"
Cohesion: 0.44
Nodes (10): closeRedundantPass(), createPromotionPr(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), queueTrustedPromotionWorker(), repoFlag(), retargetPass(), tryGh() (+2 more)

### Community 16 - "Community 16"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 17 - "Community 17"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

## Ambiguous Edges - Review These
- `Thin-listener control-plane pattern` → `Electron App Release workflow`  [AMBIGUOUS]
  .github/workflows/electron-release.yml · relation: conceptually_related_to

## Knowledge Gaps
- **97 isolated node(s):** `TRUSTED_ASSOCIATIONS`, `TRUSTED_PERMISSIONS`, `PR_EVENT_ACTIONS`, `ACTIVE_STATES`, `TERMINAL_FAILURE_STATES` (+92 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Thin-listener control-plane pattern` and `Electron App Release workflow`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `contract-advisories job` connect `Community 9` to `Community 0`, `Community 1`, `Community 2`, `Community 5`, `Community 6`, `Community 7`, `Community 11`?**
  _High betweenness centrality (0.484) - this node is a cross-community bridge._
- **Why does `README — github-actions CI control plane` connect `Community 1` to `Community 0`, `Community 7`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **Why does `Promote features to main workflow` connect `Community 1` to `Community 5`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **What connects `TRUSTED_ASSOCIATIONS`, `TRUSTED_PERMISSIONS`, `PR_EVENT_ACTIONS` to the rest of the system?**
  _97 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07530864197530865 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06923076923076923 - nodes in this community are weakly interconnected._