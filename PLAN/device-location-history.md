# Device location history and find-device implementation

Evidence: [device location note](../NOTES/device-location-history.md).

## Outcomes

1. Register reusable device observations, with location as the first typed channel. Store atomic private history children, observed and received times, accuracy and exact device/owner binding; handle retries, late arrivals and pagination without an arbitrary history cap.
2. Retain history by default forever (Never). Make collection explicit and revocable, and implement optional delete-after through bounded, resumable accounted deletion. History remains private when collection stops.
3. Add supported native collection and device-targeted alert/media actions, negotiating real capabilities and preserving local permission controls. Separate accepted, delivered, displayed and played results.
4. Compose the map, timeline/range filters, device filters, age legend, markers and controls from editable saved Things. Expose only missing reusable framework bindings in source.
5. Use generated marker artwork plus licensed public model images or an editable upload/generic fallback; never transmit serial numbers to stock-image providers.

## Acceptance and release gates

- Real disposable API tests: owner/non-owner/revoked refusal, duplicate/out-of-order samples, storage failure, scoped retention changes and deletion, capability missing/breaking refusal, and targeted delivery isolation.
- Native tests and final signed builds: permission denial/revocation, background/foreground and relaunch, offline recovery, no cross-account/origin upload, actual sensors/audio/notifications on each claimed platform. Required human OS consent remains a dependency.
- Browser: real saved Things and API data at phone/desktop widths, editable nested marker fields, all filters, historical/current distinction, accurate colours/timestamps, full scroll/dynamic states, reload and privacy checks.
- Publish source via protected main PRs; follow automatic iOS TestFlight release and verified local native installation for affected host apps. Report each delivery layer separately.

## Scope boundaries and stop conditions

No access to Apple's private Find My network, no guessed locations, hidden tracking, arbitrary URL playback, always-awake claim, or serial-number disclosure. Preserve unsupported states and active user data. Pause only a dependent action when a permission, physical device, authentication or capability is genuinely unavailable, and retain remaining acceptance work.

Status: active implementation. Source, saved-map authoring, platform delivery and physical acceptance remain distinct open gates.
