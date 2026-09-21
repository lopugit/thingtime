# PR #875 — Integration builder pages

The library now has one native builder index, 42 provider pages containing every example for that provider, and 500 individual example pages. Pages reference 500 reusable component Things. Both the page hierarchy and components derive from the existing catalogue; the largest service (60 Lodash examples) stays within the 120-block cap. Each embedded component links to its own builder page.

## Setup and contracts

An admin selects **Prepare builder pages** on `/library`, after the client negotiates `api.admin-webpages-seed-demos` 1.2.0. `POST /api/v1/admin/webpages/seed-demos?catalog=integrations` reconciles only these 1,043 public system Things with the existing genuineness-fenced batch writer. No new endpoint or permissions are introduced; anonymous/non-admin calls remain 401/403, and unknown catalogue values return 400. General seed calls retain their previous behavior.

Copies of shared/public templates start private; owned pages retain their audience. Input argument changes remount the demo so the displayed inputs match the saved block. API keys and runtime results never enter page/component crystals. Public API and module execution still requires an explicit Run.

## Validation

- Library 12/12, capability 73/73, builder 105 passed with 3 optional tests skipped. Production build and Vercel output check passed. Changed-file ESLint passed.
- Real API seed: 1,043 created, next run 1,043 unchanged, zero skipped. Authentication and invalid-catalog gates verified.
- Chrome desktop/390px/320px: linked index/service/example pages, 60 Lodash components on one page, remote chart and transformation execution, inspector controls and page scrolling without horizontal overflow.
- Private chart copy persisted custom inputs, reopened and returned two chart points. Anonymous access to the copy returned 404; the public seed remained unchanged.
- Local typecheck ratchet is non-blocking: 116 errors versus baseline 108, all outside changed files after correcting the two new type errors.
- Graphify code graph/manifest refreshed atomically and HTML regenerated. Installed incremental updater does not semantically index the changed Markdown.
- An exhaustive resolve smoke stopped at the rate limiter (429) after hundreds of successful pages; full catalogue schema/link coverage is deterministic, and key service and individual pages were checked live.

Local QA: http://localhost:19460/library, PM2 `tt-wt-library-builder-pages-19460`, Vite/HMR/Nitro 19460/19461/19462. Tailscale/Funnel is unavailable because the local launcher points to a missing Tailscale application.

Preview QA also created all 1,043 Things, ran TVmaze live data, followed its individual builder link, and verified the key Show/Clear controls at 320px. Singular service counts are grammatical; long account names are bounded in the header, with mobile search opening below it, so controls do not overlap.
