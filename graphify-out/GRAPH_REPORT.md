# Graph Report - .  (2026-08-25)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 601 nodes · 1242 edges · 54 communities (32 shown, 22 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.61)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f8d568eb`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_deploy-develop-pr-preview.mjs|deploy-develop-pr-preview.mjs]]
- [[_COMMUNITY_promotion-pr-changelog.mjs|promotion-pr-changelog.mjs]]
- [[_COMMUNITY_build-all-branch.mjs|build-all-branch.mjs]]
- [[_COMMUNITY_selfTest|selfTest]]
- [[_COMMUNITY_runPromotion|runPromotion]]
- [[_COMMUNITY_failureDetail|failureDetail]]
- [[_COMMUNITY_workflow-control-plane-contract.mjs|workflow-control-plane-contract.mjs]]
- [[_COMMUNITY_refresh-promotion-graphify.sh|refresh-promotion-graphify.sh]]
- [[_COMMUNITY_promote-features-to-main.mjs|promote-features-to-main.mjs]]
- [[_COMMUNITY_promotion-worker-contract.sh|promotion-worker-contract.sh]]
- [[_COMMUNITY_Analyze Job|Analyze Job]]
- [[_COMMUNITY_promotion-worker.sh|promotion-worker.sh]]
- [[_COMMUNITY_resolve-pr-conflicts-routing-contract.mjs|resolve-pr-conflicts-routing-contract.mjs]]
- [[_COMMUNITY_prepare-round.sh|prepare-round.sh]]
- [[_COMMUNITY_run_contract Shell Function|run_contract Shell Function]]
- [[_COMMUNITY_Thingtime AI instructions|Thingtime AI instructions]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_promotion-worker-routing-contract.mjs|promotion-worker-routing-contract.mjs]]
- [[_COMMUNITY_Lopu Internal Feature Promotion Workflow|Lopu Internal Feature Promotion Workflow]]
- [[_COMMUNITY_start.sh|start.sh]]
- [[_COMMUNITY_Publish or reconcile develop S3 preview job|Publish or reconcile develop S3 preview job]]
- [[_COMMUNITY_classify-claude-credential-failure.mjs|classify-claude-credential-failure.mjs]]
- [[_COMMUNITY_Post-merge Graphify Refresh|Post-merge Graphify Refresh]]
- [[_COMMUNITY_start.sh|start.sh]]
- [[_COMMUNITY_Build And Publish Signed PR Release Job|Build And Publish Signed PR Release Job]]
- [[_COMMUNITY_queueTrustedPromotionWorker|queueTrustedPromotionWorker]]
- [[_COMMUNITY_verify-promotion-source-authority.sh|verify-promotion-source-authority.sh]]
- [[_COMMUNITY_rebase-ownership-routing-contract.sh|rebase-ownership-routing-contract.sh]]
- [[_COMMUNITY_vercel.json|vercel.json]]
- [[_COMMUNITY_electron-pr-release-contract.mjs|electron-pr-release-contract.mjs]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_rebase-ownership-routing-contract.sh|rebase-ownership-routing-contract.sh]]
- [[_COMMUNITY_Route CI Compute Provider Workflow|Route CI Compute Provider Workflow]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Promotion PR Changelog Script|Promotion PR Changelog Script]]
- [[_COMMUNITY_Route CI Compute Provider Workflow|Route CI Compute Provider Workflow]]
- [[_COMMUNITY_Electron App Release Workflow|Electron App Release Workflow]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_AI_ALL.md canonical instructions|AI_ALL.md canonical instructions]]
- [[_COMMUNITY_`github-actions` — the CI control plane|`github-actions` — the CI control plane]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_Fundamentals|Fundamentals]]
- [[_COMMUNITY_CI provider router workflow|CI provider router workflow]]
- [[_COMMUNITY_ai-merge-paused Label|ai-merge-paused Label]]
- [[_COMMUNITY_Lopu CodeQL Triage|Lopu CodeQL Triage]]
- [[_COMMUNITY_Lopu PR Manager|Lopu PR Manager]]
- [[_COMMUNITY_no-ai-merge Label|no-ai-merge Label]]
- [[_COMMUNITY_Post-merge Graphify Refresh|Post-merge Graphify Refresh]]
- [[_COMMUNITY_Promotion Lanes|Promotion Lanes]]
- [[_COMMUNITY_Stack Rebase Engine|Stack Rebase Engine]]
- [[_COMMUNITY_Commander App Release workflow|Commander App Release workflow]]
- [[_COMMUNITY_pr-conflict-resolver.yml (superseded)|pr-conflict-resolver.yml (superseded)]]
- [[_COMMUNITY_Community 53|Community 53]]

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
- `Lopu CodeQL PR Handoff Workflow` --semantically_similar_to--> `CodeQL PR Handoff`  [INFERRED] [semantically similar]
  .github/workflows/codeql-pr-handoff.yml → CHANGELOG.md
