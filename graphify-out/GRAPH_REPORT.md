# Graph Report - .  (2026-08-21)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 503 nodes · 1131 edges · 29 communities (24 shown, 5 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 12 edges (avg confidence: 0.55)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f7dbd46f`
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
- [[_COMMUNITY_Community 28|Community 28]]

## God Nodes (most connected - your core abstractions)
1. `selfTest()` - 49 edges
2. `runPromotion()` - 35 edges
3. `failureDetail()` - 28 edges
4. `deploy()` - 26 edges
5. `main()` - 20 edges
6. `orphanedMergeHydrationIntegrationTest()` - 19 edges
7. `runSelfTest()` - 18 edges
8. `repoFlag()` - 15 edges
9. `buildMode()` - 14 edges
10. `validateReusablePromotionBranch()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Graphify Rules` --semantically_similar_to--> `Graphify Rules`  [EXTRACTED] [semantically similar]
  CLAUDE.md → AI_ALL.md
- `Web CI Workflow` --references--> `Testing Checklist`  [INFERRED]
  .github/workflows/web-ci.yml → TESTING.md
- `Thingtime AI Instructions` --references--> `Thingtime AI Instructions`  [EXTRACTED]
  CLAUDE.md → AI_ALL.md
- `AI Rebase Conflict Round` --references--> `Prepare Round Script`  [EXTRACTED]
  .github/actions/rebase-conflict-round/action.yml → .github/scripts/rebase-stack/prepare-round.sh
- `Build All Branch Workflow` --references--> `Build All Branch Script`  [EXTRACTED]
  .github/workflows/all-branch.yml → .github/scripts/build-all-branch.mjs

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Provider Routed CI Workflows** — _github_workflows_ci_provider_router_route_ci_compute_provider, _github_workflows_promote_develop_to_main_promote_develop_to_main, _github_workflows_promote_features_to_main_promote_features_to_main, _github_workflows_rebase_pr_stacks_rebase_prs_and_stacks, _github_workflows_resolve_pr_conflicts_resolve_pr_conflicts, _github_workflows_sync_main_into_develop_sync_main_into_develop [EXTRACTED 0.90]
- **Control Plane Branch Contract** — readme_ci_control_plane, changelog_control_plane_changelog, _github_workflows_control_plane_ci_workflow_control_plane_ci, _github_scripts_workflow_control_plane_contract_mjs [EXTRACTED 0.88]
- **Detect → handoff → resolve → verify → graphify refresh pipeline** — github_workflows_resolve_pr_conflicts_detect, github_workflows_resolve_pr_conflicts_handoff, github_workflows_resolve_pr_conflicts_resolve, github_workflows_resolve_pr_conflicts_verify, github_workflows_resolve_pr_conflicts_graphify_refresh [EXTRACTED 0.90]
- **Controls enforcing the untrusted-AI containment boundary** — github_workflows_resolve_pr_conflicts_untrusted_ai_model, github_workflows_resolve_pr_conflicts_verify, github_workflows_resolve_pr_conflicts_secret_scan, github_workflows_resolve_pr_conflicts_lockfile_regen, github_workflows_resolve_pr_conflicts_caller_contract_concept [EXTRACTED 0.85]
- **Trigger and PR-selection surface (push, schedule, dispatch, labels, cascade)** — github_workflows_resolve_pr_conflicts_schedule_sweep, github_workflows_resolve_pr_conflicts_no_ai_merge_label, github_workflows_resolve_pr_conflicts_ai_merge_paused_label, github_workflows_resolve_pr_conflicts_stacked_cascade, github_workflows_resolve_pr_conflicts_control_plane_ref [INFERRED 0.75]
- **Canonical AI Instruction Files** — agents_thingtime_ai_instructions, ai_all_thingtime_ai_instructions, claude_thingtime_ai_instructions [EXTRACTED 0.95]

## Communities (29 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.07
Nodes (79): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertVercelConfiguration(), assignAliasVerified(), boundedInteger() (+71 more)

### Community 1 - "Community 1"
Cohesion: 0.14
Nodes (35): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+27 more)

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (34): botCommentsByLatestEvent(), buildPromotionDispatchRequest(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), dispatchPromotionResolution(), exactReservationDeleteArgs(), exactReservationPushArgs() (+26 more)

