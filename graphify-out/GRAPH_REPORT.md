# Graph Report - .  (2026-08-25)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 557 nodes · 1203 edges · 40 communities (28 shown, 12 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 14 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `bb5390ac`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_deploy-develop-pr-preview.mjs|deploy-develop-pr-preview.mjs]]
- [[_COMMUNITY_promotion-pr-changelog.mjs|promotion-pr-changelog.mjs]]
- [[_COMMUNITY_build-all-branch.mjs|build-all-branch.mjs]]
- [[_COMMUNITY_failureDetail|failureDetail]]
- [[_COMMUNITY_selfTest|selfTest]]
- [[_COMMUNITY_prepare-round.sh|prepare-round.sh]]
- [[_COMMUNITY_promote-features-to-main.mjs|promote-features-to-main.mjs]]
- [[_COMMUNITY_workflow-control-plane-contract.mjs|workflow-control-plane-contract.mjs]]
- [[_COMMUNITY_refresh-promotion-graphify.sh|refresh-promotion-graphify.sh]]
- [[_COMMUNITY_promotion-worker-contract.sh|promotion-worker-contract.sh]]
- [[_COMMUNITY_Lopu PR manager Workflow|Lopu PR manager Workflow]]
- [[_COMMUNITY_runPromotion|runPromotion]]
- [[_COMMUNITY_promotion-worker.sh|promotion-worker.sh]]
- [[_COMMUNITY_repoFlag|repoFlag]]
- [[_COMMUNITY_resolve-pr-conflicts-routing-contract.mjs|resolve-pr-conflicts-routing-contract.mjs]]
- [[_COMMUNITY_run_contract Shell Function|run_contract Shell Function]]
- [[_COMMUNITY_Thingtime AI instructions|Thingtime AI instructions]]
- [[_COMMUNITY_CodeQL All Branches Workflow|CodeQL All Branches Workflow]]
- [[_COMMUNITY_recoverPromotionReviewCheckpoint|recoverPromotionReviewCheckpoint]]
- [[_COMMUNITY_analyze Job|analyze Job]]
- [[_COMMUNITY_`github-actions` — the CI control plane|`github-actions` — the CI control plane]]
- [[_COMMUNITY_start.sh|start.sh]]
- [[_COMMUNITY_Build And Publish Signed PR Release Job|Build And Publish Signed PR Release Job]]
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
- [[_COMMUNITY_Web CI Workflow|Web CI Workflow]]
- [[_COMMUNITY_AI_ALL.md canonical instructions|AI_ALL.md canonical instructions]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_Commander App Release workflow|Commander App Release workflow]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]

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
- `Lopu Principal Repository Manager` --semantically_similar_to--> `Lopu PR Manager`  [INFERRED] [semantically similar]
  README.md → CHANGELOG.md
- `Graphify Refresh Step` --semantically_similar_to--> `Post-merge Graphify Refresh`  [INFERRED] [semantically similar]
  .github/workflows/resolve-pr-conflicts.yml → CHANGELOG.md
- `Lopu PR Manager Workflow` --semantically_similar_to--> `Lopu Principal Repository Manager`  [INFERRED] [semantically similar]
  .github/workflows/resolve-pr-conflicts.yml → README.md
- `Lopu Internal Feature Promotion Workflow` --conceptually_related_to--> `CI Promotion Lanes`  [INFERRED]
  .github/workflows/promote-features-to-main.yml → CHANGELOG.md
- `Web CI Workflow` --references--> `Testing Checklist`  [INFERRED]
  .github/workflows/web-ci.yml → TESTING.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Lopu Control-plane Management Flow** — changelog_lopu_pr_manager, readme_lopu_principal_repository_manager, _github_workflows_resolve_pr_conflicts_lopu_pr_manager_workflow [EXTRACTED 0.90]
