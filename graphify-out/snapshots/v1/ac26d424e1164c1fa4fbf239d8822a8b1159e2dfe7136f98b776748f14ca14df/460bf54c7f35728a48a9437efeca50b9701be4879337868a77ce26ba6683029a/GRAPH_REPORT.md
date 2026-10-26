# Graph Report - thingtime  (2026-10-26)

## Corpus Check
- 92 files · ~250,673 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 4, .jq 1)

## Summary
- 1191 nodes · 2999 edges · 58 communities (54 shown, 4 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 20 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9ff9d033`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- promote-features-to-main.mjs
- graphify-cas.mjs
- deploy-admin-pr-previews.mjs
- Control-plane changelog
- lopu-model-waterfall.mjs
- deploy-vercel-prebuilt.mjs
- promotion-pr-changelog.mjs
- build-all-branch.mjs
- lopu-cooperative-review.mjs
- deploy-develop-pr-preview.mjs
- `github-actions` — the CI control plane
- resolve-pr-conflicts-routing-contract.mjs
- lopu-pr-status.mjs
- workflow-control-plane-contract.mjs
- reconcile
- preview-fallback.mjs
- main
- refresh-promotion-graphify.sh
- codeql-open-pr-backfill.mjs
- runSelfTest
- ref_node_fs
- extract-vercel-prebuilt.py
- ref_node_child_process
- lopu-pr-lifecycle.mjs
- merge-main-develop-sync-pr.mjs
- promotion-worker-contract.sh
- feature-stack-waterfall.test.mjs
- rebase-related-edits.test.mjs
- prepare-round.sh
- promotion-worker.sh
- preview-labels.mjs
- promotion-worker-routing-contract.mjs
- feature-stack-progress.mjs
- Thingtime AI instructions
- Thingtime AI instructions
- stage-graphify-snapshots.mjs
- control-plane-events.test.mjs
- ref_node_url
- preview-recovery.test.mjs
- start.sh
- deploymentDetail
- verify-promotion-source-authority.sh
- PR #609 — Restore Lopu and preview admission
- cleanupPrResources
- requestJson
- electron-release-gates.test.mjs
- ref_node_crypto
- PR #506 — Auto-merge resolved main to develop sync PR
- PR #603 — Admin preview publisher controller
- vercel.json
- PR #492 — Load Lopu credentials from the Thingtime vault
- PR #534 — Feature Stack progress heartbeat controller
- rebase-ownership-routing-contract.sh
- resolve-canonical-instruction-type-conflicts.sh
- 1225-codex-gateway-publisher-policy-publish-controlled-environment-gateway-owners.md
- 781-codex-stack-progress-chat-controller-answer-feature-stack-status-questions.md
- codex-gateway-alias-propagation-standard-preview-target.md

## God Nodes (most connected - your core abstractions)
1. `runPromotion()` - 64 edges
2. `selfTest()` - 53 edges
3. `runSelfTest()` - 52 edges
4. `reconcile()` - 35 edges
5. `failureDetail()` - 28 edges
6. `deploy()` - 27 edges
7. `main()` - 22 edges
8. `publish()` - 21 edges
9. `orphanedMergeHydrationIntegrationTest()` - 21 edges
10. `githubRequest()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `publishAdminStatus()` --calls--> `syncPreviewLabels()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/preview-labels.mjs
- `cleanupEnvironment()` --calls--> `syncPreviewLabels()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/preview-labels.mjs
- `deployEnvironment()` --calls--> `verifyPublishedPreview()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/preview-fallback.mjs
- `deployEnvironment()` --calls--> `deploymentBuiltAt()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/preview-labels.mjs
- `prGatewayPolicy()` --calls--> `gatewayPolicy()`  [EXTRACTED]
  .github/scripts/deploy-develop-pr-preview.mjs → .github/scripts/environment-gateway-policy.mjs

## Import Cycles
- None detected.

## Communities (58 total, 4 thin omitted)

### Community 0 - "promote-features-to-main.mjs"
Cohesion: 0.05
Nodes (130): applyPicks(), attestationMatches(), botCommentsByLatestEvent(), buildPromotionDispatchRequest(), buildPromotionPlanContext(), cancelPromotionRetirement(), CFG, checkoutRemoteBranch() (+122 more)

### Community 1 - "graphify-cas.mjs"
Cohesion: 0.09
Nodes (60): activateSnapshot(), artifactHash(), baselineNodeCount(), compareSnapshotQuality(), computeSourceFingerprint(), copyPortableFiles(), DEFAULT_SNAPSHOT_RETENTION, dropNestedRepositories() (+52 more)

### Community 2 - "deploy-admin-pr-previews.mjs"
Cohesion: 0.08
Nodes (62): ACTIVE_STATES, assertCurrentPullRequest(), assertPrebuiltOutput(), assignAlias(), boundedInteger(), cleanupDeploymentIssue(), cleanupEnvironment(), commentBody() (+54 more)

### Community 3 - "Control-plane changelog"
Cohesion: 0.04
Nodes (38): 2026-09-05 — Cooperative review handover and preview recovery, 2026-09-05 — Desktop and Recovery cloud release repair, 2026-09-05 — Signed Commander releases and Recovery pairing, 2026-09-05 — Visible previews and conflict detector recovery, 2026-10-18 — Correct reusable workflow context, 2026-10-18 — Diagnose OpenAI preflight failures safely, 2026-10-18 — Execute the saved admin AI waterfall, 2026-10-23 — Build every Vercel deployment on GitHub Actions (+30 more)

### Community 4 - "lopu-model-waterfall.mjs"
Cohesion: 0.12
Nodes (37): models, CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest(), exportBundle() (+29 more)

### Community 5 - "deploy-vercel-prebuilt.mjs"
Cohesion: 0.15
Nodes (37): applyOutputPolicy(), visit(), compatibilityAliasCandidates(), context(), deploymentArgs(), deploymentIssue(), exec, existing() (+29 more)

### Community 6 - "promotion-pr-changelog.mjs"
Cohesion: 0.13
Nodes (38): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+30 more)

