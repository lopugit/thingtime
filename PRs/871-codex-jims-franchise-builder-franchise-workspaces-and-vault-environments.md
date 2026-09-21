# PR 871: franchise workspaces and Vault environments

The builder can insert a reusable native service workspace. Ordinary data Things
and native folders hold customers, properties, jobs, visits, team memberships,
equipment, sub-jobs, time and resource logs. Growing comments and attachments
remain independent Things. The old franchise builder page and records are
preserved during rollout; the production HQ will use this native block.

## Access and integration boundaries

The owner is always an assignable Admin. Admins manage memberships; Employees
and Lopu users manage operations; Customer/B2B memberships follow an explicit
customer and active address links. Generic shared writes remain denied. Private
ACL changes, moderation, custom data endpoints and scoped tokens do not bypass
workspace access. Every fresh request rechecks current memberships. Edits and
planner moves use expectedUpdatedAt to reject stale writes.

Google Places calls go to fixed Google endpoints with bounded requests/responses.
Only the designated JavaScript key is returned to authorized browsers. CSP
allows fixed Google Maps SDK/service hosts and retains the application bans on
executable inline scripts and eval. The Places
key stays server-side. Vault environment moves edit metadata without decrypting or
replacing ciphertext. README contains fork-safe setup with placeholders only.

## Validation as of 2026-09-21

- Full Vercel production build and output verification passed after syncing main.
- 72 capability tests; schema and Vault mover tests passed. Existing Things, ACL
  and webpage suites passed. Full typecheck retains errors in unchanged files;
  no changed-file errors remain.
- Dedicated local Mongo integration passed role isolation, owner protection,
  explicit private ACLs, revocation, comments, scheduling conflicts, relational
  references, resource validation and encrypted Vault value preservation.
- Chrome desktop and 390px mobile: direct edit/duplicate menus, recoverable
  delete/restore, dialog stacking, property→job→visit, native date/time inputs,
  drag/date/order planner controls, automatic time totals, resource/travel logs
  and visit comments. Vault creation, environment move, cancel and Ungrouped
  verified with synthetic local entries. Mobile Vault rows corrected.
- Local media chooser and before/after states work; private storage is deliberately
  unconfigured in the isolated fixture. Stored-file and live Maps acceptance will
  run on the deployed app using the existing production integrations.
- Local web: http://localhost:18940 (HMR 18941, Nitro 18942; Mongo 18943).
  Tailscale launcher points to missing /Applications/Tailscale.app, so no verified
  Funnel URL is available.
- Graphify refreshed changed code and documentation via the local proxy, with
  graph/manifest path coverage and regenerated portable HTML verified.

PR: https://github.com/lopugit/thingtime/pull/871
