# Thingtime widgets

The same SwiftUI widget suite ships in the iOS app and the native **Thingtime
Widgets** Mac companion (macOS 14+). iOS 18+ also offers four Control Centre
buttons: Transcribe with Lopu, Talk to Lopu, New Thing, and Search Things.
Controls support the compact 1×1 presentation and the expanded sizes offered by
iOS; the system owns resizing. Home Screen widgets use Apple's small, medium,
large, and extra-large families (extra-large on iPad and Mac), with circular,
rectangular, and inline Lock Screen accessories on iPhone.

## Available widgets

- **Quick Action:** choose transcription, voice, new Thing, search, My Things,
  Lopu chat, new folder, or feed; optional custom title.
- **Thingtime Dashboard:** four actions at medium size, eight at large and
  extra-large sizes, or your selected action at small size.
- **Render a Thing:** choose a synced Thing, custom title, and card, note, or
  value layout. It renders a bounded native display projection of `name/title`,
  `text/description`, kind, and scalar `value`; arbitrary web/HTML/component
  execution is not supported inside WidgetKit.
- **Recent Things:** a size-appropriate list of up to seven recent Things.
- Existing Lopu Live Activities remain available on iPhone.

New Thing opens the existing schema chooser; New Folder opens the name dialog.
Voice launches foreground Thingtime, selects the requested transcription/voice
mode, and starts after sign-in and the existing access gate. If sign-in redirects you away, tap the widget again once signed in. Microphone and
Speech Recognition permissions remain owned by the iOS app; Mac quick actions open
Thingtime in the default browser, which owns its microphone permission. Tapping again cannot
create parallel sessions. Stop from the normal Lopu microphone control.

## Content and privacy

On Mac, the companion is a native SwiftUI window with Overview, Things,
Widget Gallery, and Connection pages. **Connection → Sign in with Thingtime**
opens the system browser and returns through a one-time PKCE callback. Choose
specific Things, all Things, individual read/write permissions, running actions,
or Lopu permissions in the consent screen. You can revise them by signing in
again. An older grant does not gain new permissions automatically.

On iOS, open **Widget settings** in the native drawer. Content sync remains off
by default on both platforms. Enable it, then right-click/long-press the actual
widget → **Edit Widget** to choose a Thing and its display options. The host
refreshes at most 50 Things once per minute while its window is open. Content
expires after 30 minutes without a successful refresh; toggling the setting
cannot extend old content's lifetime. Disconnecting or switching accounts clears
the shared cache. WidgetKit owns the final redraw timing.

Only the bounded display projection is stored in the App Group; no cookies,
tokens, hidden-link keys, attachment URLs, or complete Thing documents cross the
widget boundary. Views are marked privacy-sensitive, but content on the desktop
or Lock Screen can still be visible according to the device's privacy settings.
Do not enable it for information you do not want visible there. There are no
widget-side network requests. The iOS host uses `api.things` >=1.7.0. The Mac host negotiates the origin-scoped
OAuth registration, token, consent, and data features before connecting. Its
credential stays in the app-only Keychain, never the App Group. Disconnect
revokes only this Mac's token; if offline, the app removes it locally and reports
that account-side revocation could not be confirmed.

## Build and signing

Use `iOS/project.yml` and `macos/ThingtimeWidgets/project.yml` as the sources of
truth. Generated Xcode projects stay ignored. For a fork, replace bundle IDs,
choose your team, register an App Group, and enable that same group for the iOS
app and widget extension. Set `THINGTIME_WIDGET_GROUP` in the build environment
or xcconfig and regenerate development/distribution profiles for both targets.
The existing Watch target does not need this entitlement. App Groups require
provisioning for distribution; an unsigned simulator build is not release proof.

```
xcodegen generate --spec iOS/project.yml --project iOS
xcodegen generate --spec macos/ThingtimeWidgets/project.yml --project macos/ThingtimeWidgets
```

Mac quick actions open the selected Thingtime site in the system browser;
Lopu's widget URL selects and starts voice/transcription after the browser's
microphone permission and sign-in gates. The companion embeds no browser page.
For local installation use `macos/ThingtimeWidgets/build-local.sh`. It requires an
explicit stable Apple Development identity and team, signs nested code before
the host, verifies the result, installs to `~/Applications/Thingtime Widgets.app`,
and verifies the installed copy. This is a development install, not a notarized
public release. Set `THINGTIME_WEB_URL` to a branch preview to test matching web
changes before deployment. Do not upload a beta-SDK build to TestFlight.

## Acceptance

Use the **Preview widget layouts** screen for actual SwiftUI layouts with sample
content. Also add widgets from the real system gallery: test small/medium/large,
Lock Screen accessories, and Control Centre compact/expanded controls. Test
cold launch, warm launch, sign-in, permission denial, active-session duplicate
taps, account switching, disabled content, deleted Things, offline expiry, and
long titles. See the Apple widget checklist in `TESTING.md`. Device microphone,
widget daemon refresh, and Control Centre taps require real-device acceptance.

## OAuth setup for forks and local servers

No OAuth secret or manual client registration is needed. The API's canonical
app registry provisions the protected `ttapp_thingtime_widgets` app on lookup,
with exactly `com.thingtime.widgets://oauth/callback`; the native app registers
that scheme. Forks changing the bundle identity should update both these
constants and the XcodeGen URL registration together. HTTPS server origins and
HTTP loopback origins are supported; credentials, paths, queries, and fragments
are refused in server addresses. There is no embedded login or cookie copying.

`account.things` (and its read/create/update/delete/comment/reaction/save/vote/
share children) controls account-wide Things access independently of the legacy
`things` picker and `app-data` namespace. `actions.run`, `lopu.chat`, `lopu.voice`,
and `lopu.recordings` each enable their named API family. The ordinary account
resolver continues rejecting app tokens: these grants cannot change account
security or mint other credentials. Sandbox tokens cannot access real accounts.

## Saved Mac endpoints

Open `~/Applications/Thingtime Widgets.app` and choose **Connection**, or use
**Thingtime Widgets → Settings…** (Command-comma). The dedicated SwiftUI window
contains the saved endpoint list; it does not embed the website.

- **Add endpoint** saves a name and server root address. Bare domains use HTTPS;
  custom HTTPS hosts and ports are supported. HTTP is limited to loopback local
  development. Paths such as `/api/v1`, credentials, queries and fragments are
  rejected: enter the origin that serves Thingtime's capability manifest.
- **Use endpoint** verifies that server's capabilities before changing the active
  origin. All Mac widget clicks and data reads then use that origin. If needed,
  choose **Sign in with Thingtime** to approve that server in the browser.
- Each origin retains its own Keychain sign-in, so switching back restores it.
  Display content clears when switching, before the new server is refreshed.
  A failed compatibility check leaves the active connection unchanged.
- **Edit** renames a bookmark or changes an inactive bookmark's address. Switch
  away before changing an active address. **Remove** deletes an inactive bookmark
  and its local credential and attempts server-side revocation. **Disconnect**
  revokes the active sign-in but keeps its bookmark.
- The first launch migrates the existing connection and adds `thingtime.com`.
  An existing local connection is preserved rather than silently replaced.

The public production server must ship the OAuth/capability changes from PR #727
before it can accept the native connection. Adding it to the list does not bypass
that requirement or transfer a local server's credential to production. Saved
bookmarks live locally; this Mac endpoint manager does not change iOS settings.