- `Lopu CodeQL All Branches Workflow` --semantically_similar_to--> `codeql-analysis.yml`  [INFERRED] [semantically similar]
  .github/workflows/codeql-analysis.yml → README.md
- `Web CI Workflow` --references--> `Testing Checklist`  [INFERRED]
  .github/workflows/web-ci.yml → TESTING.md
- `Lopu Internal Main Develop Synchronization Workflow` --conceptually_related_to--> `Lopu PR Manager`  [EXTRACTED]
  .github/workflows/sync-main-into-develop.yml → README.md
- `sync/main-into-develop Branch` --semantically_similar_to--> `sync/main-into-develop Branch`  [EXTRACTED] [semantically similar]
  .github/workflows/sync-main-into-develop.yml → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **CodeQL Analysis Ownership Flow** — github_workflows_codeql_analysis_workflow, github_workflows_codeql_analysis_scope_job, github_workflows_codeql_analysis_scope_step, github_workflows_codeql_analysis_analyze_job, github_workflows_codeql_analysis_codeql_analyze_action [EXTRACTED 0.95]
- **CI Control Plane Allowed Root Paths** — readme_github_workflows, readme_github_scripts, readme_github_actions, readme_vercel_json [EXTRACTED 1.00]
- **Main Into Develop Synchronization Flow** — github_workflows_sync_main_into_develop_check_develop_exists, github_workflows_sync_main_into_develop_checkout_develop, github_workflows_sync_main_into_develop_merge_main_into_develop, github_workflows_sync_main_into_develop_push_develop, github_workflows_sync_main_into_develop_open_refresh_safe_sync_pr [EXTRACTED 1.00]
- **Safe Sync PR Publication Components** — github_workflows_sync_main_into_develop_open_refresh_safe_sync_pr, github_workflows_sync_main_into_develop_find_sync_pr, github_workflows_sync_main_into_develop_sync_branch, github_workflows_sync_main_into_develop_sync_branches_pat, github_workflows_sync_main_into_develop_conflict_resolver_pat [EXTRACTED 1.00]
- **Lopu Backend Selection Flow** — github_actions_lopu_agent_action_validate_lopu_backend, github_actions_lopu_agent_action_claude_primary, github_actions_lopu_agent_action_claude_fallback, github_actions_lopu_agent_action_codex_runner [EXTRACTED 0.90]
- **All-Branch Rebuild and Doctor Flow** — github_workflows_all_branch_rebuild_job, github_scripts_build_all_branch_build_all_branch, github_workflows_all_branch_build_doctor_round, github_actions_lopu_agent_action_lopu_agent [EXTRACTED 0.90]
- **Control-Plane Contract Validation Suite** — github_workflows_control_plane_ci_verify_job, github_workflows_control_plane_ci_contract_advisories_job, github_scripts_build_all_branch_build_all_branch, github_scripts_workflow_control_plane_contract_workflow_control_plane_contract, github_scripts_deploy_develop_pr_preview_deploy_develop_pr_preview [EXTRACTED 0.85]
- **Central CodeQL PR Scan Flow** — changelog_codeql_pr_handoff, github_workflows_codeql_pr_handoff_lopu_codeql_pr_handoff, github_workflows_codeql_analysis_lopu_codeql_all_branches, github_workflows_codeql_analysis_codeql_analyze [EXTRACTED 0.92]
- **Graphify Semantic Refresh Flow** — changelog_post_merge_graphify, readme_post_merge_graphify, github_workflows_resolve_pr_conflicts_graphify_refresh, changelog_lopu_agent_backend [EXTRACTED 0.86]
- **Develop PR Preview Controller Flow** — github_workflows_develop_pr_preview_workflow, github_workflows_develop_pr_preview_dispatch_job, github_workflows_develop_pr_preview_repository_dispatch, github_workflows_develop_pr_preview_controller_event, github_workflows_develop_pr_preview_controller_job, github_workflows_develop_pr_preview_deploy_script [EXTRACTED 0.95]
- **Signed Desktop PR Release Flow** — readme_signed_desktop_pr_releases, _github_workflows_electron_pr_release_workflow, _github_workflows_electron_pr_release_resolve_validate_source, _github_workflows_electron_pr_release_import_credentials, _github_workflows_electron_pr_release_publish_prerelease [EXTRACTED 0.90]
- **Provider Routed CI Workflows** — _github_workflows_ci_provider_router_route_ci_compute_provider, _github_workflows_promote_develop_to_main_promote_develop_to_main, _github_workflows_promote_features_to_main_promote_features_to_main, _github_workflows_rebase_pr_stacks_rebase_prs_and_stacks, _github_workflows_resolve_pr_conflicts_resolve_pr_conflicts, _github_workflows_sync_main_into_develop_sync_main_into_develop [EXTRACTED 0.90]
- **Canonical AI Instruction Files** — agents_thingtime_ai_instructions, ai_all_thingtime_ai_instructions, claude_thingtime_ai_instructions [EXTRACTED 0.95]

