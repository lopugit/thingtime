# Control-plane changelog

Everything in this repository's **executable CI** lives on the `github-actions`
branch: the workflows, the automation scripts, and the actions they call. The
product branches carry only thin listeners that invoke this branch by ref, so a
change here is live everywhere the moment it lands — it is never promoted, never
merged into `main` or `develop`, and never appears in `remix/CHANGELOG.md`.

That is exactly why this file exists. The entries below were written into the
app changelog on this branch, where nothing could ever carry them to a product
branch: seven entries describing how conflict resolution and promotion behave
were invisible to anyone reading the app's history. They are reproduced here
verbatim, and CI changes are recorded here from now on.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
every entry is attributed the same way the app changelog attributes them.

---

## [Unreleased]

### Fixed

- **AI conflict resolution runs again (every worker was silently skipped)**:
  adding the promotion validator to `model_config`'s `needs` made GitHub apply
  that job's ordinary-mode skip to the whole downstream chain, so both the
  `resolve` matrix job and `resolve_promotion` never started — detection,
  routing, and model selection all reported success while nothing resolved
  (PR #220 and every handoff after the promotion worker landed). Both workers
  now opt out of inherited skips with `!cancelled()` plus exhaustive per-need
  result checks. — Claude (AI), 2026-08-10
- **The thin product-branch listeners can reach the conflict resolver**: every
  secret-bearing gate tested `github.ref_name == 'github-actions'`, but under
  `workflow_call` that is the *caller's* ref, so `develop`'s listener was
  rejected in `detect` on every push, schedule and handoff it forwarded —
  including the worker handoffs older branch copies still aim at that ref.
  The gates now also accept a run started by this workflow's own listener on
  `develop`/`main`, which the caller contract already constrains to a single
  pinned `@github-actions` call with no executable behavior of its own.
  — Claude (AI), 2026-08-10
- **A declined promotion now says so on the source PR**: the promoter's
  stand-aside verdicts existed only as lines in a run summary, so a decline was
  invisible unless someone opened the run — which is why #211, the PR that
  converts `main` from a 2167-line resolver copy to a thin listener, was
  declined on 2026-08-09 and sat unnoticed. Declines now upsert one
  hidden-marker comment on the merged source PR, edited in place on later runs
  so repeat scans never stack, naming the reason and how many stacked PRs are
  held behind it. Dry runs stay side-effect free and a failed comment is a
  warning, never a reason to abandon promotion work. — Claude (AI), 2026-08-10
- **A promotion is never cancelled for an unverifiable lineage**: a source
  patch that can't be proven present at the current `develop` tip used to drop
  the promotion entirely — no branch, no worker, no PR — so the change simply
  vanished. The plan is now kept and quarantined instead: the non-verified
  status routes it through the trusted AI worker, and the PR it opens carries
  `source-lineage-unverified` plus the exact reason it could not be proven.
  Nothing merges without a human either way; the failure mode changes from
  "silently nothing" to "a PR you can reject". Operational inspection failures
  are still errors — there the patch state is genuinely unknown — but they now
  surface on the source PR and retry next run. — Claude (AI), 2026-08-10
- **Admin-selected conflict model now covers every protected AI runtime**: the
  `github-actions` control plane passes its validated Thingtime Admin primary
  model into merge- and rebase-side Graphify semantic refreshes as well as the
  Claude conflict edit. Clean rebases now load the setting before Graphify,
  and the control-plane contract inventories all active AI workflow/action
  YAML while rejecting legacy or hardcoded model selections. — Codex (AI),
  2026-08-10

### Added

- **Control-plane pushes sweep every open PR, plus a `no-ai-merge` opt-out**:
  pushing the `github-actions` branch now runs a repository-wide conflict
  sweep instead of matching only PRs based on that branch, so landing a
  resolver change retries every conflicting PR immediately rather than waiting
  for the twice-hourly schedule. PRs labelled `no-ai-merge` (the new
  never-auto-resolve opt-out, narrower `no-ai-rebase`'s counterpart) are
  dropped by the detector before any comment, dispatch, or AI spend. — Claude
  (AI), 2026-08-10
- **One merged PR can promote to several branches**: the promoter had exactly
  one target, so a source PR owing changes to two branches — #211 converts
  `main` to thin listeners *and* carries the implementation those listeners
  call, which may only live on `github-actions` — could never be expressed; the
  half that didn't belong on `main` just conflicted and the promotion died.
  Each configured target now gets its own pass, branch (`…-to-<target>`),
  promotion record, and PR, and a pass whose replay doesn't apply cleanly goes
  to the trusted AI worker exactly as a single-target conflict does. Nothing
  path-routes the split — the same file legitimately contributes different
  content to different bases, so the per-base replay and the worker decide.
  Off by default; set the `PROMOTION_TARGET_BRANCHES` repository variable to
  enable. — Claude (AI), 2026-08-10
