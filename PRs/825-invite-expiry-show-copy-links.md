# PR #825: Invitation expiry and show/copy links

New invitations default to Never expire, with 1, 7, 30 and 90-day options. Owners can reveal/copy pending links after reloading. Older hash-only links require an explicit replacement confirmation; replacement preserves expiry and credits and invalidates the old token, including already prepared signup attempts.

API contract: api.auth-invites 2.0.0 (new default and nullable expiry). List/preview whitelist profile fields; only the authenticated owner link action returns bearer material. Closing an invite clears protected state.

Validation: invite, capability, schema and accounting suites; changed-file lint; full Vercel build and output verification; 25/25 read-only auth API checks; desktop and 390px Chrome settings page/popup checks; zero-credit create, reload, reveal/copy and cancellation. Typecheck has existing diagnostics outside the changed files. PR CI and deployment status are authoritative for the final merged revision.

Local URL: http://localhost:17360/settings/account. Tailscale unavailable: the installed CLI wrapper points to a missing executable. Graphify structural refresh is complete; the incremental CLI does not semantically re-index Markdown. Retain the main snapshot alongside this branch snapshot to avoid Git treating independent immutable snapshots as conflicting renames while other PRs land.
