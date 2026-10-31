# PR #389 — Load all Commander result icons without blocking

Branch: `codex/fix-commander-stuck-spinner`
PR: https://github.com/lopugit/thingtime/pull/389

## Follow-up scope

Commander previously made the launcher responsive by requesting a native Finder
icon only for the focused result. That avoided a main-thread burst, but left
every other result with a generic icon.

This follow-up restores real icons for all current, visible search results
without restoring the burst:

- The renderer has a bounded 512-entry / 24 MiB LRU cache, a short negative
  cache for unavailable paths, and one coalesced request per path.
- The selected result has priority; surrounding rows follow by distance after a
  short debounce. At most two native bridge requests may be outstanding.
- The native host validates and canonicalizes paths, coalesces duplicate
  callers, and caches rendered PNG data by canonical path.
- AppKit icon lookup and bitmap encoding deliberately remain serial, one render
  per main-loop turn. This is the safe boundary: it prevents AppKit work from
  starving the menu-bar app while the renderer keeps the small request pipeline
  full.

## Regression coverage

- A 30-result launcher test proves all unique paths are eventually requested,
  the selected row is requested first, and the bridge never has more than two
  outstanding icon calls.
- A remount test proves a cached Finder icon does not call the bridge again.
- A native queue test proves duplicate concurrent path requests coalesce and
  the successful asset is reused from the host cache.
- The Commander manual regression checklist now requires all visible rows to
  resolve progressively and a repeated query to use the cache without a
  beachball.
