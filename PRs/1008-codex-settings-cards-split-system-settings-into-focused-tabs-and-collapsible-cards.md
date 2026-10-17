# #1008 — Focused admin tabs and collapsible settings cards

The former System panel is divided into AI Providers (credentials, model access,
catalog, chat defaults and conflict-resolution models), Lopu (base prompt and
accounts), Platform (integration secrets and deployment environment), and
Access & limits (rate limits and administrators). Existing System links resolve
to the matching tab and preserve their anchor.

Personal Settings and the popup use the same native details/summary cards.
Headers show a title, description, and available metadata. Forms remain mounted
while hidden, so closing a card preserves its draft. Anchor navigation opens all
containing cards and leaves unrelated cards closed. Setting labels take a useful
line width and wide controls wrap below them on narrow screens.

No server mutation, credential exposure, permissions, or storage contracts change.
Credentials and environment values still use their existing verification flows.

## Verification (2026-10-17)

- `test:settings`: 38/38; `test:admin-integrations`: 25/25;
  `test:lopu-ui`: 233/233.
- Targeted ESLint passes. Raw TypeScript reports 91 diagnostics on both the
  unchanged base and this branch, with zero added or removed diagnostics. The
  existing nonblocking ratchet baseline is 89; this change does not alter it.
- The browser fixture mounts the real shared card and row components and passes
  at 1280px and 390px: collapsed defaults, pointer toggles, retained draft,
  nested anchors, readable labels and no page overflow. Enter and Space were
  also exercised with an edited draft.
- Every anonymous personal category was checked in both page and popup at
  390px. Actual admin components with synthetic read-only data were checked
  at 1280px and 390px, including all four new tabs, expanded controls and both
  legacy System anchors. No narrow vertical text strips or overflow were found.
- The local and hosted anonymous admin routes retain their access gates. Initial full-app
  checks were delayed by a shared PM2 restart and Nitro runner startup timeouts.
  The hosted develop preview for the source commit rendered successfully;
  authenticated production and final delivery evidence are recorded in the PR.
- Graphify structural extraction refreshes code relationships. The local semantic
  proxy did not respond to its health check, so Markdown semantic indexing is
  unverified; no secret or model key is required for the structural refresh.

The fixture uses synthetic form fields and does not prove authenticated server
mutation behavior. This UI change is verified without changing real account,
provider, or security settings.
