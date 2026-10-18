# Graph Report - thingtime  (2026-10-18)

## Corpus Check
- 86 files · ~238,483 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 4, .jq 1)

## Summary
- 1121 nodes · 2787 edges · 54 communities (51 shown, 3 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 20 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c054e192`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- promote-features-to-main.mjs
- deploy-develop-pr-preview.mjs
- deploy-admin-pr-previews.mjs
- graphify-cas.mjs
- promotion-pr-changelog.mjs
- build-all-branch.mjs
- lopu-cooperative-review.mjs
- lopu-model-waterfall.mjs
- resolve-pr-conflicts-routing-contract.mjs
- lopu-pr-status.mjs
- workflow-control-plane-contract.mjs
- refresh-promotion-graphify.sh
- codeql-open-pr-backfill.mjs
- preview-fallback.mjs
- ref_node_fs
- extract-vercel-prebuilt.py
- lopu-pr-lifecycle.mjs
- merge-main-develop-sync-pr.mjs
- promotion-worker-contract.sh
- feature-stack-waterfall.test.mjs
- `github-actions` — the CI control plane
- control-plane-events.test.mjs
- rebase-related-edits.test.mjs
- prepare-round.sh
- promotion-worker.sh
- promotion-worker-routing-contract.mjs
- feature-stack-progress.mjs
- Thingtime AI instructions
- Thingtime AI instructions
- stage-graphify-snapshots.mjs
- Control-plane regression checklist
- ref_node_url
- Control-plane changelog
- ref_node_child_process
- CHANGELOG.md
- start.sh
- classify-claude-credential-failure.mjs
- verify-promotion-source-authority.sh
- PR #609 — Restore Lopu and preview admission
- electron-release-gates.test.mjs
- ref_node_crypto
- PR #506 — Auto-merge resolved main to develop sync PR
- PR #603 — Admin preview publisher controller
- PR #634: Lopu comment admission and idempotent preview writes
- PR #637: Safe cooperative handover for Lopu reviews
- vercel.json
- PR #492 — Load Lopu credentials from the Thingtime vault
- PR #534 — Feature Stack progress heartbeat controller
- PR #642: Discoverable preview status and missed-build repair
- PR #643 — Missing-build page for unassigned PR preview URLs
- rebase-ownership-routing-contract.sh
- resolve-canonical-instruction-type-conflicts.sh
- 781-codex-stack-progress-chat-controller-answer-feature-stack-status-questions.md

## God Nodes (most connected - your core abstractions)
1. `runPromotion()` - 64 edges
2. `selfTest()` - 53 edges
3. `runSelfTest()` - 34 edges
4. `reconcile()` - 34 edges
5. `failureDetail()` - 28 edges
6. `deploy()` - 27 edges
7. `main()` - 22 edges
8. `orphanedMergeHydrationIntegrationTest()` - 21 edges
9. `githubRequest()` - 18 edges
10. `main()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `classify()` --calls--> `classifyClaudeCredentialFailure()`  [EXTRACTED]
  .github/scripts/lopu-model-waterfall.mjs → .github/scripts/classify-claude-credential-failure.mjs
- `deployEnvironment()` --calls--> `verifyPublishedPreview()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/preview-fallback.mjs
- `isManagedPreviewComment()` --calls--> `isManagedPreviewComment()`  [EXTRACTED]
  .github/scripts/deploy-develop-pr-preview.mjs → .github/scripts/preview-comments.mjs
- `upsertComment()` --calls--> `upsertPreviewComment()`  [EXTRACTED]
  .github/scripts/deploy-develop-pr-preview.mjs → .github/scripts/preview-comments.mjs
- `publishDevelopStatus()` --calls--> `publishPreviewNotifications()`  [EXTRACTED]
  .github/scripts/deploy-develop-pr-preview.mjs → .github/scripts/preview-comments.mjs

## Import Cycles
- None detected.

## Communities (54 total, 3 thin omitted)

### Community 0 - "promote-features-to-main.mjs"
Cohesion: 0.05
Nodes (130): applyPicks(), attestationMatches(), botCommentsByLatestEvent(), buildPromotionDispatchRequest(), buildPromotionPlanContext(), cancelPromotionRetirement(), CFG, checkoutRemoteBranch() (+122 more)

### Community 1 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.06
Nodes (116): ACTIVE_STATES, assertCurrentPullRequest(), assertPrebuiltOutput(), assertPreviewBundle(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack() (+108 more)

### Community 2 - "deploy-admin-pr-previews.mjs"
Cohesion: 0.06
Nodes (75): ACTIVE_STATES, assertCurrentPullRequest(), assertPrebuiltOutput(), assignAlias(), boundedInteger(), cleanupDeploymentIssue(), cleanupEnvironment(), commentBody() (+67 more)

### Community 3 - "graphify-cas.mjs"
Cohesion: 0.09
Nodes (60): activateSnapshot(), artifactHash(), baselineNodeCount(), compareSnapshotQuality(), computeSourceFingerprint(), copyPortableFiles(), DEFAULT_SNAPSHOT_RETENTION, dropNestedRepositories() (+52 more)

### Community 4 - "promotion-pr-changelog.mjs"
Cohesion: 0.13
Nodes (38): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+30 more)

### Community 5 - "build-all-branch.mjs"
Cohesion: 0.16
Nodes (36): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), completeRefspecs, countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode() (+28 more)

### Community 6 - "lopu-cooperative-review.mjs"
Cohesion: 0.11
Nodes (28): checkpoint(), completedReport(), continuationNumbers(), finalize(), git(), HANDOVER_INSTRUCTIONS, initialize(), numbers() (+20 more)

### Community 7 - "lopu-model-waterfall.mjs"
Cohesion: 0.15
Nodes (31): models, exportBundle(), fetchBundle(), legacyCredentials(), main(), required(), safeCache(), validate() (+23 more)

### Community 8 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.12
Nodes (26): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertCapturedStdoutStaysClean(), assertRoute(), assertWorkflowSource(), CALLS_HELPER(), decodeBatch() (+18 more)

### Community 9 - "lopu-pr-status.mjs"
Cohesion: 0.17
Nodes (25): argument(), branchCode(), classifyInventory(), count(), dateParts(), desiredFactLabels(), escapeHtml(), FACT_LABEL_ORDER (+17 more)

### Community 10 - "workflow-control-plane-contract.mjs"
Cohesion: 0.13
Nodes (26): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertAdminWaterfallGrammar(), assertBareControlPlaneTree() (+18 more)

### Community 11 - "refresh-promotion-graphify.sh"
Cohesion: 0.14
Nodes (24): assert_control_metadata_unchanged(), assert_tool_boundary(), current_grafts_state(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT (+16 more)

### Community 12 - "codeql-open-pr-backfill.mjs"
Cohesion: 0.21
Nodes (23): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), analysisSnapshotForPullRequest(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp() (+15 more)

### Community 13 - "preview-fallback.mjs"
Cohesion: 0.16
Nodes (19): FALLBACK_BRANCH, FALLBACK_HEADER, FALLBACK_MARKER, fallbackDeploymentIssue(), fallbackDomainIssue(), fallbackPage(), fallbackResponseIssue(), installFallbackAliases() (+11 more)

### Community 14 - "ref_node_fs"
Cohesion: 0.14
Nodes (9): allowed, workflow, answerCommand(), answerQuestion(), CHAT_SYSTEM_PROMPT, safeRunContext(), serveRunChat(), script (+1 more)

### Community 15 - "extract-vercel-prebuilt.py"
Cohesion: 0.19
Nodes (5): extract_archive(), main(), _member_path(), self_test(), _validate_link()

### Community 16 - "lopu-pr-lifecycle.mjs"
Cohesion: 0.20
Nodes (16): approved(), eligible(), identity(), managed(), pauses, redundant(), selectPulls(), settle() (+8 more)

### Community 17 - "merge-main-develop-sync-pr.mjs"
Cohesion: 0.22
Nodes (15): assertHeadContainsMain(), assertSyncPullRequestShape(), exactSha(), EXPECTED_MERGE_REJECTIONS, githubRequest(), GitHubRequestError, headContainsMain(), mergeStandingSyncPullRequest() (+7 more)

### Community 18 - "promotion-worker-contract.sh"
Cohesion: 0.14
Nodes (17): BASE_REF, BASE_SHA, compute_plan_hash(), GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay() (+9 more)

### Community 19 - "feature-stack-waterfall.test.mjs"
Cohesion: 0.32
Nodes (14): canonicalFeatureStackPlan(), decodeFeatureStackPlan(), exactKeys(), featureStackId(), git(), selfTest(), validateWaterfall(), verifyFeatureStackHistory() (+6 more)

### Community 20 - "`github-actions` — the CI control plane"
Cohesion: 0.12
Nodes (16): Commander signed releases, Desktop and Recovery release pipeline, Discoverable preview status and recovery, Fork setup: Vercel develop previews, `github-actions` — the CI control plane, Known trade-off, Lopu principal repository manager, macOS signing and build identity (+8 more)

### Community 21 - "control-plane-events.test.mjs"
Cohesion: 0.21
Nodes (7): ci, workflow, classifyConversation(), classifyQueuedConversation(), hasAutomationMarker(), previewSummaryBody(), publishPreviewSummary()

### Community 22 - "rebase-related-edits.test.mjs"
Cohesion: 0.28
Nodes (14): actionPath, copyTrustedTree(), extractVerifierScript(), filesUnder(), hashNamedFiles(), hashRebaseState(), hashTrustedTree(), makeStoppedRebase() (+6 more)

### Community 23 - "prepare-round.sh"
Cohesion: 0.28
Nodes (14): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_index_entries(), hash_rebase_state(), rebase_in_progress() (+6 more)

### Community 24 - "promotion-worker.sh"
Cohesion: 0.37
Nodes (13): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+5 more)

### Community 25 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.14
Nodes (13): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, featureStackMergeIf, featureStackMergeJob, graphify, lopuAgent (+5 more)

### Community 26 - "feature-stack-progress.mjs"
Cohesion: 0.27
Nodes (12): githubJobs(), githubStackPullRequests(), postProgress(), progressSnapshot(), reconcile(), recoveryPayload(), run(), selfTest() (+4 more)

### Community 27 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 28 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 29 - "stage-graphify-snapshots.mjs"
Cohesion: 0.36
Nodes (11): addExisting(), filesUnder(), git(), LEGACY_ROOT, missingFromWorktree(), PORTABLE, removeFromIndex(), restoreTrackedFromHead() (+3 more)

### Community 30 - "Control-plane regression checklist"
Cohesion: 0.17
Nodes (12): Configured cross-provider waterfall, Control-plane regression checklist, Cooperative review handover, Event feedback and CI cancellation, Exact configured workflow model orders, Explicit stack model and endpoint waterfall, Feature Stack run status conversations, Feature Stack snapshot publication and merge gates (+4 more)

### Community 31 - "ref_node_url"
Cohesion: 0.22
Nodes (6): assertPrReleaseContract(), count(), here, workflow, postPublishRefRace(), snapshot

### Community 32 - "Control-plane changelog"
Cohesion: 0.20
Nodes (10): 2026-09-05 — Cooperative review handover and preview recovery, 2026-09-05 — Desktop and Recovery cloud release repair, 2026-09-05 — Signed Commander releases and Recovery pairing, 2026-09-05 — Visible previews and conflict detector recovery, 2026-10-18 — Execute the saved admin AI waterfall, Added, Changed, Control-plane changelog (+2 more)

### Community 33 - "ref_node_child_process"
Cohesion: 0.31
Nodes (6): checkDisposition(), publishMerge(), baseSha, fixture(), head, success

### Community 35 - "start.sh"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 36 - "classify-claude-credential-failure.mjs"
Cohesion: 0.48
Nodes (6): CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest()

### Community 37 - "verify-promotion-source-authority.sh"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 38 - "PR #609 — Restore Lopu and preview admission"
Cohesion: 0.29
Nodes (6): Follow-up acceptance repair, Live diagnosis, Outcome, PR #609 — Restore Lopu and preview admission, Security boundary, Validation

### Community 39 - "electron-release-gates.test.mjs"
Cohesion: 0.40
Nodes (5): allowed(), evaluate, expression, main, workflow

### Community 40 - "ref_node_crypto"
Cohesion: 0.60
Nodes (4): rawIndexHash(), runGit(), semanticIndexHash(), sha256()

### Community 41 - "PR #506 — Auto-merge resolved main to develop sync PR"
Cohesion: 0.33
Nodes (5): Operational proof gate, PR #506 — Auto-merge resolved main to develop sync PR, Problem, Resolution, Validation

### Community 42 - "PR #603 — Admin preview publisher controller"
Cohesion: 0.33
Nodes (5): Compatibility fix, Outcome, PR #603 — Admin preview publisher controller, Security boundary, Validation

### Community 43 - "PR #634: Lopu comment admission and idempotent preview writes"
Cohesion: 0.33
Nodes (5): Behavior, Evidence and scope, PR #634: Lopu comment admission and idempotent preview writes, Rollout, Validation

### Community 44 - "PR #637: Safe cooperative handover for Lopu reviews"
Cohesion: 0.33
Nodes (5): PR #611 recovery, PR #637: Safe cooperative handover for Lopu reviews, Protocol, Scope and evidence, Validation

### Community 45 - "vercel.json"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 46 - "PR #492 — Load Lopu credentials from the Thingtime vault"
Cohesion: 0.40
Nodes (4): PR #492 — Load Lopu credentials from the Thingtime vault, Safety and regression focus, Scope, Validation log

### Community 47 - "PR #534 — Feature Stack progress heartbeat controller"
Cohesion: 0.40
Nodes (4): Outcome, PR #534 — Feature Stack progress heartbeat controller, Safety and cost, Validation

### Community 48 - "PR #642: Discoverable preview status and missed-build repair"
Cohesion: 0.40
Nodes (4): Changes, Evidence and cause, PR #642: Discoverable preview status and missed-build repair, Validation and rollout

### Community 49 - "PR #643 — Missing-build page for unassigned PR preview URLs"
Cohesion: 0.40
Nodes (5): Cause and scope, PR #643 — Missing-build page for unassigned PR preview URLs, Protected rollout, Root response decision, Verification before merge

### Community 50 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 51 - "resolve-canonical-instruction-type-conflicts.sh"
Cohesion: 0.83
Nodes (3): resolve-canonical-instruction-type-conflicts.sh script, stage_record(), tree_record()

## Knowledge Gaps
- **28 isolated node(s):** `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR`, `BASE_REF`, `BASE_SHA` (+23 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 293 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `selfTest()` connect `promote-features-to-main.mjs` to `deploy-admin-pr-previews.mjs`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR` to the rest of the system?**
  _28 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `promote-features-to-main.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05194805194805195 - nodes in this community are weakly interconnected._
- **Why does `syncPreviewLabels()` connect `deploy-admin-pr-previews.mjs` to `deploy-develop-pr-preview.mjs`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Should `deploy-develop-pr-preview.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05636092670369869 - nodes in this community are weakly interconnected._
- **Should `deploy-admin-pr-previews.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.06094627105052125 - nodes in this community are weakly interconnected._
- **Should `graphify-cas.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.08735733099209833 - nodes in this community are weakly interconnected._