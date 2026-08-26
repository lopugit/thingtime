# Graph Report - .  (2026-08-26)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 365 nodes · 649 edges · 44 communities (25 shown, 19 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 7 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5d29587f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_deploy-develop-pr-preview.mjs|deploy-develop-pr-preview.mjs]]
- [[_COMMUNITY_promotion-pr-changelog.mjs|promotion-pr-changelog.mjs]]
- [[_COMMUNITY_selfTest|selfTest]]
- [[_COMMUNITY_build-all-branch.mjs|build-all-branch.mjs]]
- [[_COMMUNITY_promote-features-to-main.mjs|promote-features-to-main.mjs]]
- [[_COMMUNITY_runPromotion|runPromotion]]
- [[_COMMUNITY_failureDetail|failureDetail]]
- [[_COMMUNITY_workflow-control-plane-contract.mjs|workflow-control-plane-contract.mjs]]
- [[_COMMUNITY_refresh-promotion-graphify.sh|refresh-promotion-graphify.sh]]
- [[_COMMUNITY_Rebuild Job|Rebuild Job]]
- [[_COMMUNITY_codeql-open-pr-backfill.mjs|codeql-open-pr-backfill.mjs]]
- [[_COMMUNITY_promotion-worker-contract.sh|promotion-worker-contract.sh]]
- [[_COMMUNITY_promotion-worker.sh|promotion-worker.sh]]
- [[_COMMUNITY_resolve-pr-conflicts-routing-contract.mjs|resolve-pr-conflicts-routing-contract.mjs]]
- [[_COMMUNITY_prepare-round.sh|prepare-round.sh]]
- [[_COMMUNITY_promotion-worker-routing-contract.mjs|promotion-worker-routing-contract.mjs]]
- [[_COMMUNITY_Graphify Semantic Refresh|Graphify Semantic Refresh]]
- [[_COMMUNITY_Run Lopu with Primary Claude Credential|Run Lopu with Primary Claude Credential]]
- [[_COMMUNITY_Publish or reconcile develop S3 preview job|Publish or reconcile develop S3 preview job]]
- [[_COMMUNITY_`github-actions` — the CI control plane|`github-actions` — the CI control plane]]
- [[_COMMUNITY_start.sh|start.sh]]
- [[_COMMUNITY_Lopu PR Manager|Lopu PR Manager]]
- [[_COMMUNITY_classify-claude-credential-failure.mjs|classify-claude-credential-failure.mjs]]
- [[_COMMUNITY_queueTrustedPromotionWorker|queueTrustedPromotionWorker]]
- [[_COMMUNITY_verify-promotion-source-authority.sh|verify-promotion-source-authority.sh]]
- [[_COMMUNITY_detect job|detect job]]
- [[_COMMUNITY_vercel.json|vercel.json]]
- [[_COMMUNITY_electron-pr-release-contract.mjs|electron-pr-release-contract.mjs]]
- [[_COMMUNITY_rebase-ownership-routing-contract.sh|rebase-ownership-routing-contract.sh]]
- [[_COMMUNITY_Lopu Queues Unprivileged PR Scan Job|Lopu Queues Unprivileged PR Scan Job]]
- [[_COMMUNITY_STACK_MEMBER_JQ|STACK_MEMBER_JQ]]
- [[_COMMUNITY_Lopu Build Doctor Round 1|Lopu Build Doctor Round 1]]
- [[_COMMUNITY_Web CI Workflow|Web CI Workflow]]
- [[_COMMUNITY_Safe Main into Develop Sync PR|Safe Main into Develop Sync PR]]
- [[_COMMUNITY_Promotion PR Changelog Script|Promotion PR Changelog Script]]
- [[_COMMUNITY_Route CI Compute Provider Workflow|Route CI Compute Provider Workflow]]
- [[_COMMUNITY_Electron App Release Workflow|Electron App Release Workflow]]
- [[_COMMUNITY_Graphify CLI|Graphify CLI]]
- [[_COMMUNITY_Lopu Agent Action|Lopu Agent Action]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_Thingtime AI Instructions|Thingtime AI Instructions]]
- [[_COMMUNITY_AI_ALL.md canonical instructions|AI_ALL.md canonical instructions]]
- [[_COMMUNITY_Graphify Rules|Graphify Rules]]
- [[_COMMUNITY_Fundamentals|Fundamentals]]

## God Nodes (most connected - your core abstractions)
1. `deploy()` - 26 edges
2. `runSelfTest()` - 24 edges
3. `main()` - 15 edges
4. `githubRequest()` - 14 edges
5. `boundedInteger()` - 13 edges
6. `vercelRequest()` - 13 edges
7. `main()` - 12 edges
8. `Lopu PR manager (conflict resolver)` - 12 edges
9. `reconcile()` - 11 edges
10. `Thingtime AI Instructions` - 11 edges

