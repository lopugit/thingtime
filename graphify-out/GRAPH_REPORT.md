# Graph Report - .  (2026-08-17)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 551 nodes · 1118 edges · 38 communities (25 shown, 13 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 20 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `811ca755`
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
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]

## God Nodes (most connected - your core abstractions)
1. `selfTest()` - 49 edges
2. `runPromotion()` - 35 edges
3. `TESTING.md — per-area manual test checklists` - 35 edges
4. `failureDetail()` - 28 edges
5. `deploy()` - 26 edges
6. `main()` - 20 edges
7. `orphanedMergeHydrationIntegrationTest()` - 19 edges
8. `runSelfTest()` - 15 edges
9. `repoFlag()` - 15 edges
10. `validateReusablePromotionBranch()` - 14 edges

## Surprising Connections (you probably didn't know these)
- `Electron release — build and publish job` --conceptually_related_to--> `Thin listener pattern (product branches call control plane by ref)`  [AMBIGUOUS]
  .github/workflows/electron-release.yml → README.md
- `Post-merge graphify refresh step` --references--> `CLAUDE.md project instructions`  [INFERRED]
  .github/workflows/resolve-pr-conflicts.yml → CLAUDE.md
- `Web CI workflow` --shares_data_with--> `run-api-tests.mts headless API suite runner`  [INFERRED]
  .github/workflows/web-ci.yml → remix/scripts/run-api-tests.mts
- `Develop PR Preview History Filtering` --references--> `Develop S3 PR Preview Implementation`  [INFERRED]
  remix/CHANGELOG.md → .github/workflows/develop-pr-preview.yml
- `Develop PR Preview History Filtering` --references--> `Dispatch Trusted Default-Branch Controller`  [INFERRED]
  remix/CHANGELOG.md → .github/workflows/develop-pr-preview.yml

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Trusted Develop PR Preview Dispatch Flow** — github_workflows_develop_pr_preview_dispatch, github_workflows_develop_pr_preview_repository_dispatch, github_workflows_develop_pr_preview_controller, github_workflows_develop_pr_preview_deploy_script [EXTRACTED 1.00]
- **Develop Preview Vercel and Stable Domain Control** — github_workflows_develop_pr_preview_controller, remix_changelog_develop_pr_preview_history_filtering, remix_changelog_stable_develop_domain [INFERRED 0.92]
- **Protected Automation Control Plane** — github_workflows_develop_pr_preview_dispatch, github_workflows_develop_pr_preview_controller, remix_changelog_conflict_resolver_control_plane, remix_changelog_graphify_semantic_refresh [INFERRED 0.78]
- **Detect → handoff → resolve control-plane flow** — github_workflows_resolve_pr_conflicts_detect, github_workflows_resolve_pr_conflicts_handoff, github_workflows_resolve_pr_conflicts_resolve, github_workflows_resolve_pr_conflicts_control_plane [EXTRACTED 0.90]
- **Controls containing the untrusted resolution agent** — github_workflows_resolve_pr_conflicts_untrusted_ai_model, github_workflows_resolve_pr_conflicts_scope_invariant, github_workflows_resolve_pr_conflicts_secret_scan, github_workflows_resolve_pr_conflicts_lockfile_regen [EXTRACTED 0.85]
- **graphify-out reset-then-refresh merge safety ordering** — graphify_out, github_workflows_resolve_pr_conflicts_graphify_refresh, github_workflows_resolve_pr_conflicts_scope_invariant, claude [EXTRACTED 0.80]
- **Deterministic contract advisory suite run by control-plane CI** — github_workflows_control_plane_ci_contract_advisories, github_scripts_workflow_control_plane_contract, github_scripts_resolve_pr_conflicts_routing_contract, github_scripts_rebase_ownership_routing_contract, github_scripts_promotion_worker_routing_contract, github_scripts_promotion_worker_contract, github_scripts_promotion_pr_changelog, github_scripts_promote_features_to_main, github_scripts_deploy_develop_pr_preview [EXTRACTED 0.90]
- **Develop → main promotion flow across router, workflow, scripts and conflict rounds** — github_workflows_promote_develop_to_main_route, github_workflows_ci_provider_router_route, github_workflows_promote_develop_to_main_promotion_pr, github_scripts_promotion_pr_changelog, github_scripts_promote_features_to_main, github_actions_rebase_conflict_round_action [INFERRED 0.80]
- **develop ↔ main branch automation flow** — github_workflows_promote_features_to_main, github_workflows_promote_develop_to_main, github_workflows_sync_main_into_develop, github_workflows_resolve_pr_conflicts, github_workflows_rebase_pr_stacks [EXTRACTED 0.90]
- **Disjoint merge-vs-rebase AI conflict ownership** — github_workflows_resolve_pr_conflicts, github_workflows_rebase_pr_stacks, github_workflows_rebase_pr_stacks_no_ai_rebase, github_workflows_resolve_pr_conflicts_no_ai_merge, github_workflows_rebase_pr_stacks_rebase_owner_jq [EXTRACTED 0.85]
- **Web CI required-context scoping** — github_workflows_web_ci_scope, github_workflows_web_ci_build, github_workflows_web_ci_api_tests, github_workflows_web_ci_required_build_context, github_workflows_web_ci_required_api_context, remix_scripts_web_ci_required_context_contract [EXTRACTED 0.90]
- **Canonical AI instruction file plus its two symlink aliases** — ai_all_thingtime_ai_instructions, agents_thingtime_ai_instructions, claude_thingtime_ai_instructions [EXTRACTED 0.95]