### Community 3 - "Community 3"
Cohesion: 0.19
Nodes (31): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode(), git() (+23 more)

### Community 4 - "Community 4"
Cohesion: 0.13
Nodes (32): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), createPromotionReviewCheckpoint(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers() (+24 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (23): CFG, cleanReplayQuarantinePolicy(), env(), EXEC_OPTS, flag(), gh(), ghJson(), git() (+15 more)

### Community 6 - "Community 6"
Cohesion: 0.10
Nodes (24): CLAUDE.md / AI_ALL.md instructions, pr-conflict-resolver.yml (superseded), ai-merge-paused hold label, ANTHROPIC_API_KEY secret, Control-plane caller contract (thin listeners), claude-code-action@v1, CLAUDE_CODE_OAUTH_TOKEN secret, CONFLICT_RESOLVER_PAT secret (+16 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (23): action, aiBlock, checkpointPending, checkpointPush, cleanWorkerDispatch, commitGuard, commitsApi, contentPush (+15 more)

### Community 8 - "Community 8"
Cohesion: 0.13
Nodes (24): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, ALLOWED_MODELS, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertBareControlPlaneTree() (+16 more)

### Community 9 - "Community 9"
Cohesion: 0.13
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 10 - "Community 10"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_review_replay(), RESERVATION_SHA (+8 more)

### Community 11 - "Community 11"
Cohesion: 0.21
Nodes (17): cancelPromotionRetirement(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata(), findOpenPromotionNumber(), listRemotePromotionBranches(), processGroupsIndependently(), promotionBody() (+9 more)

### Community 12 - "Community 12"
Cohesion: 0.22
Nodes (15): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), decodeBatch(), encodeBatch(), positiveDecimal() (+7 more)

### Community 13 - "Community 13"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 14 - "Community 14"
Cohesion: 0.15
Nodes (14): AI Rebase Conflict Round, Build All Branch Script, Promote Features To Main Script, Promotion PR Changelog Script, Prepare Round Script, Build All Branch Workflow, Route CI Compute Provider Workflow, Workflow Control-plane CI (+6 more)

### Community 15 - "Community 15"
Cohesion: 0.27
Nodes (13): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_rebase_state(), rebase_in_progress(), secure_git_environment() (+5 more)

### Community 16 - "Community 16"
Cohesion: 0.17
Nodes (11): Thingtime AI Instructions, Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify (+3 more)

### Community 17 - "Community 17"
Cohesion: 0.27
Nodes (10): attestationMatches(), checkpointRecoveryDisposition(), encodePromotionAttestation(), exactCheckpointPush(), isObjectId(), liveRefShaWithActionsToken(), promotionAttestationBody(), promotionResolverRunDisposition() (+2 more)

### Community 18 - "Community 18"
Cohesion: 0.44
Nodes (10): closeRedundantPass(), createPromotionPr(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), queueTrustedPromotionWorker(), repoFlag(), retargetPass(), tryGh() (+2 more)

### Community 19 - "Community 19"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 20 - "Community 20"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 21 - "Community 21"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 22 - "Community 22"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 23 - "Community 23"
Cohesion: 0.67
Nodes (3): Thingtime AI Instructions, Thingtime AI Instructions, Fundamentals

## Knowledge Gaps
- **127 isolated node(s):** `BASE_BRANCHES`, `MERGE_CONFIG`, `CFG`, `EXEC_OPTS`, `STRIP_PREFIXES` (+122 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `selfTest()` connect `Community 2` to `Community 17`, `Community 11`, `Community 4`, `Community 5`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **Why does `runPromotion()` connect `Community 11` to `Community 2`, `Community 4`, `Community 5`, `Community 17`, `Community 18`?**
  _High betweenness centrality (0.002) - this node is a cross-community bridge._
- **What connects `BASE_BRANCHES`, `MERGE_CONFIG`, `CFG` to the rest of the system?**
  _127 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07437518819632641 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.14126984126984127 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.12701612903225806 - nodes in this community are weakly interconnected._