## Surprising Connections (you probably didn't know these)
- `Web CI Workflow` --references--> `Testing Checklist`  [INFERRED]
  .github/workflows/web-ci.yml → TESTING.md
- `rebuild job (build and repair the all branch)` --references--> `Post-merge graphify refresh`  [AMBIGUOUS]
  .github/workflows/all-branch.yml → .github/workflows/resolve-pr-conflicts.yml
- `Lopu CodeQL all branches` --conceptually_related_to--> `Lopu PR manager (conflict resolver)`  [INFERRED]
  .github/workflows/codeql-analysis.yml → .github/workflows/resolve-pr-conflicts.yml
- `Lopu rebase engine` --references--> `Lopu rebase conflict round (composite action)`  [INFERRED]
  .github/workflows/rebase-pr-stacks.yml → .github/actions/rebase-conflict-round/action.yml
- `Lopu internal all-branch integration` --conceptually_related_to--> `Lopu PR manager (conflict resolver)`  [EXTRACTED]
  .github/workflows/all-branch.yml → .github/workflows/resolve-pr-conflicts.yml

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Lopu Repository Management Lanes** — changelog_lopu_pr_manager, changelog_codeql_coverage, changelog_promotion_recovery, changelog_rebase_stack_recovery, changelog_all_branch_doctor [EXTRACTED 0.90]
- **Automations that delegate work to the shared Lopu agent action** — github_actions_rebase_conflict_round_action_lopu_step, github_workflows_all_branch_doctor1, github_workflows_all_branch_doctor2, github_actions_lopu_agent_action_lopu_agent, github_workflows_resolve_pr_conflicts_lopu_pr_manager [EXTRACTED 0.85]
- **develop → main promotion and back-sync flow** — github_workflows_promote_develop_to_main_lopu_internal_develop_promotion, github_workflows_promote_features_to_main_lopu_internal_feature_promotion, github_workflows_sync_main_into_develop_sync_main_into_develop, github_scripts_promotion_pr_changelog_promotion_pr_changelog, github_scripts_promote_features_to_main_promote_features_to_main [EXTRACTED 0.85]
- **Bounded rebase conflict round: bootstrap → prepare → model → verify** — github_actions_rebase_conflict_round_action_bootstrap, github_actions_rebase_conflict_round_action_prepare, github_actions_rebase_conflict_round_action_lopu_step, github_actions_rebase_conflict_round_action_claude_session_continue, github_actions_rebase_conflict_round_action_verify, github_scripts_rebase_stack_prepare_round_prepare_round [EXTRACTED 0.90]
- **Develop PR Preview Controller Flow** — github_workflows_develop_pr_preview_workflow, github_workflows_develop_pr_preview_dispatch_job, github_workflows_develop_pr_preview_repository_dispatch, github_workflows_develop_pr_preview_controller_event, github_workflows_develop_pr_preview_controller_job, github_workflows_develop_pr_preview_deploy_script [EXTRACTED 0.95]
- **Canonical AI Instruction Files** — agents_thingtime_ai_instructions, ai_all_thingtime_ai_instructions, claude_thingtime_ai_instructions [EXTRACTED 0.95]

## Communities (44 total, 19 thin omitted)

### Community 0 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.08
Nodes (29): Lopu agent composite action, Mark the credentialed AI attempt, Copy trusted round code outside the model workspace, Continue the exact Claude session until it finishes, Lopu rebase conflict round (composite action), Resolve this rebase conflict set with Lopu in scratch, Validate conflicts and create repo-less scratch, Verify and continue the rebase (+21 more)

### Community 1 - "promotion-pr-changelog.mjs"
Cohesion: 0.13
Nodes (25): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertBareControlPlaneTree(), assertControlPlaneContract() (+17 more)

### Community 2 - "selfTest"
Cohesion: 0.12
Nodes (21): assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT, GIT_CONFIG_GLOBAL (+13 more)

### Community 3 - "build-all-branch.mjs"
Cohesion: 0.16
Nodes (23): assertCurrentPullRequest(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), classifyPullRequest(), customEnvironmentDomainNames(), deploymentPayload() (+15 more)

### Community 4 - "promote-features-to-main.mjs"
Cohesion: 0.14
Nodes (21): ACTIVE_STATES, assertWildcardFallbackRuntimes(), CLEANUP_ACTIONS, exactPrefixedId(), IDEMPOTENT_METHODS, isHostnameLabel(), isS3BucketHostname(), normalizedDnsHostname() (+13 more)

### Community 5 - "runPromotion"
Cohesion: 0.20
Nodes (21): assignAliasVerified(), cancelAndDeleteDeployment(), choosePreferredDeployment(), cleanupDeployments(), cleanupPrResources(), createVercelDeployment(), deploymentDetail(), deploymentIdentityIssue() (+13 more)