## Communities (54 total, 22 thin omitted)

### Community 0 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.06
Nodes (95): ACTIVE_STATES, assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), assertVercelConfiguration(), assertWildcardFallbackRuntimes() (+87 more)

### Community 1 - "promotion-pr-changelog.mjs"
Cohesion: 0.14
Nodes (35): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+27 more)

### Community 2 - "build-all-branch.mjs"
Cohesion: 0.10
Nodes (31): botCommentsByLatestEvent(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), externalStackPromotionState(), findBotPromotionRetirement(), groupFailureMessages(), groupKeyFor() (+23 more)

### Community 3 - "selfTest"
Cohesion: 0.19
Nodes (31): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode(), git() (+23 more)

### Community 4 - "runPromotion"
Cohesion: 0.07
Nodes (32): Analyze Matrix Job, base64 Decode, actions/checkout, github/codeql-action/analyze, github/codeql-action/init, gh api, grep Listener Check, jq (+24 more)

### Community 5 - "failureDetail"
Cohesion: 0.13
Nodes (18): CFG, checkpointRecoveryDisposition(), encodePromotionAttestation(), env(), EXEC_OPTS, flag(), isExactPausedPromotionSnapshot(), listSourceIssueComments() (+10 more)

### Community 6 - "workflow-control-plane-contract.mjs"
Cohesion: 0.15
Nodes (30): cancelPromotionRetirement(), closeRedundantPass(), createPromotionPr(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata() (+22 more)

### Community 7 - "refresh-promotion-graphify.sh"
Cohesion: 0.15
Nodes (26): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers(), failureDetail() (+18 more)

### Community 8 - "promote-features-to-main.mjs"
Cohesion: 0.13
Nodes (25): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, ALLOWED_MODELS, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertBareControlPlaneTree() (+17 more)

### Community 9 - "promotion-worker-contract.sh"
Cohesion: 0.12
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 10 - "Analyze Job"
Cohesion: 0.09
Nodes (23): Claude Credential Failure Classifier, Run Lopu with Fallback Claude Credential, Run Lopu with Primary Claude Credential, Run Lopu with Codex, Lopu Agent Composite Action, Validate the Lopu Backend, Continue Exact Claude Session, Resolve Rebase Conflict Set with Lopu in Scratch (+15 more)

### Community 11 - "promotion-worker.sh"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay(), RESERVATION_SHA (+8 more)

### Community 12 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.21
Nodes (16): Bootstrap Trusted Round Code, Validate Conflicts and Create Repo-less Scratch, Lopu Rebase Conflict Round Composite Action, assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers() (+8 more)

### Community 13 - "prepare-round.sh"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 14 - "run_contract Shell Function"
Cohesion: 0.22
Nodes (14): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), LOPU_ACTION_URL, positiveDecimal(), REBASE_ACTION_URL (+6 more)

### Community 15 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Thingtime AI Instructions, Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify (+3 more)

### Community 16 - "Thingtime AI Instructions"
Cohesion: 0.17
Nodes (11): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, graphify, lopuAgent, mainDevelopSyncWorkflow, promoter (+3 more)

