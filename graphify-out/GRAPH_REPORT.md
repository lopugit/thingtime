# Graph Report - thingtime  (2026-08-17)

## Corpus Check
- 21 files · ~134,724 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 542 nodes · 1103 edges · 40 communities (24 shown, 16 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 13 edges (avg confidence: 0.55)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `df9176cb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_deploy-develop-pr-preview.mjs|deploy-develop-pr-preview.mjs]]
- [[_COMMUNITY_promotion-pr-changelog.mjs|promotion-pr-changelog.mjs]]
- [[_COMMUNITY_selfTest|selfTest]]
- [[_COMMUNITY_failureDetail|failureDetail]]
- [[_COMMUNITY_promotion-worker-routing-contract.mjs|promotion-worker-routing-contract.mjs]]
- [[_COMMUNITY_Unreleased|[Unreleased]]]
- [[_COMMUNITY_promote-features-to-main.mjs|promote-features-to-main.mjs]]
- [[_COMMUNITY_workflow-control-plane-contract.mjs|workflow-control-plane-contract.mjs]]
- [[_COMMUNITY_refresh-promotion-graphify.sh|refresh-promotion-graphify.sh]]
- [[_COMMUNITY_AI merge-conflict resolver workflow|AI merge-conflict resolver workflow]]
- [[_COMMUNITY_promotion-worker-contract.sh|promotion-worker-contract.sh]]
- [[_COMMUNITY_runPromotion|runPromotion]]
- [[_COMMUNITY_prepare-round.sh|prepare-round.sh]]
- [[_COMMUNITY_promotion-worker.sh|promotion-worker.sh]]
- [[_COMMUNITY_resolve-pr-conflicts-routing-contract.mjs|resolve-pr-conflicts-routing-contract.mjs]]
- [[_COMMUNITY_`github-actions` — the CI control plane|`github-actions` — the CI control plane]]
- [[_COMMUNITY_Thingtime AI instructions|Thingtime AI instructions]]
- [[_COMMUNITY_recoverPromotionReviewCheckpoint|recoverPromotionReviewCheckpoint]]
- [[_COMMUNITY_repoFlag|repoFlag]]
- [[_COMMUNITY_start.sh|start.sh]]
- [[_COMMUNITY_verify-promotion-source-authority.sh|verify-promotion-source-authority.sh]]
- [[_COMMUNITY_scope job (Web CI classification)|scope job (Web CI classification)]]
- [[_COMMUNITY_vercel.json|vercel.json]]
- [[_COMMUNITY_AI_ALL.md — canonical Thingtime AI instructions|AI_ALL.md — canonical Thingtime AI instructions]]
- [[_COMMUNITY_Electron release — build and publish job|Electron release — build and publish job]]
- [[_COMMUNITY_comment-product-contract-advisories job|comment-product-contract-advisories job]]
- [[_COMMUNITY_AGENTS.md — symlink to AI_ALL|AGENTS.md — symlink to AI_ALL.md]]
- [[_COMMUNITY_Graphify knowledge-graph usage rules|Graphify knowledge-graph usage rules]]
- [[_COMMUNITY_Deterministic delete-shaped conflict settlement|Deterministic delete-shaped conflict settlement]]
- [[_COMMUNITY_Lane-aware trusted promotion validator|Lane-aware trusted promotion validator]]
- [[_COMMUNITY_Control-plane CI — verify job|Control-plane CI — verify job]]
- [[_COMMUNITY_Bare-tree invariant|Bare-tree invariant]]
- [[_COMMUNITY_README — github-actions CI control plane|README — github-actions CI control plane]]
- [[_COMMUNITY_PR 24 Nitro React Router Migration Note|PR #24 Nitro React Router Migration Note]]
- [[_COMMUNITY_PR 206 Feature Promoter Hardening Note|PR #206 Feature Promoter Hardening Note]]
- [[_COMMUNITY_PR 207 Promoter Empty-Pick Detection Note|PR #207 Promoter Empty-Pick Detection Note]]
- [[_COMMUNITY_PR 271 Deterministic Lockfile Conflict Recovery Note|PR #271 Deterministic Lockfile Conflict Recovery Note]]
- [[_COMMUNITY_vercel.json Git-deployment kill-switch|vercel.json Git-deployment kill-switch]]
- [[_COMMUNITY_TESTING.md — per-area manual test checklists|TESTING.md — per-area manual test checklists]]
- [[_COMMUNITY_CLAUDE.md — symlink to AI_ALL|CLAUDE.md — symlink to AI_ALL.md]]

## God Nodes (most connected - your core abstractions)
1. `selfTest()` - 49 edges
2. `runPromotion()` - 35 edges
3. `TESTING.md — per-area manual test checklists` - 35 edges
4. `failureDetail()` - 28 edges
5. `deploy()` - 26 edges
6. `main()` - 20 edges
7. `[Unreleased]` - 20 edges
8. `orphanedMergeHydrationIntegrationTest()` - 19 edges
9. `runSelfTest()` - 17 edges
10. `repoFlag()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `Electron release — build and publish job` --conceptually_related_to--> `Thin listener pattern (product branches call control plane by ref)`  [AMBIGUOUS]
  .github/workflows/electron-release.yml → README.md
- `Web CI workflow` --shares_data_with--> `run-api-tests.mts headless API suite runner`  [INFERRED]
  .github/workflows/web-ci.yml → remix/scripts/run-api-tests.mts
- `api-tests job (headless /tests runner)` --calls--> `run-api-tests.mts headless API suite runner`  [EXTRACTED]
  .github/workflows/web-ci.yml → remix/scripts/run-api-tests.mts
- `AI PR/stack rebase resolver workflow` --calls--> `AI rebase conflict round composite action`  [INFERRED]
  .github/workflows/rebase-pr-stacks.yml → .github/actions/rebase-conflict-round/action.yml
- `AI merge-conflict resolver workflow` --references--> `Superseded pr-conflict-resolver workflow`  [EXTRACTED]
  .github/workflows/resolve-pr-conflicts.yml → .github/workflows/pr-conflict-resolver.yml

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Develop PR Preview Trusted Control Flow** — github_workflows_develop_pr_preview_dispatch, github_workflows_develop_pr_preview_repository_dispatch, github_workflows_develop_pr_preview_controller, github_workflows_develop_pr_preview_deploy_script [EXTRACTED 1.00]
- **Develop Preview and Stable-Domain Safety** — testing_develop_custom_environment_promotion, remix_changelog_preview_cleanup_fix, remix_changelog_preview_query_fix, remix_changelog_stable_domain_fix [INFERRED 0.96]
- **AI Repository Automation Validation** — testing_ai_merge_conflict_resolver, testing_ai_pr_stack_rebase_resolver, testing_per_feature_promoter, testing_required_web_ci_contexts, testing_graphify_semantic_refresh, testing_model_waterfall [INFERRED 0.90]
- **Deterministic contract advisory suite run by control-plane CI** — github_workflows_control_plane_ci_contract_advisories, github_scripts_workflow_control_plane_contract, github_scripts_resolve_pr_conflicts_routing_contract, github_scripts_rebase_ownership_routing_contract, github_scripts_promotion_worker_routing_contract, github_scripts_promotion_worker_contract, github_scripts_promotion_pr_changelog, github_scripts_promote_features_to_main, github_scripts_deploy_develop_pr_preview [EXTRACTED 0.90]
- **Develop → main promotion flow across router, workflow, scripts and conflict rounds** — github_workflows_promote_develop_to_main_route, github_workflows_ci_provider_router_route, github_workflows_promote_develop_to_main_promotion_pr, github_scripts_promotion_pr_changelog, github_scripts_promote_features_to_main, github_actions_rebase_conflict_round_action [INFERRED 0.80]
- **develop ↔ main branch automation flow** — github_workflows_promote_features_to_main, github_workflows_promote_develop_to_main, github_workflows_sync_main_into_develop, github_workflows_resolve_pr_conflicts, github_workflows_rebase_pr_stacks [EXTRACTED 0.90]
- **Disjoint merge-vs-rebase AI conflict ownership** — github_workflows_resolve_pr_conflicts, github_workflows_rebase_pr_stacks, github_workflows_rebase_pr_stacks_no_ai_rebase, github_workflows_resolve_pr_conflicts_no_ai_merge, github_workflows_rebase_pr_stacks_rebase_owner_jq [EXTRACTED 0.85]
- **Web CI required-context scoping** — github_workflows_web_ci_scope, github_workflows_web_ci_build, github_workflows_web_ci_api_tests, github_workflows_web_ci_required_build_context, github_workflows_web_ci_required_api_context, remix_scripts_web_ci_required_context_contract [EXTRACTED 0.90]
- **Canonical AI instruction file plus its two symlink aliases** — ai_all_thingtime_ai_instructions, agents_thingtime_ai_instructions, claude_thingtime_ai_instructions [EXTRACTED 0.95]

## Communities (40 total, 16 thin omitted)

### Community 0 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.08
Nodes (78): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertVercelConfiguration(), assignAliasVerified(), boundedInteger() (+70 more)

### Community 1 - "promotion-pr-changelog.mjs"
Cohesion: 0.14
Nodes (35): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+27 more)