### Community 6 - "failureDetail"
Cohesion: 0.25
Nodes (19): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp(), flattenWorkflowRuns() (+11 more)

### Community 7 - "workflow-control-plane-contract.mjs"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay(), RESERVATION_SHA (+8 more)

### Community 8 - "refresh-promotion-graphify.sh"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 9 - "Rebuild Job"
Cohesion: 0.22
Nodes (14): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertRoute(), assertWorkflowSource(), LOPU_ACTION_URL, positiveDecimal(), REBASE_ACTION_URL (+6 more)

### Community 10 - "codeql-open-pr-backfill.mjs"
Cohesion: 0.27
Nodes (13): boundedInteger(), cleanupComment(), dashboardUrl(), deploy(), deploymentComment(), deploymentUrl(), handleIneligible(), markGithubEnvironmentInactive() (+5 more)

### Community 11 - "promotion-worker-contract.sh"
Cohesion: 0.17
Nodes (11): Thingtime AI Instructions, Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify (+3 more)

### Community 12 - "promotion-worker.sh"
Cohesion: 0.17
Nodes (11): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, graphify, lopuAgent, mainDevelopSyncWorkflow, promoter (+3 more)

### Community 13 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.22
Nodes (10): ai-merge-paused Stop Label, All-branch Doctor, CodeQL Coverage and Triage, Control-plane Changelog, Graphify Semantic Refresh, LOPU_AGENT_BACKEND Selector, Lopu PR Manager, Partial Clone Hydration Recovery (+2 more)

### Community 14 - "prepare-round.sh"
Cohesion: 0.20
Nodes (10): actions/checkout v4.4.0, develop-pr-preview-controller event, Publish or reconcile develop S3 preview job, .github/scripts/deploy-develop-pr-preview.mjs, Dispatch trusted default-branch controller job, GitHub repository dispatch API, VERCEL_DEVELOP_DEPLOY_TOKEN, vercel-develop-pr-control environment (+2 more)

### Community 15 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.20
Nodes (9): Fork setup: Vercel develop previews, github-actions CI Control Plane, Known trade-off, Lopu principal repository manager, Signed desktop PR releases, Stable develop domain, The bare-tree invariant, Why it is bare (+1 more)

### Community 16 - "Graphify Semantic Refresh"
Cohesion: 0.39
Nodes (8): assertVercelConfiguration(), assignStableDevelopAliasVerified(), chooseStableDevelopDeployment(), getDevelopHeadSha(), getStableDevelopAliasBinding(), reconcileStableDevelopAlias(), stableDevelopDeploymentIssue(), verifyPublishedAlias()

### Community 17 - "Run Lopu with Primary Claude Credential"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 18 - "Publish or reconcile develop S3 preview job"
Cohesion: 0.48
Nodes (6): CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest()

### Community 19 - "`github-actions` — the CI control plane"
Cohesion: 0.33
Nodes (7): createGithubDeployment(), findGithubDeployment(), getRepositoryPermission(), githubRequest(), githubUrl(), parseErrorCode(), requestJson()

### Community 20 - "start.sh"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 21 - "Lopu PR Manager"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 22 - "classify-claude-credential-failure.mjs"
Cohesion: 0.50
Nodes (4): assertPrReleaseContract(), count(), here, workflow

### Community 23 - "queueTrustedPromotionWorker"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 24 - "verify-promotion-source-authority.sh"
Cohesion: 1.00
Nodes (3): detect job (find stack members needing rebase), REBASE_OWNER_JQ ownership expression, STACK_MEMBER_JQ topology expression

## Ambiguous Edges - Review These
- `rebuild job (build and repair the all branch)` → `Post-merge graphify refresh`  [AMBIGUOUS]
  .github/workflows/all-branch.yml · relation: references

## Knowledge Gaps
- **126 isolated node(s):** `CAPACITY_PATTERNS`, `CREDENTIAL_PATTERNS`, `REQUIRED_CATEGORIES`, `ACTIVE_RUN_STATUSES`, `TRUSTED_ASSOCIATIONS` (+121 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `rebuild job (build and repair the all branch)` and `Post-merge graphify refresh`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What connects `CAPACITY_PATTERNS`, `CREDENTIAL_PATTERNS`, `REQUIRED_CATEGORIES` to the rest of the system?**
  _126 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `deploy-develop-pr-preview.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.07575757575757576 - nodes in this community are weakly interconnected._
- **Should `promotion-pr-changelog.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.13230769230769232 - nodes in this community are weakly interconnected._
- **Should `selfTest` be split into smaller, more focused modules?**
  _Cohesion score 0.12333333333333334 - nodes in this community are weakly interconnected._
- **Should `promote-features-to-main.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._
- **Should `workflow-control-plane-contract.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.12418300653594772 - nodes in this community are weakly interconnected._