### Community 17 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.18
Nodes (11): ci-provider-router.yml, promotion-pr-changelog.mjs, promotion-pr Job, route Job, Lopu Internal Develop Promotion Workflow, ci-provider-router.yml, lanes Job, promote-features-to-main.mjs (+3 more)

### Community 18 - "Lopu Internal Feature Promotion Workflow"
Cohesion: 0.20
Nodes (10): actions/checkout v4.4.0, develop-pr-preview-controller event, Publish or reconcile develop S3 preview job, .github/scripts/deploy-develop-pr-preview.mjs, Dispatch trusted default-branch controller job, GitHub repository dispatch API, VERCEL_DEVELOP_DEPLOY_TOKEN, vercel-develop-pr-control environment (+2 more)

### Community 19 - "start.sh"
Cohesion: 0.22
Nodes (9): CHANGELOG.md, electron-pr-release.yml, .github/actions Composite Actions, github-actions CI Control Plane, .github/scripts Automation, .github/workflows Workflow Implementations, vercel.json Git Deployment Kill Switch, workflow-caller-contract.mjs (+1 more)

### Community 20 - "Publish or reconcile develop S3 preview job"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 21 - "classify-claude-credential-failure.mjs"
Cohesion: 0.29
Nodes (7): Build Signed And Notarized Electron Release Step, Derive SemVer PR Release Identity Step, Import Developer ID And Notarization Credentials Step, Publish Prerelease Step, Build And Publish Signed PR Release Job, Resolve And Validate PR Source Step, Signed Electron PR Release Workflow

### Community 22 - "Post-merge Graphify Refresh"
Cohesion: 0.48
Nodes (6): CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest()

### Community 23 - "start.sh"
Cohesion: 0.33
Nodes (7): buildPromotionDispatchRequest(), dispatchPromotionResolution(), exactReservationDeleteArgs(), exactReservationPushArgs(), promotionDispatchArgs(), queueTrustedPromotionWorker(), redispatchPromotionReservation()

### Community 24 - "Build And Publish Signed PR Release Job"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 25 - "queueTrustedPromotionWorker"
Cohesion: 0.33
Nodes (5): Added, Changed, Control-plane changelog, Fixed, [Unreleased]

### Community 26 - "verify-promotion-source-authority.sh"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 27 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.50
Nodes (4): assertSignedPrReleaseContract(), count(), here, workflow

### Community 28 - "vercel.json"
Cohesion: 0.50
Nodes (4): CodeQL PR Handoff, gh workflow run codeql-analysis.yml, Lopu Queues Unprivileged PR Scan Job, Lopu CodeQL PR Handoff Workflow

### Community 29 - "electron-pr-release-contract.mjs"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 30 - "Community 30"
Cohesion: 0.67
Nodes (3): AGENTS.md Symlink, AI_ALL.md Canonical AI Instructions, CLAUDE.md Symlink

### Community 53 - "Community 53"
Cohesion: 0.26
Nodes (12): attestationMatches(), createPromotionReviewCheckpoint(), exactCheckpointPush(), inspectPromotionReviewCheckpoint(), isObjectId(), latestBotPromotionAttestationEvents(), liveRefShaWithActionsToken(), parsePromotionResolutionAttestations() (+4 more)

## Knowledge Gaps
- **173 isolated node(s):** `BASE_BRANCHES`, `MERGE_CONFIG`, `CAPACITY_PATTERNS`, `CREDENTIAL_PATTERNS`, `TRUSTED_ASSOCIATIONS` (+168 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **22 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `selfTest()` connect `build-all-branch.mjs` to `failureDetail`, `workflow-control-plane-contract.mjs`, `refresh-promotion-graphify.sh`, `Community 53`, `start.sh`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **What connects `BASE_BRANCHES`, `MERGE_CONFIG`, `CAPACITY_PATTERNS` to the rest of the system?**
  _173 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `deploy-develop-pr-preview.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.06332842415316642 - nodes in this community are weakly interconnected._
- **Should `promotion-pr-changelog.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.14126984126984127 - nodes in this community are weakly interconnected._
- **Should `build-all-branch.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.0989247311827957 - nodes in this community are weakly interconnected._
- **Should `runPromotion` be split into smaller, more focused modules?**
  _Cohesion score 0.07258064516129033 - nodes in this community are weakly interconnected._
- **Should `failureDetail` be split into smaller, more focused modules?**
  _Cohesion score 0.12554112554112554 - nodes in this community are weakly interconnected._