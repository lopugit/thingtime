# Graph Report - recovery-release-builder  (2026-09-05)

## Corpus Check
- 57 files · ~208,500 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 855 nodes · 1919 edges · 46 communities (44 shown, 2 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.5)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2c780da9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_deploy-develop-pr-preview.mjs|deploy-develop-pr-preview.mjs]]
- [[_COMMUNITY_deploy-admin-pr-previews.mjs|deploy-admin-pr-previews.mjs]]
- [[_COMMUNITY_graphify-cas.mjs|graphify-cas.mjs]]
- [[_COMMUNITY_build-all-branch.mjs|build-all-branch.mjs]]
- [[_COMMUNITY_promotion-pr-changelog.mjs|promotion-pr-changelog.mjs]]
- [[_COMMUNITY_refresh-promotion-graphify.sh|refresh-promotion-graphify.sh]]
- [[_COMMUNITY_selfTest|selfTest]]
- [[_COMMUNITY_resolve-pr-conflicts-routing-contract.mjs|resolve-pr-conflicts-routing-contract.mjs]]
- [[_COMMUNITY_workflow-control-plane-contract.mjs|workflow-control-plane-contract.mjs]]
- [[_COMMUNITY_`github-actions` — the CI control plane|`github-actions` — the CI control plane]]
- [[_COMMUNITY_lopu-pr-status.mjs|lopu-pr-status.mjs]]
- [[_COMMUNITY_failureDetail|failureDetail]]
- [[_COMMUNITY_runPromotion|runPromotion]]
- [[_COMMUNITY_codeql-open-pr-backfill.mjs|codeql-open-pr-backfill.mjs]]
- [[_COMMUNITY_promote-features-to-main.mjs|promote-features-to-main.mjs]]
- [[_COMMUNITY_merge-main-develop-sync-pr.mjs|merge-main-develop-sync-pr.mjs]]
- [[_COMMUNITY_promotion-worker-contract.sh|promotion-worker-contract.sh]]
- [[_COMMUNITY_rebase-related-edits.test.mjs|rebase-related-edits.test.mjs]]
- [[_COMMUNITY_prepare-round.sh|prepare-round.sh]]
- [[_COMMUNITY_promotion-worker.sh|promotion-worker.sh]]
- [[_COMMUNITY_promotion-worker-routing-contract.mjs|promotion-worker-routing-contract.mjs]]
- [[_COMMUNITY_Thingtime AI instructions|Thingtime AI instructions]]
- [[_COMMUNITY_feature-stack-progress.mjs|feature-stack-progress.mjs]]
- [[_COMMUNITY_stage-graphify-snapshots.mjs|stage-graphify-snapshots.mjs]]
- [[_COMMUNITY_recoverPromotionReviewCheckpoint|recoverPromotionReviewCheckpoint]]
- [[_COMMUNITY_control-plane-events.test.mjs|control-plane-events.test.mjs]]
- [[_COMMUNITY_queueTrustedPromotionWorker|queueTrustedPromotionWorker]]
- [[_COMMUNITY_lopu-review-queue.test.mjs|lopu-review-queue.test.mjs]]
- [[_COMMUNITY_feature-stack-plan.mjs|feature-stack-plan.mjs]]
- [[_COMMUNITY_lopu-credential-vault.mjs|lopu-credential-vault.mjs]]
- [[_COMMUNITY_start.sh|start.sh]]
- [[_COMMUNITY_classify-claude-credential-failure.mjs|classify-claude-credential-failure.mjs]]
- [[_COMMUNITY_verify-promotion-source-authority.sh|verify-promotion-source-authority.sh]]
- [[_COMMUNITY_PR 609 — Restore Lopu and preview admission|PR #609 — Restore Lopu and preview admission]]
- [[_COMMUNITY_electron-release-gates.test.mjs|electron-release-gates.test.mjs]]
- [[_COMMUNITY_PR 506 — Auto-merge resolved main to develop sync PR|PR #506 — Auto-merge resolved main to develop sync PR]]
- [[_COMMUNITY_PR 603 — Admin preview publisher controller|PR #603 — Admin preview publisher controller]]
- [[_COMMUNITY_vercel.json|vercel.json]]
- [[_COMMUNITY_electron-pr-release-contract.mjs|electron-pr-release-contract.mjs]]
- [[_COMMUNITY_rebase-index-fingerprint.test.mjs|rebase-index-fingerprint.test.mjs]]
- [[_COMMUNITY_PR 492 — Load Lopu credentials from the Thingtime vault|PR #492 — Load Lopu credentials from the Thingtime vault]]
- [[_COMMUNITY_PR 534 — Feature Stack progress heartbeat controller|PR #534 — Feature Stack progress heartbeat controller]]
- [[_COMMUNITY_rebase-ownership-routing-contract.sh|rebase-ownership-routing-contract.sh]]
- [[_COMMUNITY_resolve-canonical-instruction-type-conflicts.sh|resolve-canonical-instruction-type-conflicts.sh]]
- [[_COMMUNITY_resolve-canonical-instruction-type-conflicts.test.mjs|resolve-canonical-instruction-type-conflicts.test.mjs]]

## God Nodes (most connected - your core abstractions)
1. `selfTest()` - 49 edges
2. `runPromotion()` - 36 edges
3. `runSelfTest()` - 33 edges
4. `failureDetail()` - 28 edges
5. `deploy()` - 27 edges
6. `main()` - 20 edges
7. `orphanedMergeHydrationIntegrationTest()` - 19 edges
8. `main()` - 17 edges
9. `prepareBuildPlan()` - 16 edges
10. `repoFlag()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `isManagedPreviewComment()` --calls--> `isManagedPreviewComment()`  [EXTRACTED]
  .github/scripts/deploy-develop-pr-preview.mjs → .github/scripts/preview-comments.mjs
- `upsertComment()` --calls--> `upsertPreviewComment()`  [EXTRACTED]
  .github/scripts/deploy-develop-pr-preview.mjs → .github/scripts/preview-comments.mjs
- `stepAroundUses()` --calls--> `yamlStepAt()`  [EXTRACTED]
  .github/scripts/resolve-pr-conflicts-routing-contract.test.mjs → .github/scripts/resolve-pr-conflicts-routing-contract.mjs
- `isManagedPreviewComment()` --calls--> `isManagedPreviewComment()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/preview-comments.mjs
- `upsertComment()` --calls--> `upsertPreviewComment()`  [EXTRACTED]
  .github/scripts/deploy-admin-pr-previews.mjs → .github/scripts/preview-comments.mjs

## Import Cycles
- None detected.

## Communities (46 total, 2 thin omitted)

### Community 0 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.06
Nodes (108): ACTIVE_STATES, assertCurrentPullRequest(), assertPrebuiltOutput(), assertPreviewBundle(), assertRepositoryDispatchSource(), assertTrustedPrincipal(), assertTrustedPullRequest(), assertTrustedPullRequestStack() (+100 more)

### Community 1 - "deploy-admin-pr-previews.mjs"
Cohesion: 0.08
Nodes (55): ACTIVE_STATES, assertCurrentPullRequest(), assertPrebuiltOutput(), assignAlias(), boundedInteger(), cleanupDeploymentIssue(), cleanupEnvironment(), commentBody() (+47 more)

### Community 2 - "graphify-cas.mjs"
Cohesion: 0.09
Nodes (55): activateSnapshot(), artifactHash(), baselineNodeCount(), compareSnapshotQuality(), computeSourceFingerprint(), copyPortableFiles(), dropNestedRepositories(), ensureSnapshot() (+47 more)

### Community 3 - "build-all-branch.mjs"
Cohesion: 0.16
Nodes (36): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), completeRefspecs, countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode() (+28 more)

### Community 4 - "promotion-pr-changelog.mjs"
Cohesion: 0.14
Nodes (35): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+27 more)

### Community 5 - "refresh-promotion-graphify.sh"
Cohesion: 0.10
Nodes (28): extract_archive(), main(), _member_path(), self_test(), _validate_link(), assert_control_metadata_unchanged(), assert_tool_boundary(), current_refs_hash() (+20 more)

### Community 6 - "selfTest"
Cohesion: 0.09
Nodes (33): botCommentsByLatestEvent(), clearSourceStandAside(), computePicks(), dependentMembersAfter(), externalStackPromotionState(), findBotPromotionRetirement(), groupFailureMessages(), groupKeyFor() (+25 more)

### Community 7 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.13
Nodes (26): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertCapturedStdoutStaysClean(), assertRoute(), assertWorkflowSource(), CALLS_HELPER(), decodeBatch() (+18 more)

### Community 8 - "workflow-control-plane-contract.mjs"
Cohesion: 0.13
Nodes (27): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertAdminTransportCap(), assertAdminWaterfallGrammar() (+19 more)

### Community 9 - "`github-actions` — the CI control plane"
Cohesion: 0.07
Nodes (23): 2026-09-05 — Desktop and Recovery cloud release repair, Added, Changed, Control-plane changelog, Fixed, [Unreleased], Control-plane regression checklist, Event feedback and CI cancellation (+15 more)

### Community 10 - "lopu-pr-status.mjs"
Cohesion: 0.16
Nodes (23): argument(), branchCode(), classifyInventory(), count(), dateParts(), escapeHtml(), FACT_LABEL_ORDER, formatZonedTimestamp() (+15 more)

### Community 11 - "failureDetail"
Cohesion: 0.15
Nodes (27): applyPicks(), buildPromotionPlanContext(), checkoutRemoteBranch(), createPromotionReservation(), createPromotionReviewCheckpoint(), ensureCommitAvailable(), ensureRemoteBranchAvailable(), expectedReservationTrailers() (+19 more)

### Community 12 - "runPromotion"
Cohesion: 0.18
Nodes (26): cancelPromotionRetirement(), closeRedundantPass(), createPromotionPr(), ensurePromotionLabel(), ensureSourceLineageReviewLabel(), exactBranchDeleteWithActionsToken(), finalizeAiPromotionMetadata(), finalizeSourceLineageMetadata() (+18 more)

### Community 13 - "codeql-open-pr-backfill.mjs"
Cohesion: 0.21
Nodes (23): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisKey(), analysisSnapshotForPullRequest(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput(), flattenSlurp() (+15 more)

### Community 14 - "promote-features-to-main.mjs"
Cohesion: 0.13
Nodes (18): CFG, checkpointRecoveryDisposition(), encodePromotionAttestation(), env(), EXEC_OPTS, flag(), isExactPausedPromotionSnapshot(), listSourceIssueComments() (+10 more)

### Community 15 - "merge-main-develop-sync-pr.mjs"
Cohesion: 0.20
Nodes (14): assertHeadContainsMain(), assertSyncPullRequestShape(), exactSha(), EXPECTED_MERGE_REJECTIONS, GitHubRequestError, headContainsMain(), mergeStandingSyncPullRequest(), notice() (+6 more)

### Community 16 - "promotion-worker-contract.sh"
Cohesion: 0.12
Nodes (16): BASE_REF, BASE_SHA, GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay(), RESERVATION_SHA (+8 more)

### Community 17 - "rebase-related-edits.test.mjs"
Cohesion: 0.28
Nodes (14): actionPath, copyTrustedTree(), extractVerifierScript(), filesUnder(), hashNamedFiles(), hashRebaseState(), hashTrustedTree(), makeStoppedRebase() (+6 more)

### Community 18 - "prepare-round.sh"
Cohesion: 0.26
Nodes (14): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_index_entries(), hash_rebase_state(), rebase_in_progress() (+6 more)

### Community 19 - "promotion-worker.sh"
Cohesion: 0.35
Nodes (12): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+4 more)

### Community 20 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.14
Nodes (13): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, featureStackMergeIf, featureStackMergeJob, graphify, lopuAgent (+5 more)

### Community 21 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 22 - "feature-stack-progress.mjs"
Cohesion: 0.27
Nodes (10): githubJobs(), postProgress(), progressSnapshot(), reconcile(), recoveryPayload(), run(), selfTest(), STEP_PHASES (+2 more)

### Community 23 - "stage-graphify-snapshots.mjs"
Cohesion: 0.36
Nodes (11): addExisting(), filesUnder(), git(), LEGACY_ROOT, missingFromWorktree(), PORTABLE, removeFromIndex(), restoreTrackedFromHead() (+3 more)

### Community 24 - "recoverPromotionReviewCheckpoint"
Cohesion: 0.27
Nodes (11): attestationMatches(), exactCheckpointPush(), inspectPromotionReviewCheckpoint(), isObjectId(), latestBotPromotionAttestationEvents(), liveRefShaWithActionsToken(), parsePromotionResolutionAttestations(), recoverPromotionReviewCheckpoint() (+3 more)

### Community 25 - "control-plane-events.test.mjs"
Cohesion: 0.31
Nodes (5): ci, workflow, classifyConversation(), classifyQueuedConversation(), hasAutomationMarker()

### Community 26 - "queueTrustedPromotionWorker"
Cohesion: 0.24
Nodes (10): buildPromotionDispatchRequest(), dispatchPromotionResolution(), exactReservationDeleteArgs(), exactReservationPushArgs(), promotionBody(), promotionDispatchArgs(), queueTrustedPromotionWorker(), redispatchPromotionReservation() (+2 more)

### Community 27 - "lopu-review-queue.test.mjs"
Cohesion: 0.33
Nodes (6): findPendingReview(), pending, reviewScope(), fixture(), run, worker

### Community 28 - "feature-stack-plan.mjs"
Cohesion: 0.64
Nodes (7): canonicalFeatureStackPlan(), decodeFeatureStackPlan(), exactKeys(), featureStackId(), git(), selfTest(), verifyFeatureStackHistory()

### Community 29 - "lopu-credential-vault.mjs"
Cohesion: 0.61
Nodes (7): exportBundle(), fetchBundle(), legacyCredentials(), main(), required(), safeCache(), validate()

### Community 30 - "start.sh"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 31 - "classify-claude-credential-failure.mjs"
Cohesion: 0.48
Nodes (6): CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest()

### Community 32 - "verify-promotion-source-authority.sh"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 33 - "PR #609 — Restore Lopu and preview admission"
Cohesion: 0.29
Nodes (6): Follow-up acceptance repair, Live diagnosis, Outcome, PR #609 — Restore Lopu and preview admission, Security boundary, Validation

### Community 34 - "electron-release-gates.test.mjs"
Cohesion: 0.40
Nodes (5): allowed(), evaluate, expression, main, workflow

### Community 35 - "PR #506 — Auto-merge resolved main to develop sync PR"
Cohesion: 0.33
Nodes (5): Operational proof gate, PR #506 — Auto-merge resolved main to develop sync PR, Problem, Resolution, Validation

### Community 36 - "PR #603 — Admin preview publisher controller"
Cohesion: 0.33
Nodes (5): Compatibility fix, Outcome, PR #603 — Admin preview publisher controller, Security boundary, Validation

### Community 37 - "vercel.json"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 38 - "electron-pr-release-contract.mjs"
Cohesion: 0.50
Nodes (4): assertPrReleaseContract(), count(), here, workflow

### Community 39 - "rebase-index-fingerprint.test.mjs"
Cohesion: 0.80
Nodes (4): rawIndexHash(), runGit(), semanticIndexHash(), sha256()

### Community 40 - "PR #492 — Load Lopu credentials from the Thingtime vault"
Cohesion: 0.40
Nodes (4): PR #492 — Load Lopu credentials from the Thingtime vault, Safety and regression focus, Scope, Validation log

### Community 41 - "PR #534 — Feature Stack progress heartbeat controller"
Cohesion: 0.40
Nodes (4): Outcome, PR #534 — Feature Stack progress heartbeat controller, Safety and cost, Validation

### Community 42 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

## Knowledge Gaps
- **167 isolated node(s):** `BASE_BRANCHES`, `completeRefspecs`, `MERGE_CONFIG`, `CAPACITY_PATTERNS`, `CREDENTIAL_PATTERNS` (+162 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `upsertPreviewComment()` connect `deploy-admin-pr-previews.mjs` to `deploy-develop-pr-preview.mjs`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Why does `isManagedPreviewComment()` connect `deploy-admin-pr-previews.mjs` to `deploy-develop-pr-preview.mjs`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Why does `selfTest()` connect `selfTest` to `recoverPromotionReviewCheckpoint`, `queueTrustedPromotionWorker`, `failureDetail`, `promote-features-to-main.mjs`?**
  _High betweenness centrality (0.001) - this node is a cross-community bridge._
- **What connects `BASE_BRANCHES`, `completeRefspecs`, `MERGE_CONFIG` to the rest of the system?**
  _167 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `deploy-develop-pr-preview.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.057166257166257166 - nodes in this community are weakly interconnected._
- **Should `deploy-admin-pr-previews.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.08090117767537122 - nodes in this community are weakly interconnected._
- **Should `graphify-cas.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.0903954802259887 - nodes in this community are weakly interconnected._