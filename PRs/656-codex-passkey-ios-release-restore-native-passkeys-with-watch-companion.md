# PR #656 — Native passkey release with Watch support

Build 25 adds the associated-domain entitlement missing from TestFlight build
24. The current Watch companion, production APNs entitlements and PR #596
preview origin are preserved. The production passkey web repair (#641 / #651)
is backported into the Watch feature branch so its preview supports the same
cancellation, replay protection and capability negotiation. This PR targets
`codex/watch-app`, not a production branch.

Validation: 13 passkey, 8 API registry, 3 runtime capability, 57 device and
8 notification tests passed, as did the web build and Vercel output checks.
Both signed build-25 bundles passed strict codesign verification and retained
their build number, preview origin and production push entitlements. The phone's
`webcredentials:thingtime.com` association matches Apple's live CDN.

Local simulator validation was interrupted after beta and release Xcode runs
stalled under extreme host load. No Swift implementation changed from build
24. Simulator and real-device acceptance are not established by the signed
archive check. TestFlight processing and preview deployment status are recorded
in the PR's live delivery notes.

The structural graph was refreshed. The local semantic proxy was unavailable,
so new documentation was not semantically indexed.
