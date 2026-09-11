# PR 768 — Refresh AI guidance from two months of PR history

[PR](https://github.com/lopugit/thingtime/pull/768) ·
`codex/thingtime-ai-guidance-20260911` → `develop`

Repeated requests and follow-up fixes now inform the canonical root
[AI_ALL.md](../AI_ALL.md). Its working instructions retain every existing topic,
add recurring development lessons, and correct stale hook/typecheck and branch
lane advice. The full global file is preserved verbatim in a reference-only
appendix. Root `AGENTS.md` and `CLAUDE.md` remain relative symlinks; the live
global file and global symlinks are unchanged.

The [review](../docs/ai-guidance-review-2026-09-11.md) records the time window,
exact product/controller checkpoints, coverage limits, recurring failure
families, current source paths and representative PR/discussion links. The
[inventory](../docs/ai-guidance-pr-inventory-2026-09-11.json) records all 750
selected PRs, including 707 opened in the window. This is a history and current
source review, not an exhaustive line-by-line review of every historical diff.

Validation covers exact preserved bytes/hash, original repo topic retention,
relative instruction aliases, local links and cited source paths, all unique
inventory PRs, balanced Markdown fences, token/signed-URL pattern checks and
patch hygiene. All 21 existing Graphify CAS tests passed. The manual instruction
regression checklist and changelog are updated. No app runtime changed, so this
documentation task does not claim a new browser, provider or device acceptance run.

Graphify semantic extraction ran through the local proxy. The installed
extractor compares returned `source_file` strings with detected filenames before
stamping semantic manifest entries; relative/absolute path differences can leave
a document present in the graph but absent from the manifest. This was observed
for the new review and is why the final refresh includes a structural pass plus
explicit graph/manifest membership and source-fingerprint checks. Semantic
manifest provenance must not be inferred from command success alone; this PR
does not change the installed extractor or claim to repair its wider identity
collision limitations.

The attached checkout had an unfinished merge and unrelated edits. Work stayed
in an isolated checkout of the current integration source. The PR remains open
for review; there is no primary-branch merge or production mutation. Exact-head
CI and preview outcomes belong to the live PR checks and delivery message,
rather than becoming evergreen policy in the root file.
