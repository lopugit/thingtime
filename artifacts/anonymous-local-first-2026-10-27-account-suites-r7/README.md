# Native suite retry 7 — preserved-version recovery failure

This real isolated browser run failed after the second conflict's “Use original
device version · Private” choice. The queue remained in conflict with “Remote
content changed. Your local edits are preserved.” The complete flow is not a
pass. See `test.log` and the exact package/source hashes in `source.json`.

Before that failure, the normal UI verified:

- Two concurrent offline Install controls produce one held local graph, then
  Run example, separate edits/save and cold reload work without account writes.
- Reconnection adopts the uncached canonical suite IDs without duplicate
  definitions, preserves unrelated account customization and presents the
  overlapping edit for explicit review.
- Keeping the reviewed device version syncs; the original provisional Component
  URL remains editable after canonical adoption and cold reload.
- A separate browser context signs in normally as the same synthetic account
  and selected plane, changes and reads back its account version while the
  primary browser's actual authenticated transport remains offline. No cookies
  or session tokens are copied between contexts.
- Both conflict reviews were captured at 1440/390/320px, including measured
  top-to-bottom traversal of the page and every visible comparison pane.
  The narrow status row now stacks its button below the text. Visual review of
  the phone captures confirms that correction and no floating editor overlap.

`suites-ui/independent-control.json`, `connectivity.json`, the scroll/view-ready
records and PNGs retain that partial evidence. They do not establish success of
the later recovery choice, final saved example or old page URL after recovery.

The task-owned browser and real replica-set backend remained in the enforced
network-none namespace. Cleanup reports an empty remaining runtime inventory.
The sanitized build passed; TypeScript retains 91 baseline diagnostics with no
added or removed normalized errors. This is local evidence, separate from CI,
deployed and installed-device acceptance. The shared proxy/key was unchanged.