### Community 2 - "selfTest"
Cohesion: 0.09
Nodes (34): botCommentsByLatestEvent(), buildPromotionDispatchRequest(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), dispatchPromotionResolution(), exactReservationDeleteArgs(), exactReservationPushArgs() (+26 more)

### Community 3 - "failureDetail"
Cohesion: 0.13
Nodes (32): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), createPromotionReviewCheckpoint(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers() (+24 more)

### Community 4 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.07
Nodes (28): action, aiBlock, checkpointPending, checkpointPush, cleanWorkerDispatch, commitGuard, commitsApi, contentPush (+20 more)

### Community 5 - "[Unreleased]"
Cohesion: 0.09
Nodes (22): [1.0.0] - YYYY-MM-DD, Added, Added, Added, Added, Changed, Changed, Changed (+14 more)

### Community 6 - "promote-features-to-main.mjs"
Cohesion: 0.12
Nodes (23): CFG, cleanReplayQuarantinePolicy(), env(), EXEC_OPTS, flag(), gh(), ghJson(), git() (+15 more)

### Community 7 - "workflow-control-plane-contract.mjs"
Cohesion: 0.13
Nodes (24): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, ALLOWED_MODELS, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertBareControlPlaneTree() (+16 more)

### Community 8 - "refresh-promotion-graphify.sh"
Cohesion: 0.13
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 9 - "AI merge-conflict resolver workflow"
Cohesion: 0.11
Nodes (21): CI provider router workflow, make_routing_proof (HMAC routing proof), CI provider router — route job, Superseded pr-conflict-resolver workflow, Promote develop to main (omnibus) workflow, Promote develop to main — promotion-pr job, Promote develop to main — route job, Promote features to main workflow (+13 more)

### Community 10 - "promotion-worker-contract.sh"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_review_replay(), RESERVATION_SHA (+8 more)

### Community 11 - "runPromotion"
Cohesion: 0.21
Nodes (17): cancelPromotionRetirement(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata(), findOpenPromotionNumber(), listRemotePromotionBranches(), processGroupsIndependently(), promotionBody() (+9 more)

### Community 12 - "prepare-round.sh"
Cohesion: 0.25
Nodes (14): AI rebase conflict round composite action, assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_rebase_state(), rebase_in_progress() (+6 more)

### Community 13 - "promotion-worker.sh"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 14 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.22
Nodes (15): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), decodeBatch(), encodeBatch(), positiveDecimal() (+7 more)

### Community 15 - "`github-actions` — the CI control plane"
Cohesion: 0.15
Nodes (11): Added, Control-plane changelog, Fixed, [Unreleased], Fork setup: Vercel develop previews, `github-actions` — the CI control plane, Known trade-off, Stable develop domain (+3 more)

### Community 16 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 17 - "recoverPromotionReviewCheckpoint"
Cohesion: 0.27
Nodes (10): attestationMatches(), checkpointRecoveryDisposition(), encodePromotionAttestation(), exactCheckpointPush(), isObjectId(), liveRefShaWithActionsToken(), promotionAttestationBody(), promotionResolverRunDisposition() (+2 more)

### Community 18 - "repoFlag"
Cohesion: 0.44
Nodes (10): closeRedundantPass(), createPromotionPr(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), queueTrustedPromotionWorker(), repoFlag(), retargetPass(), tryGh() (+2 more)

### Community 19 - "start.sh"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 20 - "verify-promotion-source-authority.sh"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 21 - "scope job (Web CI classification)"
Cohesion: 0.29
Nodes (7): Web CI workflow, api-tests job (headless /tests runner), build job (client build, typecheck ratchet, unit tests), required-api-context companion job, required-build-context companion job, scope job (Web CI classification), run-api-tests.mts headless API suite runner

### Community 22 - "vercel.json"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 38 - "TESTING.md — per-area manual test checklists"
Cohesion: 0.06
Nodes (35): Admin dashboard, subscription tiers & ownership links (`/admin`, `api/utils/subscriptions/`, `api/utils/accounts/accountLinks.ts`), Admin migrations & collection generations (`remix/app/components/Schemas/MigrationsPanel.tsx`), AI merge-conflict resolver (`.github/workflows/resolve-pr-conflicts.yml`), AI PR/stack rebase resolver (`.github/workflows/rebase-pr-stacks.yml`), App-owner storage manager (`/apps/manage`, `api/utils/apps/appStorageManagement.ts`), Canonical AI instruction links (`AI_ALL.md`), Composer — Thingtime tab (`remix/app/components/Feed/PostComposer.tsx`), Data crystals & nesting depth (`remix/app/schemas/registry.ts`) (+27 more)

## Ambiguous Edges - Review These
- `Electron release — build and publish job` → `Thin listener pattern (product branches call control plane by ref)`  [AMBIGUOUS]
  .github/workflows/electron-release.yml · relation: conceptually_related_to

## Knowledge Gaps
- **186 isolated node(s):** `TRUSTED_ASSOCIATIONS`, `TRUSTED_PERMISSIONS`, `PR_EVENT_ACTIONS`, `ACTIVE_STATES`, `TERMINAL_FAILURE_STATES` (+181 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Electron release — build and publish job` and `Thin listener pattern (product branches call control plane by ref)`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `Control-plane CI — contract advisories job` connect `promotion-worker-routing-contract.mjs` to `deploy-develop-pr-preview.mjs`, `promotion-pr-changelog.mjs`, `promote-features-to-main.mjs`, `workflow-control-plane-contract.mjs`, `promotion-worker-contract.sh`, `resolve-pr-conflicts-routing-contract.mjs`?**
  _High betweenness centrality (0.343) - this node is a cross-community bridge._
- **Why does `CI provider router — route job` connect `AI merge-conflict resolver workflow` to `promote-features-to-main.mjs`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Why does `AI PR/stack rebase resolver workflow` connect `AI merge-conflict resolver workflow` to `prepare-round.sh`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **What connects `TRUSTED_ASSOCIATIONS`, `TRUSTED_PERMISSIONS`, `PR_EVENT_ACTIONS` to the rest of the system?**
  _188 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `deploy-develop-pr-preview.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.07530864197530865 - nodes in this community are weakly interconnected._
- **Should `promotion-pr-changelog.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.14126984126984127 - nodes in this community are weakly interconnected._