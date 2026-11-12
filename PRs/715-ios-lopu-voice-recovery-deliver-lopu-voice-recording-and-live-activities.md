# PR #715 — iOS Lopu voice recording and Live Activities

## Failure and repair

The source commit that introduced build 25 (`9a6f04d4e`) has the general
Thingtime native bridge but no `LopuVoiceSessionController.swift`, speech usage
description or widget target. App Store Connect confirmed build 25 was the
current internal TestFlight build. The web voice hook mistook that general
bridge for a working voice implementation and could show a false listening
state without a recorder.

Build 27 includes the native controller and Live Activity widget. Its bridge
advertises the separately versioned `lopuVoiceVersion`; older apps get an
update instruction. Standard voice sends turns through the existing persisted
chat endpoint with the selected chat/model/provider settings, while transcribe
mode retains private transcript pages. Each HTTP operation first checks its
semantic capability against the selected origin using the canonical well-known
manifest, not the legacy flat `/api/v1/capabilities` response.

The controller also retains partial utterances on Stop, uses a bounded silence
window to submit without waiting indefinitely for Speech's final flag, fences
permission/recognition callbacks across stop/start, and exposes separate
microphone, speech and Live Activity recovery instructions. Recognition retries
are bounded. Audio segments and recognized text survive locally when a network
request fails. Ordinary native turns reconcile from saved chat messages.

The release workflow now signs and exports a dedicated widget profile alongside
the iOS app and Watch app. The widget's bundle identifier was registered for this
release; forks must register their corresponding identifiers and use their own
signing credentials.

## Evidence

- 36 iOS tests passed on iPhone 17 Pro / iOS 26.5 with release Xcode 26.6;
  the four lifecycle/file recovery tests also passed in isolation before the
  final manifest-path regression brought the full suite to 36 tests.
- 39 focused web tests passed, including rejecting build 25's non-voice bridge;
  targeted ESLint and Ruby syntax checks passed.
- The signed Release archive and IPA export succeeded. Deep/strict signature
  verification passed. The IPA contains the app, Watch companion and Lopu widget
  at build 27, and the app's web destination is `https://thingtime.com`.
- App Store Connect upload succeeded on 2026-09-09. Build 26 reached internal testing, but the live release smoke caught a
  manifest path mismatch. Build 27 uses the canonical origin-scoped
  `/.well-known/thingtime-capabilities.json`; its processing status is checked
  separately before delivery.
- Actual recording/error/transcript components rendered at 390px and 1280px with
  synthetic rows, including long filenames and page links. Content was visible
  through the end of the fixture. The authenticated local page required sign-in,
  so this was component visual validation, not a microphone/provider round trip.
- Local PM2 dev stack: `http://localhost:12450`, HMR 12451, Nitro 12452; one entry,
  autorestart disabled. Funnel is unavailable: the installed CLI shim points to
  a missing Tailscale application. No other project's mapping was changed.
- Graphify was refreshed through the content-addressed wrapper with local-proxy
  semantic extraction. Shared Swift import IDs collided during extraction; the
  graph remains usable but those import relationships are incompletely indexed.

## Acceptance still requiring an iPhone

Install build 27 after the paired web release. In an existing Lopu chat, grant
Microphone and Speech Recognition, start voice, speak and pause, then stop
mid-utterance. Reopen the chat and verify persisted text. Open Files → On My
iPhone → Thingtime → Lopu Recordings and play the CAF segment/read its TXT file.
Start another session in the foreground, lock the device, and verify the Live
Activity and recording. Disable Live Activities and confirm the explanatory
notice while voice continues. Stop during a permission sheet and verify the
microphone cannot start later.

These checks are not established by simulator/unit tests. Local audio is a
recovery file, not an uploaded chat attachment. Direct-provider voice retains its
existing session-only transcript behavior. Live Activity text can be visible on
the lock screen when the user enables that iOS feature.