- **Workflow Event Entrypoints** — _github_workflows_resolve_pr_conflicts_workflow_call, _github_workflows_resolve_pr_conflicts_push_trigger, _github_workflows_resolve_pr_conflicts_pull_request_target_trigger, _github_workflows_resolve_pr_conflicts_issue_comment_trigger, _github_workflows_resolve_pr_conflicts_check_run_trigger, _github_workflows_resolve_pr_conflicts_schedule_trigger [EXTRACTED 0.95]
- **CI Branch Maintenance Concepts** — changelog_promotion_lanes, changelog_thin_listeners, readme_bare_tree_invariant, readme_vercel_kill_switch [INFERRED 0.80]
- **Develop PR Preview Controller Flow** — github_workflows_develop_pr_preview_workflow, github_workflows_develop_pr_preview_dispatch_job, github_workflows_develop_pr_preview_repository_dispatch, github_workflows_develop_pr_preview_controller_event, github_workflows_develop_pr_preview_controller_job, github_workflows_develop_pr_preview_deploy_script [EXTRACTED 0.95]
- **Claude and Codex Backend Selection** — changelog_lopu_agent_backend_selector, _github_actions_lopu_agent_action_validate_lopu_backend, _github_actions_lopu_agent_action_claude_code_action, _github_actions_lopu_agent_action_codex_action [EXTRACTED 0.95]
- **Central CodeQL PR Scan Flow** — changelog_lopu_codeql, changelog_pull_request_target_handoff, changelog_workflow_dispatch_scan, _github_workflows_codeql_analysis_handoff_job, _github_workflows_codeql_analysis_scope_job, _github_workflows_codeql_analysis_analyze_job [EXTRACTED 0.90]
- **Signed Desktop PR Release Flow** — readme_signed_desktop_pr_releases, _github_workflows_electron_pr_release_workflow, _github_workflows_electron_pr_release_resolve_validate_source, _github_workflows_electron_pr_release_import_credentials, _github_workflows_electron_pr_release_publish_prerelease [EXTRACTED 0.90]
- **Provider Routed CI Workflows** — _github_workflows_ci_provider_router_route_ci_compute_provider, _github_workflows_promote_develop_to_main_promote_develop_to_main, _github_workflows_promote_features_to_main_promote_features_to_main, _github_workflows_rebase_pr_stacks_rebase_prs_and_stacks, _github_workflows_resolve_pr_conflicts_resolve_pr_conflicts, _github_workflows_sync_main_into_develop_sync_main_into_develop [EXTRACTED 0.90]
- **Canonical AI Instruction Files** — agents_thingtime_ai_instructions, ai_all_thingtime_ai_instructions, claude_thingtime_ai_instructions [EXTRACTED 0.95]

## Communities (40 total, 12 thin omitted)

### Community 0 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.06
Nodes (95): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), assertVercelConfiguration(), assertWildcardFallbackRuntimes() (+87 more)

### Community 1 - "promotion-pr-changelog.mjs"
Cohesion: 0.06
Nodes (36): ci-provider-router.yml, promotion-pr-changelog.mjs, promotion-pr Job, route Job, Lopu Internal Develop Promotion Workflow, ci-provider-router.yml, lanes Job, promote-features-to-main.mjs (+28 more)

### Community 2 - "build-all-branch.mjs"
Cohesion: 0.14
Nodes (35): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+27 more)

### Community 3 - "failureDetail"
Cohesion: 0.10
Nodes (31): botCommentsByLatestEvent(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), externalStackPromotionState(), findBotPromotionRetirement(), groupFailureMessages(), groupKeyFor() (+23 more)

### Community 4 - "selfTest"
Cohesion: 0.19
Nodes (31): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode(), git() (+23 more)

### Community 5 - "prepare-round.sh"
Cohesion: 0.13
Nodes (18): CFG, checkpointRecoveryDisposition(), encodePromotionAttestation(), env(), EXEC_OPTS, flag(), isExactPausedPromotionSnapshot(), listSourceIssueComments() (+10 more)

### Community 6 - "promote-features-to-main.mjs"
Cohesion: 0.15
Nodes (30): cancelPromotionRetirement(), closeRedundantPass(), createPromotionPr(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata() (+22 more)

### Community 7 - "workflow-control-plane-contract.mjs"
Cohesion: 0.15
Nodes (26): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers(), failureDetail() (+18 more)

### Community 8 - "refresh-promotion-graphify.sh"
Cohesion: 0.13
Nodes (25): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, ALLOWED_MODELS, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertBareControlPlaneTree() (+17 more)

### Community 9 - "promotion-worker-contract.sh"
Cohesion: 0.12
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 10 - "Lopu PR manager Workflow"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay(), RESERVATION_SHA (+8 more)

### Community 11 - "runPromotion"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 12 - "promotion-worker.sh"
Cohesion: 0.22
Nodes (14): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), LOPU_ACTION_URL, positiveDecimal(), REBASE_ACTION_URL (+6 more)

