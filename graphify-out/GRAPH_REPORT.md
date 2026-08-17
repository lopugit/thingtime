# Graph Report - .  (2026-08-17)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 465 nodes · 1049 edges · 26 communities (25 shown, 1 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 21 edges (avg confidence: 0.66)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `29d0a040`
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
- `Control-plane changelog` --references--> `AI rebase conflict round composite action`  [INFERRED]
  CHANGELOG.md → .github/actions/rebase-conflict-round/action.yml
- `Control-plane changelog` --references--> `Promote features to main workflow`  [INFERRED]
  CHANGELOG.md → .github/workflows/promote-features-to-main.yml
- `Control-plane changelog` --references--> `Resolve PR conflicts (AI) workflow`  [INFERRED]
  CHANGELOG.md → .github/workflows/resolve-pr-conflicts.yml
- `api-tests — headless /tests runner against a real stack` --conceptually_related_to--> `Three-place /api/v1 endpoint registration`  [INFERRED]
  .github/workflows/web-ci.yml → AI_ALL.md
- `AGENTS.md (symlink to AI_ALL.md)` --references--> `AI_ALL.md — canonical AI instructions`  [EXTRACTED]
  AGENTS.md → AI_ALL.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Workflows routed through the CI provider router** — _github_workflows_ci_provider_router, _github_workflows_rebase_pr_stacks, _github_workflows_promote_develop_to_main, _github_workflows_promote_features_to_main, _github_workflows_sync_main_into_develop, _github_workflows_resolve_pr_conflicts [EXTRACTED 0.90]
- **develop → main promotion and back-merge flow** — _github_workflows_promote_features_to_main, _github_workflows_promote_develop_to_main, _github_workflows_sync_main_into_develop, _github_scripts_promote_features_to_main, _github_scripts_promotion_pr_changelog, ai_all_pr_targeting [EXTRACTED 0.85]
- **Deterministic contract self-tests guarding the control plane** — _github_workflows_control_plane_ci_contract_advisories, _github_scripts_workflow_control_plane_contract, _github_scripts_resolve_pr_conflicts_routing_contract, _github_scripts_rebase_ownership_routing_contract, _github_scripts_promotion_worker_routing_contract, _github_scripts_promotion_worker_contract, remix_scripts_workflow_caller_contract, readme_bare_tree_invariant [EXTRACTED 0.85]

## Communities (26 total, 1 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (75): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertVercelConfiguration(), assignAliasVerified(), boundedInteger() (+67 more)

### Community 1 - "Community 1"
Cohesion: 0.14
Nodes (35): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+27 more)

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (34): botCommentsByLatestEvent(), buildPromotionDispatchRequest(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), dispatchPromotionResolution(), exactReservationDeleteArgs(), exactReservationPushArgs() (+26 more)

