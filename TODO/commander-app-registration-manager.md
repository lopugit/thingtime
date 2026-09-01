# App-manager GUI: register an OAuth app

## Why

`/apps/manage` currently lists and manages apps that already exist, but its
**Register an app** control sends owners to documentation. Registering a
desktop or web client therefore requires a manual authenticated API request.
Commander needed that escape hatch while its production OAuth client was being
registered.

## Outcome

Make app registration a first-class, owner-facing flow in `/apps/manage`.

- Replace the documentation-only **Register an app** action with a dialog or
  dedicated route that creates an app through `POST /api/v1/apps`.
- Collect a required display name and one or more origins. Explain that origins
  are bare scheme/host/port values; callback paths are bound during OAuth and
  must not be entered here.
- Validate and normalize origins through the existing server-side app-origin
  rules. Keep non-loopback origins HTTPS-only and make local HTTP restrictions
  clear in the form.
- Surface validation, duplicate, permission, and rate-limit failures through
  the Lopu toast; never expose internal errors or tokens.
- Insert the new app optimistically into the owner list, select it, and provide
  its public client ID with a copy affordance. Do not show or mint a client
  secret: Thingtime OAuth clients are public PKCE clients.
- Cover desktop and narrow layouts, keyboard focus/escape behavior, and an
  authenticated API-backed browser test using the real registration route.

## Acceptance check

An owner can create a local desktop app with
`http://127.0.0.1:47820`, see it immediately in the manager, copy the new
`ttapp_…` client ID, and use that ID with `/authorize` without leaving the
Thingtime app manager.
