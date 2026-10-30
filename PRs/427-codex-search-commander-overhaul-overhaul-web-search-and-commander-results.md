# PR #427 — Overhaul web search and Commander results

Branch: `codex/search-commander-overhaul`

## Scope

- Commander searches live ACL-aware Things, rendered posts, schemas/data, and public people while retaining bounded local-path suggestions.
- Enter with no highlighted row defaults ordinary text to the pinned `Search things for…` action; explicit rows and setter commands keep their existing behavior.
- `/search` defaults to Standard rendered results, retains Data mode and canonical Thing deep links, and shows the real query-relative `rankScore` as subdued result metadata.
- `/thing/:id` renders the existing interactive `PostCard` inline for post-shaped Things while preserving the raw Thing data view and post permalink.

## Regression focus

- Keyboard and click navigation must open exactly one destination.
- `rankScore` appears only for server-ranked text results and survives cached paint/load-more; chronological results never synthesize a score.
- Post-shaped Thing detail performs one Things read, keeps reaction overlays current, and renders both the inline card and JSON at desktop/mobile widths.
- Anonymous and authenticated search projections retain their existing ACL boundaries.

## Validation log

- 2026-08-27: focused Commander and ranked-projection unit tests pass (7/7).
- 2026-08-27: targeted ESLint passes with zero errors (existing hook-dependency warnings remain).
- 2026-08-27: full `tsc --noEmit` reaches the repository's pre-existing baseline errors with no errors in changed files.
- 2026-08-27: `typecheck:ratchet` passes at 138 errors, down from the 143-error baseline; the full Vercel production build/output verification passes.
- 2026-08-27: in-app browser QA passes at 1280×720 and 390×844 for Standard/Data scores, unranked score omission, Commander unselected Enter, inline PostCard comments, canonical links, top-to-footer scroll, overflow, and console errors (none).