### Community 3 - "Community 3"
Cohesion: 0.13
Nodes (32): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), createPromotionReviewCheckpoint(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers() (+24 more)

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (23): CFG, cleanReplayQuarantinePolicy(), env(), EXEC_OPTS, flag(), gh(), ghJson(), git() (+15 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (23): action, aiBlock, checkpointPending, checkpointPush, cleanWorkerDispatch, commitGuard, commitsApi, contentPush (+15 more)

### Community 6 - "Community 6"
Cohesion: 0.13
Nodes (24): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, ALLOWED_MODELS, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertBareControlPlaneTree() (+16 more)

### Community 7 - "Community 7"
Cohesion: 0.13
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_review_replay(), RESERVATION_SHA (+8 more)

### Community 9 - "Community 9"
Cohesion: 0.21
Nodes (17): cancelPromotionRetirement(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata(), findOpenPromotionNumber(), listRemotePromotionBranches(), processGroupsIndependently(), promotionBody() (+9 more)

### Community 10 - "Community 10"
Cohesion: 0.22
Nodes (15): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), decodeBatch(), encodeBatch(), positiveDecimal() (+7 more)

### Community 11 - "Community 11"
Cohesion: 0.15
Nodes (15): promote-features-to-main.mjs, promotion-worker-contract.sh, promotion-worker-routing-contract.mjs, rebase-ownership-routing-contract.sh, resolve-pr-conflicts-routing-contract.mjs, Workflow control-plane CI, comment-contract-advisories — upsert advisory PR comment, contract-advisories — non-blocking contract self-tests (+7 more)

### Community 12 - "Community 12"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 13 - "Community 13"
Cohesion: 0.27
Nodes (13): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_rebase_state(), rebase_in_progress(), secure_git_environment() (+5 more)

### Community 14 - "Community 14"
Cohesion: 0.21
Nodes (11): workflow-control-plane-contract.mjs, Control-plane changelog, README — the github-actions CI control plane, Bare-tree invariant of the control plane, Thin listener workflow pattern, workflow-caller-contract.mjs (thin-listener topology), framework, git (+3 more)

### Community 15 - "Community 15"
Cohesion: 0.27
Nodes (10): promotion-pr-changelog.mjs, Route CI compute provider workflow, route — select GitHub or Vercel compute, HMAC routing proof (make_routing_proof / proof_is_fresh), Promote develop to main workflow, promotion-pr — open or refresh the promotion PR, Promote features to main workflow, lanes — fan out the CI promotion lanes (+2 more)

### Community 16 - "Community 16"
Cohesion: 0.27
Nodes (10): attestationMatches(), checkpointRecoveryDisposition(), encodePromotionAttestation(), exactCheckpointPush(), isObjectId(), liveRefShaWithActionsToken(), promotionAttestationBody(), promotionResolverRunDisposition() (+2 more)

### Community 17 - "Community 17"
Cohesion: 0.44
Nodes (10): closeRedundantPass(), createPromotionPr(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), queueTrustedPromotionWorker(), repoFlag(), retargetPass(), tryGh() (+2 more)

### Community 18 - "Community 18"
Cohesion: 0.29
Nodes (8): AGENTS.md (symlink to AI_ALL.md), AI_ALL.md — canonical AI instructions, Three-place /api/v1 endpoint registration, Versioned MongoDB collections and everything-is-a-thing, Fundamentals reference (FUNDAMENTALS.md), PRs target develop, never main, Worktree dev port derivation (worktree-ports.cjs), CLAUDE.md (symlink to AI_ALL.md)

### Community 19 - "Community 19"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 20 - "Community 20"
Cohesion: 0.29
Nodes (7): Web CI workflow, api-tests — headless /tests runner against a real stack, build — client build, typecheck ratchet, unit tests, product-contract-advisories — non-blocking product contracts, required-build-context / required-api-context companions, scope — classify Web CI scope, web-ci-required-context-contract.mjs

### Community 21 - "Community 21"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 22 - "Community 22"
Cohesion: 0.47
Nodes (6): AI rebase conflict round composite action, bootstrap — copy trusted round code outside model workspace, claude — resolve conflict set in scratch, prepare — validate conflicts, create repo-less scratch, verify — validate bytes back and continue the rebase, prepare-round.sh

### Community 23 - "Community 23"
Cohesion: 0.50
Nodes (5): deploy-develop-pr-preview.mjs, Develop S3 PR preview implementation, controller — publish or reconcile develop S3 preview, dispatch — trusted default-branch controller dispatch, Fork setup: Vercel develop previews

### Community 24 - "Community 24"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

## Knowledge Gaps
- **105 isolated node(s):** `TRUSTED_ASSOCIATIONS`, `TRUSTED_PERMISSIONS`, `PR_EVENT_ACTIONS`, `ACTIVE_STATES`, `TERMINAL_FAILURE_STATES` (+100 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `README — the github-actions CI control plane` connect `Community 14` to `Community 18`, `Community 11`, `Community 23`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Why does `AI_ALL.md — canonical AI instructions` connect `Community 18` to `Community 11`, `Community 14`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Why does `selfTest()` connect `Community 2` to `Community 16`, `Community 9`, `Community 3`, `Community 4`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **What connects `TRUSTED_ASSOCIATIONS`, `TRUSTED_PERMISSIONS`, `PR_EVENT_ACTIONS` to the rest of the system?**
  _105 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07758907758907758 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.14126984126984127 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._