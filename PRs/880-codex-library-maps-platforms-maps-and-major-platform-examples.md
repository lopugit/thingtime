# PR #880 — Maps SDKs and major platform examples

The library adds 40 examples and now contains 540 examples across 51 services.
Mapbox, Google Maps JavaScript and Google Places include 14 interactive SDK demos;
26 fixed REST examples cover maps, Places, YouTube, Spotify, Microsoft Graph,
GitLab, Cloudflare and Contentful. Generated builder content includes an index,
51 service pages, 540 individual pages and 540 reusable components.

Browser keys enter only the official provider SDK in an opaque-origin frame.
The dedicated SDK document scopes Google compatibility CSP separately from the
main application and ordinary package demos. Clear disposes the frame and key;
source and saved Things contain placeholders/sample input only. Server requests
remain authenticated, bounded, fixed-origin, nonredirecting and redacted.
`api.library-request` 1.2.0 adds fixed read-only Places POST templates.

Validation before review:
- Full production build and Vercel output verification passed.
- 17 library tests and 74 API capability tests passed; focused lint passed.
- Typecheck ratchet passed at the existing 89-error baseline.
- Local API seed: 1,132 received, 89 created, 543 refreshed, 500 unchanged;
  second seed: all 1,132 unchanged, zero skipped. Anonymous seed returns 401;
  non-admin seed returns 403; unknown catalog returns 400.
- Public API readback verifies the 51-service index and Mapbox (9), Google Maps
  (5), Google Places (7), Spotify (4), individual and existing provider pages.
- Chrome checked invalid Google/Mapbox credentials, Clear, Source and Reuse;
  320px/390px mobile layouts and the long grouped service page do not overflow.

Provider contract fakes exercise all SDK recipes. Successful calls with real
account credentials, billing and scopes are not claimed: each example requires
its user's own enabled provider credentials. Setup links and restrictions are
included beside every credential field. No private provider key was used.

Local development: http://localhost:18860 (HMR 18861, Nitro 18862), isolated PM2
entry `tt-wt-library-maps-platforms-18860`. Tailscale Funnel unavailable because
this machine's Tailscale application is absent. PR checks and Vercel deployment
provide the release evidence; production content is refreshed through the
existing administrator seed action after the code deployment is ready.
