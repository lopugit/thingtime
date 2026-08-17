# Graph Report - .  (2026-08-17)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 472 nodes · 1067 edges · 20 communities (19 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 18 edges (avg confidence: 0.59)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3e1c2452`
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
7. `repoFlag()` - 15 edges
8. `runSelfTest()` - 14 edges
9. `validateReusablePromotionBranch()` - 14 edges
10. `main()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `README — github-actions CI control plane` --references--> `vercel.json Git-deployment kill-switch`  [EXTRACTED]
  README.md → vercel.json
- `AI_ALL.md — canonical Thingtime AI instructions` --references--> `Control-plane changelog`  [INFERRED]
  AI_ALL.md → CHANGELOG.md
- `Deterministic delete-shaped conflict settlement` --conceptually_related_to--> `AI rebase conflict round composite action`  [INFERRED]
  CHANGELOG.md → .github/actions/rebase-conflict-round/action.yml
- `Electron release — build and publish job` --conceptually_related_to--> `Thin listener pattern (product branches call control plane by ref)`  [AMBIGUOUS]
  .github/workflows/electron-release.yml → README.md
- `AGENTS.md — symlink to AI_ALL.md` --references--> `AI_ALL.md — canonical Thingtime AI instructions`  [EXTRACTED]
  AGENTS.md → AI_ALL.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Deterministic contract advisory suite run by control-plane CI** — github_workflows_control_plane_ci_contract_advisories, github_scripts_workflow_control_plane_contract, github_scripts_resolve_pr_conflicts_routing_contract, github_scripts_rebase_ownership_routing_contract, github_scripts_promotion_worker_routing_contract, github_scripts_promotion_worker_contract, github_scripts_promotion_pr_changelog, github_scripts_promote_features_to_main, github_scripts_deploy_develop_pr_preview [EXTRACTED 0.90]
- **Develop → main promotion flow across router, workflow, scripts and conflict rounds** — github_workflows_promote_develop_to_main_route, github_workflows_ci_provider_router_route, github_workflows_promote_develop_to_main_promotion_pr, github_scripts_promotion_pr_changelog, github_scripts_promote_features_to_main, github_actions_rebase_conflict_round_action [INFERRED 0.80]
- **develop ↔ main branch automation flow** — github_workflows_promote_features_to_main, github_workflows_promote_develop_to_main, github_workflows_sync_main_into_develop, github_workflows_resolve_pr_conflicts, github_workflows_rebase_pr_stacks [EXTRACTED 0.90]
- **Disjoint merge-vs-rebase AI conflict ownership** — github_workflows_resolve_pr_conflicts, github_workflows_rebase_pr_stacks, github_workflows_rebase_pr_stacks_no_ai_rebase, github_workflows_resolve_pr_conflicts_no_ai_merge, github_workflows_rebase_pr_stacks_rebase_owner_jq [EXTRACTED 0.85]
- **Web CI required-context scoping** — github_workflows_web_ci_scope, github_workflows_web_ci_build, github_workflows_web_ci_api_tests, github_workflows_web_ci_required_build_context, github_workflows_web_ci_required_api_context, remix_scripts_web_ci_required_context_contract [EXTRACTED 0.90]
- **Detect → handoff → resolve control-plane pipeline** — github_workflows_resolve_pr_conflicts_detect, github_workflows_resolve_pr_conflicts_handoff, github_workflows_resolve_pr_conflicts_resolve, github_workflows_resolve_pr_conflicts_control_plane_identity [EXTRACTED 0.90]
- **Untrusted-AI containment controls** — github_workflows_resolve_pr_conflicts_security_model, github_workflows_resolve_pr_conflicts_scope_invariant, github_workflows_resolve_pr_conflicts_lockfile_regen, github_workflows_resolve_pr_conflicts_graphify_refresh [EXTRACTED 0.85]
- **Canonical AI instruction file plus its two symlink aliases** — ai_all_thingtime_ai_instructions, agents_thingtime_ai_instructions, claude_thingtime_ai_instructions [EXTRACTED 0.95]

## Communities (20 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (77): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertVercelConfiguration(), assignAliasVerified(), boundedInteger() (+69 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (47): AGENTS.md — symlink to AI_ALL.md, Graphify knowledge-graph usage rules, AI_ALL.md — canonical Thingtime AI instructions, claude-code-action@v1, CLAUDE.md graphify pair rules, CLAUDE.md — symlink to AI_ALL.md, CI provider router workflow, make_routing_proof (HMAC routing proof) (+39 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (35): Control-plane changelog, Deterministic delete-shaped conflict settlement, Lane-aware trusted promotion validator, acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, ALLOWED_MODELS, appReentryDisposition() (+27 more)

### Community 3 - "Community 3"
Cohesion: 0.14
Nodes (35): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+27 more)

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (34): botCommentsByLatestEvent(), buildPromotionDispatchRequest(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), dispatchPromotionResolution(), exactReservationDeleteArgs(), exactReservationPushArgs() (+26 more)

### Community 5 - "Community 5"
Cohesion: 0.13
Nodes (32): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), createPromotionReviewCheckpoint(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers() (+24 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (28): action, aiBlock, checkpointPending, checkpointPush, cleanWorkerDispatch, commitGuard, commitsApi, contentPush (+20 more)

### Community 7 - "Community 7"
Cohesion: 0.12
Nodes (23): CFG, cleanReplayQuarantinePolicy(), env(), EXEC_OPTS, flag(), gh(), ghJson(), git() (+15 more)

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
Cohesion: 0.22
Nodes (15): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), decodeBatch(), encodeBatch(), positiveDecimal() (+7 more)

### Community 12 - "Community 12"
Cohesion: 0.25
Nodes (14): AI rebase conflict round composite action, assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_rebase_state(), rebase_in_progress() (+6 more)

### Community 13 - "Community 13"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

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
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

## Ambiguous Edges - Review These
- `Electron release — build and publish job` → `Thin listener pattern (product branches call control plane by ref)`  [AMBIGUOUS]
  .github/workflows/electron-release.yml · relation: conceptually_related_to

## Knowledge Gaps
- **108 isolated node(s):** `TRUSTED_ASSOCIATIONS`, `TRUSTED_PERMISSIONS`, `PR_EVENT_ACTIONS`, `ACTIVE_STATES`, `TERMINAL_FAILURE_STATES` (+103 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Electron release — build and publish job` and `Thin listener pattern (product branches call control plane by ref)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Control-plane CI — contract advisories job` connect `Community 6` to `Community 0`, `Community 2`, `Community 3`, `Community 7`, `Community 9`, `Community 11`?**
  _High betweenness centrality (0.413) - this node is a cross-community bridge._
- **Why does `TESTING.md — per-area manual checklists` connect `Community 1` to `Community 0`, `Community 7`?**
  _High betweenness centrality (0.124) - this node is a cross-community bridge._
- **Why does `Resolve PR conflicts (AI) workflow` connect `Community 1` to `Community 2`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **What connects `TRUSTED_ASSOCIATIONS`, `TRUSTED_PERMISSIONS`, `PR_EVENT_ACTIONS` to the rest of the system?**
  _109 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07436708860759493 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05365402405180388 - nodes in this community are weakly interconnected._