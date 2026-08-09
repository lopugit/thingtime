# PR #213 — Automatically resolve promotion creation conflicts

## Problem

The per-feature `develop` → `main` promoter could create clean promotion PRs,
but a creation-time cherry-pick conflict stopped before any branch or PR
existed. The ordinary PR conflict resolver therefore had nothing it could
inspect or repair. The summary told a person to resolve and push a branch, then
promised a later promoter run would open its PR; for a true conflict, the
clean-replay branch validator could reject that manually resolved branch too.

## Automatic path

- The thin `develop` listener grants only the permissions needed by the
  protected promoter implementation. Only after the promoter positively proves
  the historical source patch is still effective at the current `develop` tip
  does it create a deterministic empty reservation on the exact promotion base,
  record the immutable source/base plan, and dispatch one bot-only worker at the
  fixed protected `github-actions` resolver revision.
- The protected integration keeps the secret-bearing provider router on
  GitHub-hosted compute and accepts only authenticated, validated downstream
  runner metadata. Promotion-plan handoffs bypass external provider routing
  until that boundary can carry and verify the same immutable plan envelope.
- The worker independently re-derives the merged source PR and plan, replays
  its non-Graphify patch, and gives the existing repo-less model round only the
  mechanically derived conflict files. It has no repository, Git, shell, or
  network access.
- Trusted verification rejects unmerged entries, conflict markers of any Git
  marker size, non-planned paths, dropped incoming changes, unsafe file types,
  source/provenance drift, and stale refs. `graphify-out/**` is reset to the
  promotion side and regenerated as derived output rather than model-edited or
  copied from `develop`.
- An exact lease publishes the resolved branch and opens the promotion PR. The
  PR receives `promotion`, `ai-conflict-resolved`, and
  `review-ai-resolution`, plus an evidence comment naming the resolver run,
  immutable SHAs, Graphify mode, and exact paths to review. The source PR is
  updated with the promotion link, and a trusted follow-up scan resumes only
  the dependent stack members.

## Recovery and safety

- Duplicate dispatches, API-ambiguous comments, crashes before/after branch or
  PR creation, and transient metadata failures converge from live refs plus
  latest bot-authored attestations.
- An unchanged failed AI snapshot pauses with a visible marker and
  `ai-promotion-paused`; deleting that label explicitly retries it. A changed
  source, base, or plan naturally becomes a new snapshot.
- If the promotion base moves mid-publication, durable retirement state lets a
  later run finish exact cleanup and replan. A concurrently moved branch is
  preserved and its PR reopened; stale bot retirement authority is cancelled
  so a later reviewer closure remains intentional.
- Every source-verified `.github/**` promotion, including a conflict-free
  replay, is published as a bot-authored `[skip ci]` content commit instead of
  retaining an executable historical commit message. A separate empty non-skip
  review checkpoint is pushed with `GITHUB_TOKEN`, causing GitHub to create
  approval-required PR checks without immediately executing promoted
  automation.
- Historical source patches whose effect cannot be positively proven at the
  current `develop` tip are never silently treated as current features. A
  recoverable patch classified as removed or ambiguous is reported as visibly
  blocked before any reservation, branch, immutable promotion plan, AI worker,
  or promotion PR is created. Later dependent members of that promotion group
  remain deferred, while unrelated groups continue independently; the promoter
  exposes the blocked result without creating any review branch or PR that
  could resurrect the historical patch.
- Preflight source authority also fails closed before any reservation, branch,
  or PR exists when the historical object or exact patch cannot be recovered or
  Git inspection fails. A worker-observed lineage mismatch or immutable
  source/base/plan drift stops publication after dispatch. AI resolves only
  known file conflicts; it never invents missing source or upgrades an
  unverified feature to verified.
- A later scan may proceed only after a fresh proof establishes that the patch
  is effective at the then-current `develop` tip. That run starts from a new
  verified plan; no blocked removed/ambiguous result is upgraded in place.

## Verification

- Promoter Node syntax and self-test, including orphaned commits; verified,
  removed, and ambiguous source-lineage classifications; the verified path's
  immutable plan identity; empty picks; stacks; stale retirement; duplicate
  comment events; checkpoint rollback; and exact token-header isolation.
- Real-Git worker contract covering a genuine creation-time conflict,
  independent source-lineage reclassification and mismatch rejection,
  ten-character Git markers, literal pathspecs, source authority, omitted-path
  proof, model tampering, and Graphify history mutation.
- Resolver routing contract, protected control-plane contract, thin-listener
  contract, and promotion path-policy self-test.
- Ruby YAML parse, every workflow `run:` block through `bash -n`, direct Bash
  syntax, ShellCheck warning severity, actionlint v1.7.7, and
  `git diff --check`.
- Live read-only promoter scan completed across 16 eligible source PRs: current
  true conflicts #181 and #172 were queued for automatic resolution in dry-run
  mode while unrelated candidates continued.
- Semantic Graphify refresh through the local Codex proxy and multigraph
  diagnosis with zero missing, dangling, self-loop, duplicate, or collapsed
  edges.
- Independent correctness/security/Actions/idempotency review found no
  remaining P0, P1, or P2 issue.