### Community 7 - "build-all-branch.mjs"
Cohesion: 0.16
Nodes (36): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), completeRefspecs, countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode() (+28 more)

### Community 8 - "lopu-cooperative-review.mjs"
Cohesion: 0.11
Nodes (28): checkpoint(), completedReport(), continuationNumbers(), finalize(), git(), HANDOVER_INSTRUCTIONS, initialize(), numbers() (+20 more)

### Community 9 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.09
Nodes (34): ACTIVE_STATES, assertCustomDevelopEnvironment(), assertPrebuiltOutput(), assertPreviewMaster(), assertVercelConfiguration(), assertWildcardFallbackRuntimes(), CLEANUP_ACTIONS, customEnvironmentDomainNames() (+26 more)

### Community 10 - "`github-actions` — the CI control plane"
Cohesion: 0.06
Nodes (33): Configured cross-provider waterfall, Control-plane regression checklist, Cooperative review handover, Environment gateway publication, Event feedback and CI cancellation, Exact configured workflow model orders, Existing workflow preflight verification, Explicit stack model and endpoint waterfall (+25 more)

### Community 11 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.13
Nodes (26): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertCapturedStdoutStaysClean(), assertRoute(), assertWorkflowSource(), CALLS_HELPER(), decodeBatch() (+18 more)

### Community 12 - "lopu-pr-status.mjs"
Cohesion: 0.17
Nodes (25): argument(), branchCode(), classifyInventory(), count(), dateParts(), desiredFactLabels(), escapeHtml(), FACT_LABEL_ORDER (+17 more)

### Community 13 - "workflow-control-plane-contract.mjs"
Cohesion: 0.13
Nodes (26): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertAdminWaterfallGrammar(), assertBareControlPlaneTree() (+18 more)

### Community 14 - "reconcile"
Cohesion: 0.19
Nodes (26): assertNoProtectedAlias(), assignAliasVerified(), cleanupComment(), createGithubDeployment(), dashboardUrl(), deploy(), deploymentComment(), deploymentUrl() (+18 more)

### Community 15 - "preview-fallback.mjs"
Cohesion: 0.14
Nodes (19): FALLBACK_BRANCH, FALLBACK_HEADER, FALLBACK_MARKER, fallbackDeploymentIssue(), fallbackDomainIssue(), fallbackPage(), fallbackResponseIssue(), installFallbackAliases() (+11 more)

