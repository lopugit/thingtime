# PR #929 — Load editable collections from paged Action sources

https://github.com/lopugit/thingtime/pull/929

Collections can request incremental pages through a saved Action. This removes the need for a media gallery to eagerly fetch every record, while preserving authored rows, ordinary collection controls, existing viewer/shared read authorization, and copied Action dependencies.

The source config accepts a literal Action, scalar inputs and mappings for rows, cursor input/output and stable row identity. Accumulation deduplicates row keys, continues empty pages, rejects cursor cycles, and stops at 200 pages, 10,000 rows or 4 MB. Refreshes retain visible data until the replacement resolves. Failed pages preserve data for retry; denied access clears it. Query/account/page changes invalidate stale completions. Fixed filters retain the paging cursor, and loaded counts can drive editable summaries through the existing bounded local UI state.

Validation:

- 52 focused paging, template and composition-copy tests passed.
- Builder suite: 138 passed, 3 skipped.
- Lint clean; typecheck remains at the existing baseline of 89 errors.
- Full client/server build and Vercel output verification passed.
- Local browser: next page across an empty cursor page, stable-key deduplication, search/refresh, changing target, offline retry without losing earlier rows, infinite scrolling, fixed filtering and loaded-count presentation.
- Synthetic copied HQ customer edit saved and closed correctly. Its media gallery is being connected through ordinary saved Actions/Components; production HQ remains unchanged by this source PR.

No credentials or production business records are part of the fixture or branch.
