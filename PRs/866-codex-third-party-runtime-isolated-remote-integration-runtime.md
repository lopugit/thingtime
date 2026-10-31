# PR 866 — Isolated remote integration runtime

The first infrastructure release for the third-party integration library.
Registries intentionally remain empty until the following catalogue release.

## Runtime and boundaries

- `IntegrationExample` renders a curated ID and editable JSON in native Things.
- The standalone runner uses opaque-origin frames and classic blob workers with
  dynamic imports. Module-worker bootstrap failed in Chrome's opaque frames;
  classic workers retain cancellability and successfully load the pinned ESM.
- Remote imports require an explicit Run. The app shell CSP is unchanged.
- Credentialed requests negotiate `api.library-request` 1.0.0 and require a full
  account, a fail-closed rate limit, fixed destinations, no redirects, bounds and
  deadlines. Credentials never enter the frame or the saved Thing payloads.
- Native preparation actions return an example ID and input JSON. The component
  performs the remote operation explicitly; preparation actions do not silently
  execute remote code on the server.

## Validation (2026-09-21)

8 runtime tests, 71 capability tests, 2 Vercel config tests, targeted ESLint and
a full production build passed. Built output checks assert isolated assets,
route-scoped CSP and opaque origins. Anonymous local API requests return 401.
The full project typecheck has baseline failures outside this surface.

Chrome acceptance used the subsequent catalogue as a fixture: 467/468 public
examples passed one complete sweep; the remaining Open Library request passed
after changing its obsolete redirecting ISBN endpoint to a direct edition ID.
The combined accepted set is 468 credential-free examples. Saved sample data,
preparation action and component are private; the saved component executed
correctly from the Things page. Mobile key show/hide/clear and Stripe live-key
rejection passed at 390px; desktop and mobile pages were scrolled to the footer.
No real provider credentials were used; provider-account acceptance is separate.

The isolated development checkout uses localhost:19450 (HMR 19451, Nitro 19452).
Tailscale Funnel could not be verified: the installed command points to a missing
Tailscale application executable. Vercel preview status is tracked on PR 866.