### Community 16 - "main"
Cohesion: 0.17
Nodes (24): assertCurrentPullRequest(), assertPreviewBundle(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack(), boundedInteger(), dispatchPullRequestIssue() (+16 more)

### Community 17 - "refresh-promotion-graphify.sh"
Cohesion: 0.14
Nodes (24): assert_control_metadata_unchanged(), assert_tool_boundary(), current_grafts_state(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT (+16 more)

### Community 18 - "codeql-open-pr-backfill.mjs"
Cohesion: 0.21
Nodes (23): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), analysisSnapshotForPullRequest(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp() (+15 more)

### Community 19 - "runSelfTest"
Cohesion: 0.18
Nodes (23): choosePreferredDeployment(), chooseStableDevelopDeployment(), classifyPullRequest(), createVercelDeployment(), deploymentIdentityIssue(), deploymentMetadata(), deployPrebuiltOutput(), guardPreviewUpload() (+15 more)

### Community 20 - "ref_node_fs"
Cohesion: 0.13
Nodes (9): assertPrReleaseContract(), count(), here, workflow, postPublishRefRace(), snapshot, previewSummaryBody(), publishPreviewSummary() (+1 more)

### Community 21 - "extract-vercel-prebuilt.py"
Cohesion: 0.19
Nodes (5): extract_archive(), main(), _member_path(), self_test(), _validate_link()

### Community 22 - "ref_node_child_process"
Cohesion: 0.18
Nodes (8): allowed, workflow, answerCommand(), answerQuestion(), CHAT_SYSTEM_PROMPT, safeRunContext(), serveRunChat(), script

### Community 23 - "lopu-pr-lifecycle.mjs"
Cohesion: 0.20
Nodes (16): approved(), eligible(), identity(), managed(), pauses, redundant(), selectPulls(), settle() (+8 more)

### Community 24 - "merge-main-develop-sync-pr.mjs"
Cohesion: 0.22
Nodes (15): assertHeadContainsMain(), assertSyncPullRequestShape(), exactSha(), EXPECTED_MERGE_REJECTIONS, githubRequest(), GitHubRequestError, headContainsMain(), mergeStandingSyncPullRequest() (+7 more)

### Community 25 - "promotion-worker-contract.sh"
Cohesion: 0.14
Nodes (17): BASE_REF, BASE_SHA, compute_plan_hash(), GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay() (+9 more)

### Community 26 - "feature-stack-waterfall.test.mjs"
Cohesion: 0.32
Nodes (14): canonicalFeatureStackPlan(), decodeFeatureStackPlan(), exactKeys(), featureStackId(), git(), selfTest(), validateWaterfall(), verifyFeatureStackHistory() (+6 more)

### Community 27 - "rebase-related-edits.test.mjs"
Cohesion: 0.28
Nodes (14): actionPath, copyTrustedTree(), extractVerifierScript(), filesUnder(), hashNamedFiles(), hashRebaseState(), hashTrustedTree(), makeStoppedRebase() (+6 more)

### Community 28 - "prepare-round.sh"
Cohesion: 0.28
Nodes (14): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_index_entries(), hash_rebase_state(), rebase_in_progress() (+6 more)

### Community 29 - "promotion-worker.sh"
Cohesion: 0.37
Nodes (13): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+5 more)

### Community 30 - "preview-labels.mjs"
Cohesion: 0.24
Nodes (11): colors, ensureLabel(), hasPreviewLabels(), lanes, prefix(), previewBuildTime(), previewBuiltLabel(), syncOnce() (+3 more)

### Community 31 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.14
Nodes (13): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, featureStackMergeIf, featureStackMergeJob, graphify, lopuAgent (+5 more)

### Community 32 - "feature-stack-progress.mjs"
Cohesion: 0.27
Nodes (12): githubJobs(), githubStackPullRequests(), postProgress(), progressSnapshot(), reconcile(), recoveryPayload(), run(), selfTest() (+4 more)

### Community 33 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 34 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 35 - "stage-graphify-snapshots.mjs"
Cohesion: 0.36
Nodes (11): addExisting(), filesUnder(), git(), LEGACY_ROOT, missingFromWorktree(), PORTABLE, removeFromIndex(), restoreTrackedFromHead() (+3 more)

### Community 36 - "control-plane-events.test.mjs"
Cohesion: 0.31
Nodes (5): ci, workflow, classifyConversation(), classifyQueuedConversation(), hasAutomationMarker()

### Community 37 - "ref_node_url"
Cohesion: 0.29
Nodes (6): checkDisposition(), publishMerge(), baseSha, fixture(), head, success

### Community 38 - "preview-recovery.test.mjs"
Cohesion: 0.39
Nodes (6): previewWorkActive(), reconcilePreviewInventory(), recoveryAttempt(), recoverySourceIssue(), now, source

### Community 39 - "start.sh"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 40 - "deploymentDetail"
Cohesion: 0.33
Nodes (7): deploymentDetail(), deploymentListParams(), listDeploymentSummaries(), listStableDevelopDeployments(), listWorkflowDeployments(), refreshOwnedDeployment(), waitForDeployment()

### Community 41 - "verify-promotion-source-authority.sh"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 42 - "PR #609 — Restore Lopu and preview admission"
Cohesion: 0.29
Nodes (6): Follow-up acceptance repair, Live diagnosis, Outcome, PR #609 — Restore Lopu and preview admission, Security boundary, Validation

### Community 43 - "cleanupPrResources"
Cohesion: 0.40
Nodes (6): cancelAndDeleteDeployment(), cleanupDeployments(), cleanupPrResources(), headHasPreviewBundle(), removeAliasForPr(), request()

### Community 44 - "requestJson"
Cohesion: 0.33
Nodes (5): HttpError, isRetryableHttpResponse(), parseErrorCode(), requestJson(), retryDelayMs()

### Community 45 - "electron-release-gates.test.mjs"
Cohesion: 0.40
Nodes (5): allowed(), evaluate, expression, main, workflow

### Community 46 - "ref_node_crypto"
Cohesion: 0.60
Nodes (4): rawIndexHash(), runGit(), semanticIndexHash(), sha256()

### Community 47 - "PR #506 — Auto-merge resolved main to develop sync PR"
Cohesion: 0.33
Nodes (5): Operational proof gate, PR #506 — Auto-merge resolved main to develop sync PR, Problem, Resolution, Validation

### Community 48 - "PR #603 — Admin preview publisher controller"
Cohesion: 0.33
Nodes (5): Compatibility fix, Outcome, PR #603 — Admin preview publisher controller, Security boundary, Validation

### Community 49 - "vercel.json"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 50 - "PR #492 — Load Lopu credentials from the Thingtime vault"
Cohesion: 0.40
Nodes (4): PR #492 — Load Lopu credentials from the Thingtime vault, Safety and regression focus, Scope, Validation log

### Community 51 - "PR #534 — Feature Stack progress heartbeat controller"
Cohesion: 0.40
Nodes (4): Outcome, PR #534 — Feature Stack progress heartbeat controller, Safety and cost, Validation

### Community 52 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 53 - "resolve-canonical-instruction-type-conflicts.sh"
Cohesion: 0.83
Nodes (3): resolve-canonical-instruction-type-conflicts.sh script, stage_record(), tree_record()

## Knowledge Gaps
- **28 isolated node(s):** `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR`, `BASE_REF`, `BASE_SHA` (+23 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 312 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `selfTest()` connect `promote-features-to-main.mjs` to `ref_node_fs`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR` to the rest of the system?**
  _28 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `promote-features-to-main.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05194805194805195 - nodes in this community are weakly interconnected._
- **Why does `syncPreviewLabels()` connect `reconcile` to `deploy-develop-pr-preview.mjs`, `deploy-admin-pr-previews.mjs`, `preview-labels.mjs`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Should `graphify-cas.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.08735733099209833 - nodes in this community are weakly interconnected._
- **Should `deploy-admin-pr-previews.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.08231569425599276 - nodes in this community are weakly interconnected._
- **Should `Control-plane changelog` be split into smaller, more focused modules?**
  _Cohesion score 0.044444444444444446 - nodes in this community are weakly interconnected._