## Communities (38 total, 13 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (76): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertVercelConfiguration(), assignAliasVerified(), boundedInteger() (+68 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (41): CLAUDE.md project instructions, CI provider router workflow, make_routing_proof (HMAC routing proof), CI provider router — route job, Superseded PR conflict resolver workflow, Promote develop to main (omnibus) workflow, Promote develop to main — promotion-pr job, Promote develop to main — route job (+33 more)

### Community 2 - "Community 2"
Cohesion: 0.14
Nodes (35): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+27 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (35): Admin dashboard, subscription tiers & ownership links (`/admin`, `api/utils/subscriptions/`, `api/utils/accounts/accountLinks.ts`), Admin migrations & collection generations (`remix/app/components/Schemas/MigrationsPanel.tsx`), AI merge-conflict resolver (`.github/workflows/resolve-pr-conflicts.yml`), AI PR/stack rebase resolver (`.github/workflows/rebase-pr-stacks.yml`), App-owner storage manager (`/apps/manage`, `api/utils/apps/appStorageManagement.ts`), Canonical AI instruction links (`AI_ALL.md`), Composer — Thingtime tab (`remix/app/components/Feed/PostComposer.tsx`), Data crystals & nesting depth (`remix/app/schemas/registry.ts`) (+27 more)

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
Cohesion: 0.25
Nodes (14): AI rebase conflict round composite action, assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_rebase_state(), rebase_in_progress() (+6 more)

### Community 14 - "Community 14"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 15 - "Community 15"
Cohesion: 0.15
Nodes (11): Added, Control-plane changelog, Fixed, [Unreleased], Fork setup: Vercel develop previews, `github-actions` — the CI control plane, Known trade-off, Stable develop domain (+3 more)

### Community 16 - "Community 16"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 17 - "Community 17"
Cohesion: 0.27
Nodes (10): attestationMatches(), checkpointRecoveryDisposition(), encodePromotionAttestation(), exactCheckpointPush(), isObjectId(), liveRefShaWithActionsToken(), promotionAttestationBody(), promotionResolverRunDisposition() (+2 more)

### Community 18 - "Community 18"
Cohesion: 0.44
Nodes (10): closeRedundantPass(), createPromotionPr(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), queueTrustedPromotionWorker(), repoFlag(), retargetPass(), tryGh() (+2 more)

### Community 19 - "Community 19"
Cohesion: 0.28
Nodes (9): actions/checkout v4.4.0, Publish or Reconcile Develop S3 Preview, Dispatch Trusted Default-Branch Controller, Develop PR Preview Controller Repository Dispatch, Develop S3 PR Preview Implementation, Fixed Develop Conflict Resolver Control Plane, Develop PR Preview History Filtering, CI Conflict-Resolver Graphify Semantic Refresh (+1 more)

### Community 20 - "Community 20"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 21 - "Community 21"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 22 - "Community 22"
Cohesion: 0.29
Nodes (7): Web CI workflow, api-tests job (headless /tests runner), build job (client build, typecheck ratchet, unit tests), required-api-context companion job, required-build-context companion job, scope job (Web CI classification), run-api-tests.mts headless API suite runner

### Community 23 - "Community 23"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 24 - "Community 24"
Cohesion: 0.40
Nodes (5): Thingtime Web App Changelog, Keep a Changelog, PR #206 Feature Promoter Hardening Note, PR #207 Promoter Empty-Pick Detection Note, PR #271 Deterministic Lockfile Conflict Recovery Note

## Ambiguous Edges - Review These
- `Electron release — build and publish job` → `Thin listener pattern (product branches call control plane by ref)`  [AMBIGUOUS]
  .github/workflows/electron-release.yml · relation: conceptually_related_to
- `Resolve PR conflicts (AI) workflow` → `Rebase-only sweep workflow (no-ai-rebase)`  [AMBIGUOUS]
  .github/workflows/resolve-pr-conflicts.yml · relation: conceptually_related_to

## Knowledge Gaps
- **181 isolated node(s):** `TRUSTED_ASSOCIATIONS`, `TRUSTED_PERMISSIONS`, `PR_EVENT_ACTIONS`, `ACTIVE_STATES`, `TERMINAL_FAILURE_STATES` (+176 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Electron release — build and publish job` and `Thin listener pattern (product branches call control plane by ref)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Resolve PR conflicts (AI) workflow` and `Rebase-only sweep workflow (no-ai-rebase)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Control-plane CI — contract advisories job` connect `Community 6` to `Community 0`, `Community 2`, `Community 7`, `Community 8`, `Community 10`, `Community 12`?**
  _High betweenness centrality (0.354) - this node is a cross-community bridge._
- **Why does `CI provider router — route job` connect `Community 1` to `Community 7`?**
  _High betweenness centrality (0.100) - this node is a cross-community bridge._
- **What connects `TRUSTED_ASSOCIATIONS`, `TRUSTED_PERMISSIONS`, `PR_EVENT_ACTIONS` to the rest of the system?**
  _183 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07692307692307693 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.059233449477351915 - nodes in this community are weakly interconnected._