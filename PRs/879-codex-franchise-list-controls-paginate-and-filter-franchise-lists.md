# PR #879: Paginate and filter franchise lists

Franchise directories, dashboard visits, related records, history, planner days, time/resource logs, Trash, comments, and galleries now have consistent search, result counts, Show 5/10/15/20/Infinite scrolling, and numeric page navigation. Applicable status, employee, role, category, and record-type filters use the authorized workspace snapshot.

Filtering resets the visible window. Numeric navigation returns the controls to view. Infinite mode appends ten records, with a manual fallback and an end marker. Cursor-backed comments and media traverse older authorized pages for search, stop on errors or non-advancing cursors, and expose retry. Other ThingComments consumers retain their existing UI. Planner moves use full-day ordering across pages; upcoming visits sort by date/time and no longer truncate at eight.

## Validation

- Production build and Vercel output verification passed.
- Typecheck ratchet passed at the existing 89-error baseline; 8 focused tests passed.
- Chrome desktop and 390px mobile: all numeric sizes, page navigation and reset, clear filters, no-match state, 29-record infinite-scroll completion, status and employee filters, and planner reordering across a page boundary.
- Cursor coverage: search found an older comment beyond the first server page; gallery found photos behind 60 newer plain-text comments.
- Top-to-bottom layout checks and result-window measurements found no horizontal overflow; menus and media controls remain usable.
- Graphify snapshot and manifest include all new collection/filter sources. TESTING.md records the regression checklist.

No HTTP request/response or capability contract changes. The larger synthetic dataset exists only in the isolated local test database. Production original customers and properties are retained.
