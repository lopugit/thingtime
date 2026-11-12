# PR 1280: Builder Thing identity and navigation

Owned Builder Things open their editors from the Things library and shared
iconized links. Context menus expose **Open in Builder** for owners and **Open
live page** where the Thing has a supported presentation. Ordinary Things,
nonowner navigation, data inspection and canonical copy/share links retain
their existing behavior.

The existing `thingtime` schema array stores the composable `builder-thing`
marker. Canonical Builder content kinds and app folders are detected for
legacy records and normalized when saved; Builder-created data and folders
opt in explicitly. The marker grants no authority and does not choose a
renderer. Explicit render components retain their existing contract.

The generic `/builder?thing=<id>` entry reuses the existing definition editor,
validates the exact returned ID and owner, and keys editor state by account
and Thing. API contracts advance to `api.things` 1.46.0 and
`api.things-update` 1.15.0. Draft previews and archive destination validation
continue to validate the underlying content kind independently of the marker.

## Verification on 2026-10-29

- Focused schema, presentation, capability, draft/archive and navigation/menu
  tests passed. Changed-file lint had no errors; TypeScript ratchet had zero
  errors. Production client and Nitro server builds passed.
- The committed `remix/scripts/builder-thing-navigation-acceptance.mjs` uses
  a disposable replica set, real registration/Things APIs and task-owned
  Chrome for Testing. Fifty-one desktop/mobile checks passed across grid,
  list and columns, seven Thing categories, live content compared to seeded
  data, edit/save/exact readback/reload, keyboard dismissal and nonowner refusal.
- Three supplemental checks passed for actual Builder app/data creation with
  marker readback, mobile menu bounds and reachability, icons and keyboard
  activation. Browser page errors: zero. Test processes and data were removed.
- Browser acceptance used the Vite shell backed by the built Nitro API. It
  does not establish standalone Nitro static-shell or production acceptance.
- Feature maps and TESTING.md contain the repeatable checks. Graphify was
  refreshed through the repository wrapper; changed documents were found in
  both graph and manifest. Existing extraction limitations include partial
  source parsing, older semantic cache entries and nodes without source-file
  metadata; those are not claimed as full semantic coverage.

## Integration and remaining evidence

Branch `codex/builder-thing-navigation` started at main
`81ab6ebad0c21902c320a5457e42d72270030326`. Main's later Password AutoFill
changes were integrated without feature-code conflicts; changelog entries
were retained together and immutable graph snapshots regenerated.

The user explicitly authorized this feature's merge into main. PR checks,
preview/deployment URLs and the merge receipt are recorded on
[PR 1280](https://github.com/lopugit/thingtime/pull/1280).
The authenticated production owner flow remains a separate acceptance layer;
private Character/overview reporting was unavailable in the current session.
