# PR 816 — Lopu uploads, provider media, HTTP and mobile keyboard

## Behavior

- Native `tt-upload` / Chakra `Upload` controls use Thingtime's standard upload,
  moderation and private post-attachment flow. Explicit Use file populates an
  authenticated content URL and attachment ID in the surrounding form. Optional
  URL fallback, retry identity and read-only/shared guards are retained.
- Chat resolves actual image/PDF/text bytes from authorized attachment IDs,
  including recent conversation attachments. It checks ACL/moderation/version
  before and after download, bounds individual and aggregate bytes, and reports
  unsupported/unavailable files honestly. Bytes/signed URLs are not persisted.
  Claude/OpenAI requests receive native content blocks; the Claude OAuth bridge
  keeps them across tool hops instead of serializing base64 into transcript text.
- `fetch_url` reads public HTTPS text/JSON. `http_request` requires a single-use
  confirmation bound to the exact method/URL/headers/body. Scheduled turns cannot
  mutate. The browser SDK negotiates `api.lopu-network@1.0.0` and calls the
  authenticated, rate-limited Nitro/Vercel gateway. Public DNS is pinned into the
  socket, private addresses and redirects are refused, and no ambient cookies
  or automatic mutation retries are used. Limits are documented in README.
- Mobile page and floating sheet follow visual viewport resize/pan events.
  Attachment panels and long text scroll independently, keeping Send visible.
  Keyboard-open safe-area padding is removed. Desktop layout remains bounded.

## Validation (2026-09-16)

- 249 focused Lopu/media/HTTP/UI/capability tests passed; 23 provider streaming
  tests passed, including fake SSE transport inspection of image/PDF payloads.
- Component suite: 38 passed. Webpage suite: 91 passed, two existing browser
  integration skips. Targeted ESLint passed without code warnings.
- Production build and Vercel-output verification passed.
- Raw TypeScript comparison: base and branch each have the same 115 diagnostics
  after normalizing source line positions; no added diagnostic. The repository
  ratchet's stored baseline is 108, so it still reports seven pre-existing errors.
- Local origin manifest advertises chat reply 1.10.0 and network 1.0.0;
  unauthenticated network POST returns 401. The HTTP transport fetched public
  example.com successfully; tests cover mixed/private DNS, redirects, byte caps,
  unsupported content and exact confirmation binding.
- Chrome: 1280x900, 390x844 and 390x444. Checked page and floating sheet,
  expanded attachments/model menu, top-to-bottom scrolling and composer bounds.
  At 390x444 with attachments open, the full-page Send button ends at y=419;
  the floating sheet composer ends at y=436. No horizontal overflow.
- A temporary synthetic browser harness exercised the native file picker,
  completed-upload state, Use file and exact hidden form values/private post
  payload. Network was mocked and unmatched calls refused. Harness was removed.

## Acceptance boundaries

The available browser account lacks Lopu/upload approval; no permission was
changed. Real-account storage upload and selected-provider inference have not
been accepted live. Physical iPhone keyboard, viewport panning and safe-area
behavior still require device testing; desktop resizing is not that proof.
Unsupported provider models may reject native media; the app does not silently
switch providers. The user subsequently authorized merging this PR into main. Before merging,
main was incorporated and the navigation source-contract test was updated for
the visual-viewport geometry; its obsolete fixed-height assertion caused CI to
fail despite the dedicated Lopu UI suite passing.

## Local and deployment

- Branch: `codex/lopu-attachments-sdk-mobile`.
- PR: https://github.com/lopugit/thingtime/pull/816
- Local: http://localhost:15420/lopu (HMR 15421, Nitro 15422).
- PM2: `tt-wt-lopu-attachments-sdk-mobile-15420-1238pm`; no autorestart,
  zero restarts when verified, reachable and saved through PM2.
- Tailscale/Funnel: unavailable; the installed launcher references a missing
  `/Applications/Tailscale.app` executable. No existing mappings were changed.
- Branch preview and exact-head CI state are available in the PR deployment
  checks; verify the latest SHA rather than treating this note as live status.
