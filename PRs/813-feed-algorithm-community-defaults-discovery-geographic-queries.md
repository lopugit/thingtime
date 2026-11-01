# PR #813: Feed algorithms, discovery and geographic queries

## Changes
Adds Hot, New, Top, Rising, Controversial, Local, Global, and Political to the feed picker, plus `/algorithms` for searching, creating, explicitly publishing, sharing, and branching personal algorithms. Existing shared profiles remain unlisted until their owner publishes them.

Local supports a chosen location tag or an explicitly requested browser location. Things accept validated latitude/longitude, store an indexed GeoJSON point, and support radius queries while preserving existing access controls. API manifests and client capability requirements cover the new contracts.

## Validation
- Production build and Vercel output verification passed.
- Feed/ranking suite: 54 passed; capability suites: 61 passed; geographic/index and request transport tests passed.
- Real local API integration: 22 checks passed, including listing consent, ownership, every preset, nearby queries, private-post exclusion, invalid coordinates and clearing coordinates.
- Chrome desktop and mobile: directory search, creation form, full picker, Local controls and page scrolling inspected.
- Typecheck reports existing baseline errors; no new feature errors identified. Physical browser geolocation permission has not been exercised.
- A later integration repeat reached the signup rate limit; the earlier full successful run is retained.

Ranked presets use the existing bounded 400-post candidate window. Geographic coordinates are optional; selecting browser location does not automatically attach it to posts.

Local: http://localhost:13480. Tailscale unavailable because the configured executable points to an absent application.

## Graph and delivery
The CAS graph was refreshed with semantic extraction for documentation and structural extraction for code. Existing cross-chunk node-ID collision warnings remain; portable graph, report, manifest and local HTML were generated successfully.

PR: https://github.com/lopugit/thingtime/pull/813
Branch: `codex/feed-algorithm-community`

Directory pagination keeps duplicate legacy/current IDs together at cursor boundaries; current records remain authoritative after unpublishing.
