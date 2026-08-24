# Graph Report - .  (2026-08-24)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 488 nodes · 1155 edges · 28 communities (22 shown, 6 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.56)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `75d788b4`
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
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]

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
- `github-actions CI control plane README` --references--> `vercel.json Git-deployment kill-switch`  [EXTRACTED]
  README.md → vercel.json
- `Lopu PR manager workflow` --implements--> `Lopu whole-PR repository review`  [INFERRED]
  .github/workflows/resolve-pr-conflicts.yml → CHANGELOG.md
- `Commander App Release workflow` --calls--> `Commander build_and_run.sh`  [EXTRACTED]
  .github/workflows/commander-release.yml → Commander/script/build_and_run.sh
- `Commander App Release workflow` --calls--> `Commander release-version.mjs`  [EXTRACTED]
  .github/workflows/commander-release.yml → Commander/script/release-version.mjs
- `Web CI Workflow` --references--> `Testing Checklist`  [INFERRED]
  .github/workflows/web-ci.yml → TESTING.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Provider Routed CI Workflows** — _github_workflows_ci_provider_router_route_ci_compute_provider, _github_workflows_promote_develop_to_main_promote_develop_to_main, _github_workflows_promote_features_to_main_promote_features_to_main, _github_workflows_rebase_pr_stacks_rebase_prs_and_stacks, _github_workflows_resolve_pr_conflicts_resolve_pr_conflicts, _github_workflows_sync_main_into_develop_sync_main_into_develop [EXTRACTED 0.90]
- **Lopu unified PR-management control plane** — github_workflows_resolve_pr_conflicts, github_workflows_rebase_pr_stacks, github_workflows_promote_features_to_main, github_actions_rebase_conflict_round_action, github_scripts_promote_features_to_main [EXTRACTED 0.90]
- **Bare-tree + thin-listener control-plane contract** — readme_control_plane_branch, readme_bare_tree_invariant, readme_thin_listener_contract, github_scripts_workflow_control_plane_contract, remix_scripts_workflow_caller_contract, vercel [EXTRACTED 0.90]
- **Isolated AI rebase conflict round flow** — github_actions_rebase_conflict_round_action_bootstrap, github_actions_rebase_conflict_round_action_prepare, github_actions_rebase_conflict_round_action_claude, github_actions_rebase_conflict_round_action_verify, github_scripts_rebase_stack_prepare_round [EXTRACTED 0.90]
- **Canonical AI Instruction Files** — agents_thingtime_ai_instructions, ai_all_thingtime_ai_instructions, claude_thingtime_ai_instructions [EXTRACTED 0.95]

## Communities (28 total, 6 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (96): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), assertVercelConfiguration(), assertWildcardFallbackRuntimes() (+88 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (42): anthropics/claude-code-action, ai-merge-paused durable stop label, Deterministic delete-shaped conflict settlement, Lopu whole-PR repository review, Reverse and fan-out promotion lanes, Commander build_and_run.sh, Commander release-version.mjs, AI rebase conflict round action (+34 more)

### Community 2 - "Community 2"
Cohesion: 0.14
Nodes (35): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+27 more)

### Community 3 - "Community 3"
Cohesion: 0.12
Nodes (31): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), exactBranchDeleteWithActionsToken(), expectedReservationTrailers() (+23 more)

### Community 4 - "Community 4"
Cohesion: 0.10
Nodes (30): AI_ALL.md canonical instructions, Control-plane changelog, acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, ALLOWED_MODELS, appReentryDisposition(), assertAdminLoader() (+22 more)

### Community 5 - "Community 5"
Cohesion: 0.19
Nodes (31): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode(), git() (+23 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (28): buildPromotionDispatchRequest(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), dispatchPromotionResolution(), exactReservationDeleteArgs(), exactReservationPushArgs(), externalStackPromotionState() (+20 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (23): Unverified-lineage promotion review gating, botCommentsByLatestEvent(), CFG, env(), EXEC_OPTS, findBotPromotionRetirement(), flag(), gh() (+15 more)

### Community 8 - "Community 8"
Cohesion: 0.17
Nodes (26): cancelPromotionRetirement(), closeRedundantPass(), createPromotionPr(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata(), findOpenPromotionNumber() (+18 more)

### Community 9 - "Community 9"
Cohesion: 0.13
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 10 - "Community 10"
Cohesion: 0.23
Nodes (12): attestationMatches(), checkpointRecoveryDisposition(), createPromotionReviewCheckpoint(), encodePromotionAttestation(), exactCheckpointPush(), inspectPromotionReviewCheckpoint(), isObjectId(), liveRefShaWithActionsToken() (+4 more)

### Community 11 - "Community 11"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay(), RESERVATION_SHA (+8 more)

### Community 12 - "Community 12"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 13 - "Community 13"
Cohesion: 0.24
Nodes (13): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), positiveDecimal(), REBASE_ACTION_URL, REBASE_WORKFLOW_URL (+5 more)

### Community 14 - "Community 14"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 15 - "Community 15"
Cohesion: 0.29
Nodes (6): action, graphify, promoter, rebaseWorkflow, worker, workflow

### Community 16 - "Community 16"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 17 - "Community 17"
Cohesion: 0.50
Nodes (4): Promotion PR Changelog Script, Route CI Compute Provider Workflow, Promote Develop To Main Workflow, Sync Main Into Develop Workflow

### Community 18 - "Community 18"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 19 - "Community 19"
Cohesion: 0.67
Nodes (3): Build All Branch Script, Build All Branch Workflow, Workflow Control-plane CI

### Community 20 - "Community 20"
Cohesion: 1.00
Nodes (3): Develop S3 PR preview implementation, controller: publish or reconcile preview, dispatch: trusted default-branch controller

### Community 27 - "Community 27"
Cohesion: 0.40
Nodes (6): promotionBody(), promotionConflictReviewBody(), promotionWorkerReviewBody(), sourceLineageReason(), sourceLineageReviewRequired(), sourceLineageStatus()

## Ambiguous Edges - Review These
- `Commander App Release workflow` → `Lopu PR manager workflow`  [AMBIGUOUS]
  .github/workflows/commander-release.yml · relation: semantically_similar_to

## Knowledge Gaps
- **99 isolated node(s):** `BASE_BRANCHES`, `MERGE_CONFIG`, `CFG`, `EXEC_OPTS`, `prCache` (+94 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Commander App Release workflow` and `Lopu PR manager workflow`?**
  _Edge tagged AMBIGUOUS (relation: semantically_similar_to) - confidence is low._
- **Why does `github-actions CI control plane README` connect `Community 4` to `Community 0`, `Community 1`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **What connects `BASE_BRANCHES`, `MERGE_CONFIG`, `CFG` to the rest of the system?**
  _99 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06225520511234797 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06553911205073996 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.14126984126984127 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.12258064516129032 - nodes in this community are weakly interconnected._