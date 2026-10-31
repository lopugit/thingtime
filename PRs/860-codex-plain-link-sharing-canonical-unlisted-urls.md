# PR #860: canonical unlisted URLs

A video copied from a nested comment gallery opened for an allowed signed-in
viewer but returned “Thing not found” anonymously. The user requested canonical
base URLs as the unlisted access mechanism, without secret query parameters.

## Behavior and boundaries

- Exact-id reads grant the `tt:hidden` audience, including mixed audiences and
  inherited comments/media. Listings never receive that request-local grant.
- Gallery, context menu, Share and builder links omit legacy `key`. Non-secret
  shared composition context remains available for contained private dependencies.
- Every request rechecks the current root ACL and intermediate moderation.
  Private/group-only audiences, token scopes and foreign composition boundaries
  retain their restrictions. Legacy keyed URLs remain readable.
- Removing “Anyone with the link” revokes anonymous access. Rotating the old
  key does not revoke a known canonical URL.
- Successful visits remember discovery for the account or saved anonymous
  browser identity. IP metadata alone never grants profile collection access.
- API contracts, feature versions, client negotiation and regression coverage
  were updated together.

## Validation (2026-09-19)

- Production build and 3,276 unit checks pass. Changed-file ESLint passes with
  one existing literal-template test warning.
- TypeScript retains 116 pre-existing errors, none in changed files. The
  non-blocking ratchet reports the existing drift from its stored 108 baseline.
- Real local HTTP: bare root/comment reads and children succeed anonymously;
  changing the root to private denies both. Exact disposable fixtures removed.
- Real shared-composition integration passes: canonical roots, private foreign
  boundaries, fork behavior and revoked roots/groups.
- Chrome desktop and 390×844: gallery Copy link, photo/video navigation,
  standalone media menu, full-page scroll and long audience labels checked.
  The UI fixture uses synthetic media transport; attachment authorization is
  additionally covered by service-level and real HTTP checks.
- Live local capability manifest reports the new feature versions.
- The reported video id returns anonymous 404 on production before rollout.
  Final delivery verifies the exact production deployment and anonymous media.

Local fixture: http://localhost:18420/scripts/inherited-audience-preview.html
(Vite 18420, HMR 18421, Nitro 18422). Tailscale/Funnel unavailable because the
installed launcher targets missing `/Applications/Tailscale.app`; no mapping changed.

PR: https://github.com/lopugit/thingtime/pull/860
