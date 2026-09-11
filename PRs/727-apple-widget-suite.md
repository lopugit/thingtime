# PR #727 — Apple widget suite

Branch: `codex/apple-widget-suite`
PR: https://github.com/lopugit/thingtime/pull/727

Adds shared WidgetKit Quick Action, Dashboard, Render a Thing, and Recent Things widgets to iOS and a native Mac companion. Includes iPhone accessory families, iPad/Mac extra-large widgets, and four iOS 18 Control Centre actions. New Thing opens the existing schema chooser; transcription and voice launch foreground Lopu in their distinct modes. The native gallery previews the actual widget views.

Content sharing is off by default, requires per-widget opt-in, and uses an expiring bounded display projection in an App Group. The host negotiates api.things 1.7 compatibility before syncing; credentials and full Thing records are never shared with the extension. Mac voice reuses the existing recorder/outbox with platform-specific permission and lifecycle handling.

## Validation — 2026-09-10

- iOS simulator build and all 15 selected widget route, voice recovery, and recording upload tests passed after the final drawer change.
- macOS build passed; staged and installed Apple Development signatures passed deep/strict verification with a stable designated requirement. Widget extension registered successfully.
- Live Mac gallery: small, medium, large, recent Things, long titles; Search opens the correct main window and New Thing reopens a closed main window. Live iPhone simulator gallery inspected at phone width. Native settings default to sharing disabled.
- Browser checks at desktop and mobile sizes confirmed the signed-out gate. No test account credentials were entered. Local storage reports a migration requirement; no shared database migration was performed.
- Exact source commit `a777c964` passed GitHub Web CI build/typecheck ratchet/unit tests, API suite, and CodeQL. Its [Vercel preview](https://pr-727.previews.dev.thingtime.com) rendered with the exact SHA and returned HTTP 200 from the Nitro health endpoint.
- Focused web lint passed with existing ThingsPage warnings. Full TypeScript checking was stopped after more than 11 minutes without a result under machine contention; it is not claimed green.
- Local preview: http://localhost:11240 (API 11242, HMR 11241). Tailscale launcher points to a missing application binary; Funnel unavailable. Shared PM2 inspection hung, so the repository-approved foreground validation stack was used without modifying shared PM2 state.
- Microphone/Speech permission grants, authenticated auto-recording, private content synchronization/account switching, system widget/control placement and resizing, and device cold-launch behavior remain device acceptance work. No TestFlight upload or production deployment was performed. App Group provisioning must be enabled for signed iOS distribution.

The installed Mac review build targets the Vercel PR preview so it does not depend on the local server.

See [setup and feature behavior](../apple/README.md) and the Apple widget checklist in [TESTING.md](../TESTING.md).

## Develop integration

Preserved the newly merged recording-import and native-push recovery behavior when moving bridge script generation into the shared Apple module. Voice advertises contract 1.2; notification settings advertise support only on iOS. Mac recording synchronization now forwards the import preference. Combined native builds/tests are rechecked after this integration; physical device acceptance remains separate.


## 2026-09-11: native connection and expanded OAuth consent

The Mac companion now uses native Overview, Things, Widget Gallery, and Connection
pages. Sign-in opens the system browser with a one-time S256 PKCE transaction; the
app checks the exact callback, state, expiry, and replay status. Credentials stay
in the app-only Keychain. Disconnect revokes that credential and clears widget
content; cancelled replacement grants are discarded. Quick actions open the
selected Thingtime origin in the default browser.

Consent supports account-wide Things access, individual Things read/write/social
permissions, Run actions, Lopu chat, voice/transcription, and recording processing.
The existing selected-Things grant remains read-only and never implies account
access. Account grants reuse per-operation Things authorization and existing ACLs;
actions and Lopu routes explicitly opt in to their own scopes. Account-security
APIs continue to reject app tokens. Origin capability and contract versions track
the expanded routes.

Validation includes native PKCE/callback tests, consent parsing and permission
boundary tests, actor routing and scoped-user tests, capability coverage, focused
lint, and desktop/phone consent inspection. Native sign-in callback and actual
widget content acceptance are separate checks before merge.
