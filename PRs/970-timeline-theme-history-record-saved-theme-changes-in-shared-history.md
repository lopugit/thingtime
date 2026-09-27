# PR #970 — Record saved theme changes in shared History

Saved theme creation, token/visibility edits and deletion now append revisions
through the shared relational Timeline. They preserve the existing parent chain
across library renames and managed folder moves. The dedicated writer pins
content, event, head and storage to the home database in one transaction, even
with a custom data-source header. No new collection or index is introduced.

The browser-safe `theme-content` v1 adapter captures only approved fields. Its
allowlist is independent of current theme defaults, so historical partial
tokens remain exact. Unknown protected extensions are excluded. The strict
decoder rejects extra fields and malformed values. Client-authored drafts
remain fully metered; server revisions use the exact approved content payload.

Unchanged saves create no event. Theme deletion replaces the approved live
payload with its retained before-version, so it works at the storage ceiling
without admitting new growth. Invalid, refused and repeated operations do not
create successful-change events. Source/actor attribution comes from the trusted
server mutation context, never request-body claims.

## Validation

- Real HTTP theme suite passed on the guarded disposable replica: normalized
  creation, no-op, rename/move/content ancestry, visibility changes, private
  history, wrong-owner and generic-restore refusal, retained deletion and retry.
  A custom data-source selection still charged the home live content and
  revision exactly.
- Extended real HTTP quota suite passed: edits at the exact storage ceiling
  return 507 with unchanged data, timestamps, head, history and accounting;
  deletion retains the exact approved payload without increasing used bytes.
  Existing ordinary-Thing/folder/restore quota cases still pass.
- Full unit suite before the final capability assertion/main refresh: 4,206
  passed, eight skipped. Refreshed capability suite: 92 passed. Required CI
  validates the final pushed head after the graph refresh.
- Production Vite/Nitro build and Vercel output verification passed on the
  refreshed main base. Changed-source/script lint has no errors (one existing
  import-type warning). Raw TypeScript has the existing 91 diagnostics; none
  are in the new theme history code. This is not a clean typecheck claim.
- Browser acceptance: Thing actions → History shows the saved theme's creation
  and original approved token values. [Screenshot](assets/970/theme-history.png).

Timeline capability is 1.5.0; themes and themes-delete are 1.1.0. README documents
the opt-in local acceptance commands; TESTING records regression checks.

## Remaining scope

Theme restore/merge, active-theme selection, legacy-theme history and automatic
home-history discovery while browsing a custom data plane remain open. The
strict adapter does not claim compatibility with corrupted protected rows.
Theme transfer imports use the same dedicated create/delete writers; a later
compensation deletion retains both recorded events and is not a whole-import
rollback. The wider delivery ledger remains in docs/unified-timeline.md.
