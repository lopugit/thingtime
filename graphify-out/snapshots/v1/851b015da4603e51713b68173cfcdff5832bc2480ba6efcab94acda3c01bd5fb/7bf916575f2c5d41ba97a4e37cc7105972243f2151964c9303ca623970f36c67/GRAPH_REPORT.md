# Graph Report - thingtime-codeql-actions-scope  (2026-11-06)

## Corpus Check
- 107 files · ~287,215 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 4, .jq 1)

## Summary
- 1443 nodes · 3537 edges · 75 communities (68 shown, 7 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 50 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `39c06129`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- promote-features-to-main.mjs
- graphify-cas.mjs
- deploy-vercel-prebuilt.mjs
- lopu-model-waterfall.mjs
- codeql-source-languages.test.mjs
- NativeCompileBoundaryTests
- reconcile
- preview-fallback.mjs
- promotion-pr-changelog.mjs
- build-all-branch.mjs
- deploy-admin-pr-previews.mjs
- lopu-cooperative-review.mjs
- deploy-develop-pr-preview.mjs
- runSelfTest
- resolve-pr-conflicts-routing-contract.mjs
- lopu-pr-status.mjs
- workflow-control-plane-contract.mjs
- extract-vercel-prebuilt.py
- refresh-promotion-graphify.sh
- native-compile-ci.py
- runController
- ref_node_os
- Control-plane changelog
- orphan-preview-cleanup.mjs
- ref_node_assert
- ref_node_child_process
- merge-main-develop-sync-pr.mjs
- promotion-worker-contract.sh
- supervise
- rebase-related-edits.test.mjs
- prepare-round.sh
- promotion-worker.sh
- promotion-worker-routing-contract.mjs
- Control-plane regression checklist
- `github-actions` — the CI control plane
- EligibilityError
- Thingtime AI instructions
- Thingtime AI instructions
- control-plane-events.test.mjs
- stage-graphify-snapshots.mjs
- ref_node_crypto
- ref_node_fs
- ref_node_path
- cleanup
- Prebuilt-only deployments (2026-10-23)
- preview-comments.mjs
- preview-recovery.test.mjs
- start.sh
- assertPreviewGatewaySource
- verify-promotion-source-authority.sh
- PR #1294 — Remove orphan Vercel previews and reject pre-gateway source
- PR #609 — Restore Lopu and preview admission
- CHANGELOG.md
- Protected unsigned native compilation
- requestJson
- electron-release-gates.test.mjs
- PR #506 — Auto-merge resolved main to develop sync PR
- PR #603 — Admin preview publisher controller
- PR #637: Safe cooperative handover for Lopu reviews
- PR #643 — Missing-build page for unassigned PR preview URLs
- vercel.json
- README.md
- rebase-index-fingerprint.test.mjs
- PR #492 — Load Lopu credentials from the Thingtime vault
- PR #534 — Feature Stack progress heartbeat controller
- PR #634: Lopu comment admission and idempotent preview writes
- PR #642: Discoverable preview status and missed-build repair
- [Unreleased]
- rebase-ownership-routing-contract.sh
- resolve-canonical-instruction-type-conflicts.sh
- Working on it
- 1225-codex-gateway-publisher-policy-publish-controlled-environment-gateway-owners.md
- 781-codex-stack-progress-chat-controller-answer-feature-stack-status-questions.md
- codex-gateway-alias-propagation-standard-preview-target.md

## God Nodes (most connected - your core abstractions)
1. `runPromotion()` - 64 edges
2. `runSelfTest()` - 53 edges
3. `selfTest()` - 53 edges
4. `NativeCompileBoundaryTests` - 48 edges
5. `reconcile()` - 38 edges
6. `deploy()` - 31 edges
7. `publish()` - 28 edges
8. `failureDetail()` - 28 edges
9. `githubRequest()` - 23 edges
10. `Control-plane changelog` - 23 edges

## Surprising Connections (you probably didn't know these)
- `classify()` --calls--> `classifyClaudeCredentialFailure()`  [EXTRACTED]
  .github/scripts/lopu-model-waterfall.mjs → .github/scripts/classify-claude-credential-failure.mjs
- `resolveReceipts()` --calls--> `resolveNoActionsReceipts()`  [EXTRACTED]
  .github/scripts/codeql-source-languages.test.mjs → .github/scripts/codeql-open-pr-backfill.mjs
- `requiresActions()` --calls--> `actionsRequiredForSource()`  [EXTRACTED]
  .github/scripts/codeql-source-languages.test.mjs → .github/scripts/codeql-source-languages.mjs
- `symlinkShas()` --calls--> `symlinkBlobShasForSource()`  [EXTRACTED]
  .github/scripts/codeql-source-languages.test.mjs → .github/scripts/codeql-source-languages.mjs
- `decodeTarget()` --calls--> `symlinkTargetForBlob()`  [EXTRACTED]
  .github/scripts/codeql-source-languages.test.mjs → .github/scripts/codeql-source-languages.mjs

## Import Cycles
- None detected.

## Communities (75 total, 7 thin omitted)

### Community 0 - "promote-features-to-main.mjs"
Cohesion: 0.05
Nodes (130): applyPicks(), attestationMatches(), botCommentsByLatestEvent(), buildPromotionDispatchRequest(), buildPromotionPlanContext(), cancelPromotionRetirement(), CFG, checkoutRemoteBranch() (+122 more)

### Community 1 - "graphify-cas.mjs"
Cohesion: 0.09
Nodes (60): activateSnapshot(), artifactHash(), baselineNodeCount(), compareSnapshotQuality(), computeSourceFingerprint(), copyPortableFiles(), DEFAULT_SNAPSHOT_RETENTION, dropNestedRepositories() (+52 more)

### Community 2 - "deploy-vercel-prebuilt.mjs"
Cohesion: 0.09
Nodes (61): applyOutputPolicy(), visit(), assertGatewaySource(), assertPreviewOpen(), compatibilityAliasCandidates(), context(), deploymentArgs(), deploymentIssue() (+53 more)

### Community 3 - "lopu-model-waterfall.mjs"
Cohesion: 0.07
Nodes (53): models, checkDisposition(), publishMerge(), baseSha, fixture(), head, success, exportBundle() (+45 more)

### Community 4 - "codeql-source-languages.test.mjs"
Cohesion: 0.07
Nodes (47): ACTIVE_RUN_STATUSES, activePrHeadKeys(), analysisCategoriesBySnapshot(), analysisKey(), analysisSnapshotForPullRequest(), commandFailureText(), completeAnalysisKeys(), dispatchAnalysisWithInput() (+39 more)

### Community 6 - "reconcile"
Cohesion: 0.15
Nodes (41): assertCurrentPullRequest(), assertNoProtectedAlias(), assertPreviewBundle(), assertRepositoryDispatchSource(), assertTrustedPullRequestStack(), assignAliasVerified(), boundedInteger(), cleanupClosedPrResources() (+33 more)

### Community 7 - "preview-fallback.mjs"
Cohesion: 0.09
Nodes (30): FALLBACK_BRANCH, FALLBACK_HEADER, FALLBACK_MARKER, fallbackDeploymentIssue(), fallbackDomainIssue(), fallbackPage(), fallbackResponseIssue(), installFallbackAliases() (+22 more)

### Community 8 - "promotion-pr-changelog.mjs"
Cohesion: 0.13
Nodes (38): associatedPr(), bodyFile(), buildComment(), buildSection(), CFG, computeDelta(), computeMissingLabels(), contentIndex (+30 more)

### Community 9 - "build-all-branch.mjs"
Cohesion: 0.16
Nodes (36): assertAllBranchWorkflowContract(), BASE_BRANCHES, buildMode(), checkMode(), completeRefspecs, countLeadingFailureMarkers(), doctorCommitMode(), doctorRecordMode() (+28 more)

### Community 10 - "deploy-admin-pr-previews.mjs"
Cohesion: 0.12
Nodes (35): ACTIVE_STATES, assertPrebuiltOutput(), assignAlias(), cleanupDeploymentIssue(), commentBody(), createDeployment(), deleteOwnedDeployments(), deployEnvironment() (+27 more)

### Community 11 - "lopu-cooperative-review.mjs"
Cohesion: 0.11
Nodes (28): checkpoint(), completedReport(), continuationNumbers(), finalize(), git(), HANDOVER_INSTRUCTIONS, initialize(), numbers() (+20 more)

### Community 12 - "deploy-develop-pr-preview.mjs"
Cohesion: 0.09
Nodes (34): ACTIVE_STATES, assertPrebuiltOutput(), assertPreviewMaster(), assertVercelConfiguration(), assertWildcardFallbackRuntimes(), CLEANUP_ACTIONS, developRefSha(), exactPrefixedId() (+26 more)

### Community 13 - "runSelfTest"
Cohesion: 0.12
Nodes (33): assertCustomDevelopEnvironment(), choosePreferredDeployment(), chooseStableDevelopDeployment(), createVercelDeployment(), customEnvironmentDomainNames(), deploymentDetail(), deploymentIdentityIssue(), deploymentListParams() (+25 more)

### Community 14 - "resolve-pr-conflicts-routing-contract.mjs"
Cohesion: 0.13
Nodes (26): aiRuntimeSourceFiles(), assertAdminLoader(), assertAdminModelRouting(), assertCapturedStdoutStaysClean(), assertRoute(), assertWorkflowSource(), CALLS_HELPER(), decodeBatch() (+18 more)

### Community 15 - "lopu-pr-status.mjs"
Cohesion: 0.17
Nodes (25): argument(), branchCode(), classifyInventory(), count(), dateParts(), desiredFactLabels(), escapeHtml(), FACT_LABEL_ORDER (+17 more)

### Community 16 - "workflow-control-plane-contract.mjs"
Cohesion: 0.13
Nodes (26): acceptsBotRoutingProof(), actions, AI_RUNTIME_YAML, appReentryDisposition(), assertAdminLoader(), assertAdminModelRouting(), assertAdminWaterfallGrammar(), assertBareControlPlaneTree() (+18 more)

### Community 17 - "extract-vercel-prebuilt.py"
Cohesion: 0.14
Nodes (5): extract_archive(), main(), _member_path(), self_test(), _validate_link()

### Community 18 - "refresh-promotion-graphify.sh"
Cohesion: 0.14
Nodes (24): assert_control_metadata_unchanged(), assert_tool_boundary(), current_grafts_state(), current_refs_hash(), emit(), fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_COUNT (+16 more)

### Community 19 - "native-compile-ci.py"
Cohesion: 0.12
Nodes (11): acquire_cleanup_lock(), arm_native(), drop_identity(), extract_candidate(), kernel_groups(), main(), native_deadline(), preflight_failure() (+3 more)

### Community 20 - "runController"
Cohesion: 0.16
Nodes (24): assertCurrentPullRequest(), boundedInteger(), cleanupEnvironment(), exactId(), getPullRequest(), githubRequest(), normalizeBotLogin(), normalizeEnvironments() (+16 more)

### Community 21 - "ref_node_os"
Cohesion: 0.16
Nodes (17): answerCommand(), answerQuestion(), CHAT_SYSTEM_PROMPT, safeRunContext(), serveRunChat(), githubJobs(), githubStackPullRequests(), postProgress() (+9 more)

### Community 22 - "Control-plane changelog"
Cohesion: 0.09
Nodes (22): 2026-09-05 — Cooperative review handover and preview recovery, 2026-09-05 — Desktop and Recovery cloud release repair, 2026-09-05 — Signed Commander releases and Recovery pairing, 2026-09-05 — Visible previews and conflict detector recovery, 2026-10-18 — Correct reusable workflow context, 2026-10-18 — Diagnose OpenAI preflight failures safely, 2026-10-18 — Execute the saved admin AI waterfall, 2026-10-23 — Build every Vercel deployment on GitHub Actions (+14 more)

### Community 23 - "orphan-preview-cleanup.mjs"
Cohesion: 0.23
Nodes (18): ACTIVE, assertPreviewHasOpenPullRequest(), completeInventory(), deploymentLane(), idOf(), missing(), openBranchPullRequests(), previewIdentity() (+10 more)

### Community 24 - "ref_node_assert"
Cohesion: 0.16
Nodes (7): allowed, workflow, postPublishRefRace(), current(), snapshot, previewSummaryBody(), publishPreviewSummary()

### Community 25 - "ref_node_child_process"
Cohesion: 0.30
Nodes (14): canonicalFeatureStackPlan(), decodeFeatureStackPlan(), exactKeys(), featureStackId(), git(), selfTest(), validateWaterfall(), verifyFeatureStackHistory() (+6 more)

### Community 26 - "merge-main-develop-sync-pr.mjs"
Cohesion: 0.22
Nodes (15): assertHeadContainsMain(), assertSyncPullRequestShape(), exactSha(), EXPECTED_MERGE_REJECTIONS, githubRequest(), GitHubRequestError, headContainsMain(), mergeStandingSyncPullRequest() (+7 more)

### Community 27 - "promotion-worker-contract.sh"
Cohesion: 0.14
Nodes (17): BASE_REF, BASE_SHA, compute_plan_hash(), GITHUB_OUTPUT, PLAN_HASH, PROMOTION_BRANCH, reject_lineage_mismatch(), require_lineage_replay() (+9 more)

### Community 28 - "supervise"
Cohesion: 0.17
Nodes (14): admit_runner(), build_environment(), firewall_rules(), phase(), require_hosted_runner(), run(), supervise(), as_build() (+6 more)

### Community 29 - "rebase-related-edits.test.mjs"
Cohesion: 0.28
Nodes (14): actionPath, copyTrustedTree(), extractVerifierScript(), filesUnder(), hashNamedFiles(), hashRebaseState(), hashTrustedTree(), makeStoppedRebase() (+6 more)

### Community 30 - "prepare-round.sh"
Cohesion: 0.28
Nodes (14): assert_safe_regular_text_conflict(), clear_scratch(), emit(), emit_paths(), has_coherent_zdiff3_markers(), hash_index_entries(), hash_rebase_state(), rebase_in_progress() (+6 more)

### Community 31 - "promotion-worker.sh"
Cohesion: 0.37
Nodes (13): classify_source_lineage(), emit(), emit_paths(), fail(), prepare(), require_environment(), require_reservation(), secure_git_environment() (+5 more)

### Community 32 - "promotion-worker-routing-contract.mjs"
Cohesion: 0.14
Nodes (13): action, allBranchWorkflow, developPromotionWorkflow, featurePromotionWorkflow, featureStackMergeIf, featureStackMergeJob, graphify, lopuAgent (+5 more)

### Community 33 - "Control-plane regression checklist"
Cohesion: 0.14
Nodes (14): Configured cross-provider waterfall, Control-plane regression checklist, Cooperative review handover, Event feedback and CI cancellation, Exact configured workflow model orders, Explicit stack model and endpoint waterfall, Feature Stack run status conversations, Feature Stack snapshot publication and merge gates (+6 more)

### Community 34 - "`github-actions` — the CI control plane"
Cohesion: 0.14
Nodes (14): Commander signed releases, Desktop and Recovery release pipeline, Environment gateways for future product builds, Fork setup: Vercel develop previews, `github-actions` — the CI control plane, Known trade-off, Lopu principal repository manager, macOS signing and build identity (+6 more)

### Community 35 - "EligibilityError"
Cohesion: 0.19
Nodes (12): assertTrustedPrincipal(), assertTrustedPullRequest(), classifyPullRequest(), EligibilityError, getRepositoryPermission(), headHasPreviewBundle(), isSafeHeadRef(), normalizeLogin() (+4 more)

### Community 36 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 37 - "Thingtime AI instructions"
Cohesion: 0.17
Nodes (11): Browser and UI validation, Canonical instruction file, Data and API conventions, Delivery messaging, Fundamentals (read first), GitHub push and PR publishing, graphify, iOS development and releases (+3 more)

### Community 38 - "control-plane-events.test.mjs"
Cohesion: 0.24
Nodes (5): ci, workflow, classifyConversation(), classifyQueuedConversation(), hasAutomationMarker()

### Community 39 - "stage-graphify-snapshots.mjs"
Cohesion: 0.36
Nodes (11): addExisting(), filesUnder(), git(), LEGACY_ROOT, missingFromWorktree(), PORTABLE, removeFromIndex(), restoreTrackedFromHead() (+3 more)

### Community 40 - "ref_node_crypto"
Cohesion: 0.33
Nodes (7): duration(), parsePreviewRetentionPolicy(), previewGraceElapsed(), previewRetentionCapability(), readPreviewRetentionPolicy(), now, policy

### Community 41 - "ref_node_fs"
Cohesion: 0.33
Nodes (7): CAPACITY_PATTERNS, classifyClaudeCredentialFailure(), collectStrings(), CREDENTIAL_PATTERNS, main(), selfTest(), script

### Community 42 - "ref_node_path"
Cohesion: 0.22
Nodes (5): assertPrReleaseContract(), count(), here, workflow, script

### Community 43 - "cleanup"
Cohesion: 0.22
Nodes (7): cleanup(), command(), detach_watchdog_io(), process_inventory(), publish_watchdog_evidence(), record_remaining(), start_watchdog()

### Community 44 - "Prebuilt-only deployments (2026-10-23)"
Cohesion: 0.20
Nodes (10): Environment gateway publication, Existing workflow preflight verification, Native control continuity and bounded bootstrap, Prebuilt artifact acceptance, Prebuilt-only deployments (2026-10-23), Preview receipt runner context (2026-10-26), Protected native compilation, Published PR gateway API acceptance (2026-10-26) (+2 more)

### Community 45 - "preview-comments.mjs"
Cohesion: 0.43
Nodes (5): isManagedPreviewComment(), publishPreviewNotifications(), transientPreviewError(), upsertOnce(), upsertPreviewComment()

### Community 46 - "preview-recovery.test.mjs"
Cohesion: 0.39
Nodes (6): previewWorkActive(), reconcilePreviewInventory(), recoveryAttempt(), recoverySourceIssue(), now, source

### Community 47 - "start.sh"
Cohesion: 0.46
Nodes (7): emit(), emit_paths(), rebase_in_progress(), secure_git_environment(), start.sh script, usage(), write_conflicts()

### Community 48 - "assertPreviewGatewaySource"
Cohesion: 0.52
Nodes (4): assertPreviewGatewaySource(), code(), gatewaySourceIssue(), gatewaySourcePaths

### Community 49 - "verify-promotion-source-authority.sh"
Cohesion: 0.33
Nodes (6): fail(), GIT_ATTR_NOSYSTEM, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM, GIT_CONFIG_SYSTEM, verify-promotion-source-authority.sh script

### Community 50 - "PR #1294 — Remove orphan Vercel previews and reject pre-gateway source"
Cohesion: 0.29
Nodes (6): Activation and remaining acceptance, Delivered controller behavior, Parent-reported one-time operational cleanup, PR #1294 — Remove orphan Vercel previews and reject pre-gateway source, Saved retention policy, Verification and evidence boundaries

### Community 51 - "PR #609 — Restore Lopu and preview admission"
Cohesion: 0.29
Nodes (6): Follow-up acceptance repair, Live diagnosis, Outcome, PR #609 — Restore Lopu and preview admission, Security boundary, Validation

### Community 53 - "Protected unsigned native compilation"
Cohesion: 0.33
Nodes (6): Admission and entry point, Darwin credential verification and trusted failures, Enforced network policy and cleanup, Protected unsigned native compilation, Trust boundary, Validation and acceptance

### Community 54 - "requestJson"
Cohesion: 0.33
Nodes (5): HttpError, isRetryableHttpResponse(), parseErrorCode(), requestJson(), retryDelayMs()

### Community 55 - "electron-release-gates.test.mjs"
Cohesion: 0.40
Nodes (5): allowed(), evaluate, expression, main, workflow

### Community 56 - "PR #506 — Auto-merge resolved main to develop sync PR"
Cohesion: 0.33
Nodes (5): Operational proof gate, PR #506 — Auto-merge resolved main to develop sync PR, Problem, Resolution, Validation

### Community 57 - "PR #603 — Admin preview publisher controller"
Cohesion: 0.33
Nodes (5): Compatibility fix, Outcome, PR #603 — Admin preview publisher controller, Security boundary, Validation

### Community 58 - "PR #637: Safe cooperative handover for Lopu reviews"
Cohesion: 0.33
Nodes (5): PR #611 recovery, PR #637: Safe cooperative handover for Lopu reviews, Protocol, Scope and evidence, Validation

### Community 59 - "PR #643 — Missing-build page for unassigned PR preview URLs"
Cohesion: 0.33
Nodes (5): Cause and scope, PR #643 — Missing-build page for unassigned PR preview URLs, Protected rollout, Root response decision, Verification before merge

### Community 60 - "vercel.json"
Cohesion: 0.33
Nodes (5): framework, git, deploymentEnabled, ignoreCommand, $schema

### Community 62 - "rebase-index-fingerprint.test.mjs"
Cohesion: 0.80
Nodes (4): rawIndexHash(), runGit(), semanticIndexHash(), sha256()

### Community 63 - "PR #492 — Load Lopu credentials from the Thingtime vault"
Cohesion: 0.40
Nodes (4): PR #492 — Load Lopu credentials from the Thingtime vault, Safety and regression focus, Scope, Validation log

### Community 64 - "PR #534 — Feature Stack progress heartbeat controller"
Cohesion: 0.40
Nodes (4): Outcome, PR #534 — Feature Stack progress heartbeat controller, Safety and cost, Validation

### Community 65 - "PR #634: Lopu comment admission and idempotent preview writes"
Cohesion: 0.40
Nodes (5): Behavior, Evidence and scope, PR #634: Lopu comment admission and idempotent preview writes, Rollout, Validation

### Community 66 - "PR #642: Discoverable preview status and missed-build repair"
Cohesion: 0.40
Nodes (4): Changes, Evidence and cause, PR #642: Discoverable preview status and missed-build repair, Validation and rollout

### Community 67 - "[Unreleased]"
Cohesion: 0.50
Nodes (4): Added, Changed, Fixed, [Unreleased]

### Community 68 - "rebase-ownership-routing-contract.sh"
Cohesion: 0.83
Nodes (3): assert_owner(), assert_stack(), rebase-ownership-routing-contract.sh script

### Community 69 - "resolve-canonical-instruction-type-conflicts.sh"
Cohesion: 0.83
Nodes (3): resolve-canonical-instruction-type-conflicts.sh script, stage_record(), tree_record()

### Community 70 - "Working on it"
Cohesion: 0.50
Nodes (4): Discoverable preview status and recovery, Missing-build wildcard page, Orphan deployment cleanup (2026-10-30), Working on it

## Knowledge Gaps
- **28 isolated node(s):** `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR`, `BASE_REF`, `BASE_SHA` (+23 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 421 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `selfTest()` connect `promote-features-to-main.mjs` to `ref_node_assert`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `RUNNER_TEMP`, `GITHUB_OUTPUT`, `SOURCE_PR` to the rest of the system?**
  _28 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `promote-features-to-main.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.05194805194805195 - nodes in this community are weakly interconnected._
- **Why does `NativeCompileBoundaryTests` connect `NativeCompileBoundaryTests` to `extract-vercel-prebuilt.py`?**
  _High betweenness centrality (0.005) - this node is a cross-community bridge._
- **Should `graphify-cas.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.08735733099209833 - nodes in this community are weakly interconnected._
- **Why does `Control-plane changelog` connect `Control-plane changelog` to `[Unreleased]`, `CHANGELOG.md`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **Should `deploy-vercel-prebuilt.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.08955223880597014 - nodes in this community are weakly interconnected._