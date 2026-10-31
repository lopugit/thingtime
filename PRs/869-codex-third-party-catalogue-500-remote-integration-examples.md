# PR 869 — 500 remote integration examples

Depends on the runtime merged first in PR 866 (`8d77b4fab`).

## What ships

`/library` and `/library/:id` expose 500 recipes across 42 libraries/services:
380 transformation recipes, 45 visual demos and 75 API Things. 468 examples
need no credentials; 32 provide per-demo API-key entry and official account
links. Search, category/provider/type/access filters, pagination, editable JSON,
source, documentation links and private reusable Things are included.

The 26 remote packages include Chart.js, Mermaid, Three.js, D3, Lodash, date-fns,
Day.js, Math.js, Zod, Validator, Chroma, Luxon, Fuse, Papa Parse and QRCode.
The 16 API providers include GitHub, OpenAI, Anthropic, Stripe, NASA, Open-Meteo,
OpenWeather, TMDB, GIPHY, Pexels and public learning/culture APIs.

Credentialed registry activation deliberately bumps `api.library-request` to
1.1.0 in the registry, origin manifest, client requirement and documentation.
Saved copies contain default data, a preparation action and a runnable component.
Native preparation actions return inputs; the component executes the remote
operation on Run. Credentials and live results are never included in saved Things.

## Acceptance (2026-09-21)

- 9 runtime/catalogue tests pass, including 500 unique recipes, compilation of
  every snippet, pinned URLs and validation of all 1,500 generated Things.
- 71 capability tests, targeted ESLint, a full production build and generated
  Vercel output verification pass. Full repository typecheck has baseline errors;
  the required CI typecheck ratchet is the release gate.
- Chrome executed 467/468 public defaults in one full sweep. The sole remaining
  Open Library ISBN request used an obsolete endpoint; its direct edition
  replacement passed a focused rerun. All 468 accepted recipes executed.
- Earlier sweep failures found and fixed Chart.js generated syntax, opaque-frame
  module worker bootstrapping, Validator's RgbColor export spelling, redirected
  GitHub defaults and an oversized Pokémon sample. These were actual executions,
  not static link checks. The development-only browser harness remains available.
- A saved private Component Thing ran Lodash chunking. Its native Action Thing
  returned the exact expected example ID and input JSON through the normal action
  invocation UI. Both the saved component and input data use private ACLs.
- Chrome at 390px and desktop widths covered key show/hide/clear, live Stripe-key
  rejection with a non-secret fixture, cancellation and rerun, search/no results,
  pagination, source/reuse views, wrapping and full-page scrolling.

No real provider credentials were used. Successful account-specific reads depend
on the visitor's key, permissions, provider availability and quota.

The local acceptance URL is http://localhost:19450/library (HMR 19451, Nitro
19452). Tailscale Funnel is unavailable because the installed wrapper points to
a missing Tailscale application. Branch preview and production are verified
through Vercel and the PR checks before release.

A final sweep on the release candidate completed with 466/468 immediately
successful executions; both CSV cases passed their focused rerun without code
changes, so transient external execution failures remain possible. The deployed
Vercel chart rendered correctly. Its nested iframe was changed to `display:block`
to remove the inline baseline gap and unnecessary outer scrollbar.
