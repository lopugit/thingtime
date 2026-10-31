# PR 57 — Share Thingtime through a single-file embed SDK

Branch: `codex/thingtime-embed-sdk`
PR: https://github.com/lopugit/thingtime/pull/57

## Summary

- Builds Thingtime as one verified, minified classic-script IIFE at
  `/embed/thingtime.min.js` for use from any website.
- Provides declarative and JavaScript APIs for mounting the whole thing or a
  nested path into multiple Shadow DOM targets backed by one shared state tree.
- Injects a responsive in-page Thingtime popup with editing, undo/redo,
  subscriptions, load/save status, and access to the full editor.
- Opens the existing Thingtime editor in a top-level first-party popup for
  authenticated editing and explicit save confirmation without exposing the
  account cookie or bearer token to the host website.
- Adds `kind: 'embed'` things with public CORS reads, owner-only private/list
  access, optimistic versioned updates, JSON limits, and an owner quota.
- Adds API reference entries, smoke tests, a copy-paste guide, an interactive
  security-canary demo, build verification, refreshed Graphify outputs, and
  Graphify repository hooks.

## Architecture and security

Direct host-page mounts use a dedicated JSON-only renderer. Persisted values
cannot invoke `thing.exec`, revive functions, interpret dynamic Chakra
components, inject raw HTML, or publish legacy globals. Values and paths are
bounded and reject Mongo/prototype-pollution keys; public SDK calls return
cloned snapshots so host mutations cannot bypass state history or rendering.

The full legacy editor is included in the one physical bundle but initializes
only when `/embed/bridge.html` loads it in the Thingtime-origin popup. Parent
and popup validate the exact source window, origin, random channel, and
protocol on every message. Cross-site saves require an explicit user click in
that window. API writes require JSON and reject cross-origin cookie auth, while
explicit bearer clients remain supported.

## Validation

- `corepack pnpm --dir remix run build`
- Embed verifier: exactly one classic JavaScript asset, no CSS, source map, or
  auxiliary chunk; approximately 1.70 MB and 485 KB gzip.
- Full Nitro/Vercel output verifier confirmed the Vite shell, embed bundle,
  bridge/demo files, filesystem routing, and SPA fallback.
- Targeted ESLint completed with zero errors; existing legacy hook warnings
  remain in the pre-existing Thingtime components.
- Type-check filtering confirmed no errors in the new embed/API files; the
  repository-wide check still reports its established unrelated baseline.
- Desktop and 390px mobile browser QA covered full-page scrolling, editing,
  popup open/close, shared nested mounts, undo, overflow, and console output.
- Real Chrome verified the first-party secure popup handshake and
  bidirectional edits between the full editor and all host mounts.
- The demo verifies host-global isolation, immutable public snapshots,
  subscriber exception isolation, stored-XSS-shaped values, and unsafe paths.
- Direct API probes returned public CORS `404`, non-JSON write `415`,
  cross-origin cookie write `403`, and same-origin anonymous write `401`.
- Local and public Funnel demos returned the exact generated bundle and ran
  without console errors or horizontal overflow.

## Known follow-ups

- The full editor keeps existing legacy `eval` code in the physical bundle,
  which produces build warnings. Direct host rendering disables those paths;
  a future dedicated safe editor can reduce the bundle and remove them.
- Add automated multi-browser coverage for popup blocking/closure, hostile
  message origins, authenticated persistence, optimistic `409` races, and API
  payload limits. An authenticated production database mutation was
  intentionally not performed during local QA.
- Publish a versioned/SRI asset alongside the stable URL before promising
  long-lived third-party cache compatibility.
