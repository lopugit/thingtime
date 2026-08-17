# Graph Report - .  (2026-08-17)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 439 nodes · 1027 edges · 20 communities (19 shown, 1 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.51)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `019f00c6`
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
- `README — github-actions CI control plane` --references--> `Workflow control-plane CI`  [EXTRACTED]
  README.md → .github/workflows/control-plane-ci.yml
- `Electron App Release workflow` --conceptually_related_to--> `develop-first PR and promotion policy`  [AMBIGUOUS]
  .github/workflows/electron-release.yml → AI_ALL.md
- `AGENTS.md (symlink to AI_ALL.md)` --references--> `AI_ALL.md — Canonical Thingtime AI instructions`  [EXTRACTED]
  AGENTS.md → AI_ALL.md
- `CLAUDE.md (symlink to AI_ALL.md)` --references--> `AI_ALL.md — Canonical Thingtime AI instructions`  [EXTRACTED]
  CLAUDE.md → AI_ALL.md
- `Control-plane changelog` --references--> `Develop S3 PR preview implementation`  [EXTRACTED]
  CHANGELOG.md → .github/workflows/develop-pr-preview.yml

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Workflows routed through the CI provider router** — github_workflows_ci_provider_router, github_workflows_promote_develop_to_main, github_workflows_promote_features_to_main, github_workflows_sync_main_into_develop, github_workflows_rebase_pr_stacks, github_workflows_resolve_pr_conflicts [EXTRACTED 0.90]
- **develop → main promotion and back-sync flow** — github_workflows_promote_features_to_main, github_workflows_promote_develop_to_main, github_workflows_sync_main_into_develop, github_scripts_promote_features_to_main, github_scripts_promotion_pr_changelog, ai_all_develop_promotion_policy [EXTRACTED 0.85]
- **Control-plane shape contracts enforced across branches** — ai_all_bare_tree_invariant, ai_all_thin_listener_contract, github_scripts_workflow_control_plane_contract, remix_scripts_workflow_caller_contract, github_workflows_control_plane_ci, github_workflows_web_ci_product_contract_advisories, vercel [EXTRACTED 0.85]

## Communities (20 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (78): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertVercelConfiguration(), assignAliasVerified(), boundedInteger() (+70 more)

### Community 1 - "Community 1"
Cohesion: 0.14
Nodes (35): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+27 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (33): AGENTS.md (symlink to AI_ALL.md), AI_ALL.md — Canonical Thingtime AI instructions, Bare-tree control-plane invariant, develop-first PR and promotion policy, Everything-is-a-thing data model, Graphify knowledge-graph workflow, Thin-listener workflow caller contract, Control-plane changelog (+25 more)

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
Cohesion: 0.12
Nodes (26): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, ALLOWED_MODELS, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertBareControlPlaneTree() (+18 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (23): action, aiBlock, checkpointPending, checkpointPush, cleanWorkerDispatch, commitGuard, commitsApi, contentPush (+15 more)

### Community 8 - "Community 8"
Cohesion: 0.13
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 9 - "Community 9"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_review_replay(), RESERVATION_SHA (+8 more)

### Community 10 - "Community 10"
Cohesion: 0.21
Nodes (17): cancelPromotionRetirement(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata(), findOpenPromotionNumber(), listRemotePromotionBranches(), processGroupsIndependently(), promotionBody() (+9 more)

### Community 11 - "Community 11"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 12 - "Community 12"
Cohesion: 0.27
Nodes (13): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_rebase_state(), rebase_in_progress(), secure_git_environment() (+5 more)

### Community 13 - "Community 13"
Cohesion: 0.24
Nodes (13): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), positiveDecimal(), REBASE_ACTION_URL, REBASE_WORKFLOW_URL (+5 more)

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

### Community 18 - "Community 18"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

## Ambiguous Edges - Review These
- `develop-first PR and promotion policy` → `Electron App Release workflow`  [AMBIGUOUS]
  .github/workflows/electron-release.yml · relation: conceptually_related_to

## Knowledge Gaps
- **99 isolated node(s):** `TRUSTED_ASSOCIATIONS`, `TRUSTED_PERMISSIONS`, `PR_EVENT_ACTIONS`, `ACTIVE_STATES`, `TERMINAL_FAILURE_STATES` (+94 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `develop-first PR and promotion policy` and `Electron App Release workflow`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `contract-advisories job` connect `Community 6` to `Community 0`, `Community 1`, `Community 5`?**
  _High betweenness centrality (0.272) - this node is a cross-community bridge._
- **Why does `README — github-actions CI control plane` connect `Community 2` to `Community 0`, `Community 6`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Why does `Promote features to main workflow` connect `Community 2` to `Community 5`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **What connects `TRUSTED_ASSOCIATIONS`, `TRUSTED_PERMISSIONS`, `PR_EVENT_ACTIONS` to the rest of the system?**
  _99 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07530864197530865 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.14126984126984127 - nodes in this community are weakly interconnected._