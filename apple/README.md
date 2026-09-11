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
Speech Recognition permissions remain owned by the app. Tapping again cannot
create parallel sessions. Stop from the normal Lopu microphone control.

## Content and privacy

Open **Widget settings** in the iOS native drawer (swipe in from the left edge) or Mac toolbar. Content sync
is off by default. Enable it, sign in, and keep the app open to refresh up to 50
recent Things. Then **Edit Widget**, choose a Thing, and enable **Show content**
for that widget. Sync checks once per minute while the app is running. A widget
shows its last snapshot offline and expires it after 30 minutes; reopen the app
to refresh. Logout/account changes and disabling sharing clear the shared cache.
WidgetKit owns refresh timing, so removal may wait for a system redraw.

Only the bounded display projection is stored in the App Group; no cookies,
tokens, hidden-link keys, attachment URLs, or complete Thing documents cross the
widget boundary. Views are marked privacy-sensitive, but content on the desktop
or Lock Screen can still be visible according to the device's privacy settings.
Do not enable it for information you do not want visible there. There are no
widget-side network requests. The signed-in host uses `api.things` >=1.7.0 with
matching major and origin negotiation. Account state comes from the existing
root loader. A Mac companion has its own sign-in, independent of Electron.

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

The Mac companion includes the existing Lopu voice controller and upload outbox,
with iOS-only background tasks and Live Activities conditionally compiled. For
local installation use `macos/ThingtimeWidgets/build-local.sh`. It requires an
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