### Community 13 - "repoFlag"
Cohesion: 0.14
Nodes (14): anthropics/claude-code-action, openai/codex-action, Lopu Agent Composite Action, Validate the Lopu Backend Step, Lopu Agent Reference in Rebase Round, prepare-round.sh, Lopu Rebase Conflict Round Action, Lopu All-Branch Integration Workflow (+6 more)

### Community 14 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.27
Nodes (13): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_rebase_state(), rebase_in_progress(), secure_git_environment() (+5 more)

### Community 15 - "run_contract Shell Function"
Cohesion: 0.17
Nodes (12): actions/checkout, build-all-branch.mjs, comment-contract-advisories Job, contract-advisories Job, deploy-develop-pr-preview.mjs, electron-pr-release-contract.mjs, actions/github-script, resolve-pr-conflicts-routing-contract.mjs (+4 more)

### Community 16 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Thingtime AI Instructions, Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify (+3 more)

### Community 17 - "CodeQL All Branches Workflow"
Cohesion: 0.17
Nodes (11): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, graphify, lopuAgent, mainDevelopSyncWorkflow, promoter (+3 more)

### Community 18 - "recoverPromotionReviewCheckpoint"
Cohesion: 0.20
Nodes (10): actions/checkout v4.4.0, develop-pr-preview-controller event, Publish or reconcile develop S3 preview job, .github/scripts/deploy-develop-pr-preview.mjs, Dispatch trusted default-branch controller job, GitHub repository dispatch API, VERCEL_DEVELOP_DEPLOY_TOKEN, vercel-develop-pr-control environment (+2 more)

### Community 19 - "analyze Job"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 20 - "`github-actions` — the CI control plane"
Cohesion: 0.29
Nodes (7): Build Signed And Notarized Electron Release Step, Derive SemVer PR Release Identity Step, Import Developer ID And Notarization Credentials Step, Publish Prerelease Step, Build And Publish Signed PR Release Job, Resolve And Validate PR Source Step, Signed Electron PR Release Workflow

### Community 21 - "start.sh"
Cohesion: 0.33
Nodes (7): buildPromotionDispatchRequest(), dispatchPromotionResolution(), exactReservationDeleteArgs(), exactReservationPushArgs(), promotionDispatchArgs(), queueTrustedPromotionWorker(), redispatchPromotionReservation()

### Community 22 - "Build And Publish Signed PR Release Job"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 23 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 24 - "verify-promotion-source-authority.sh"
Cohesion: 0.50
Nodes (4): assertSignedPrReleaseContract(), count(), here, workflow

### Community 25 - "vercel.json"
Cohesion: 0.50
Nodes (4): ci-provider-router.yml, route Job, sync Job, Lopu Internal Main Develop Synchronization Workflow

### Community 26 - "electron-pr-release-contract.mjs"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 39 - "Community 39"
Cohesion: 0.26
Nodes (12): attestationMatches(), createPromotionReviewCheckpoint(), exactCheckpointPush(), inspectPromotionReviewCheckpoint(), isObjectId(), latestBotPromotionAttestationEvents(), liveRefShaWithActionsToken(), parsePromotionResolutionAttestations() (+4 more)

## Knowledge Gaps
- **154 isolated node(s):** `workflow`, `rebaseWorkflow`, `allBranchWorkflow`, `developPromotionWorkflow`, `featurePromotionWorkflow` (+149 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `selfTest()` connect `failureDetail` to `prepare-round.sh`, `promote-features-to-main.mjs`, `Community 39`, `workflow-control-plane-contract.mjs`, `start.sh`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **What connects `workflow`, `rebaseWorkflow`, `allBranchWorkflow` to the rest of the system?**
  _154 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `deploy-develop-pr-preview.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.06332842415316642 - nodes in this community are weakly interconnected._
- **Should `promotion-pr-changelog.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05873015873015873 - nodes in this community are weakly interconnected._
- **Should `build-all-branch.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.14126984126984127 - nodes in this community are weakly interconnected._
- **Should `failureDetail` be split into smaller, more focused modules?**
  _Cohesion score 0.0989247311827957 - nodes in this community are weakly interconnected._
- **Should `prepare-round.sh` be split into smaller, more focused modules?**
  _Cohesion score 0.12554112554112554 - nodes in this community are weakly interconnected._