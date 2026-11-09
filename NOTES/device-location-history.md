# Device location history and find-device evidence

Date: 2026-11-06. Starting main: `312fbbe2aed34737f22b29adcce77f1f351edfe2`. Task branch: `codex/device-location-history`.

The requested experience includes private location history for paired Device Things, retention defaulting to Never with a configurable delete-after policy, device-targeted tones/messages, and editable Mapbox current/history views with time filters and age colours.

## Verified starting implementation

- Device state normalisation omits location; the snapshot is replaced on each revision. Existing control events do not retain location samples.
- Typed device commands already provide authorization, leases and results. They do not yet provide scoped user messages or uploaded-audio playback.
- APNs registrations identify sessions, while normal notification delivery fans out by user. A selected-device alert needs a verified Device Thing binding.
- iOS device pairing keeps device credentials in the existing protected Keychain. Location permission/collection is not implemented. Generic UIDevice.model does not identify a precise product model.
- Existing ComponentMapbox supports data-driven colours, grouping and separately editable marker child Components. A new opaque map renderer is unnecessary.

## Platform evidence and limits

[Apple background location](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background) requires appropriate authorization and lifecycle handling. It is separate from discretionary Background App Refresh. [Notification sounds](https://developer.apple.com/documentation/usernotifications/unnotificationsound) have platform-specific formats/duration constraints. Retain original uploaded audio; a platform-compatible derivative is a separate artifact.

A device without an authorized location provider reports unavailable; never substitute another device's position. Apple's Find My accessory network is not an available general personal-device location source. Device stock images can match public model identifiers; serial numbers need not leave Thingtime.

## Integration checkpoint

Integrated fresh `origin/main` `65d3b7e8e` on 2026-11-06, preserving the
already merged background-presence/quiet-status changes and unrelated backup
and sync improvements. Native source fingerprints match the 29-test passing
iOS revision after conflict resolution. Post-integration device tests, 152
capability tests and raw TypeScript checks pass. Independent review corrections
cover expired latest-pointer cleanup, APNs approval dispatch and terminal
retention, and media reauthorization immediately before Mac effects.
Physical device collection, display and audible playback are distinct pending
acceptance layers. Saved layouts are private authored Things; their IDs and
vault bindings are intentionally absent from repository documentation.

## Generated marker asset

`remix/public/assets/devices/location-marker-frame.png` is a generic transparent marker frame generated with ChatGPT imagegen on 2026-11-06. The prompt requested one front-on white porcelain/frosted-glass round pin, subtle iridescent rim, short downward pointer, transparent centre for a dynamically inserted device product image, transparent outside, no device/text/logo/map. The asset contains no user data; the user's map composition remains private saved Things.
