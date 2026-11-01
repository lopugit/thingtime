# PR #641: Passkey reliability across login, account switching, settings and iOS

## Problem and behavior

A delayed autofill request could supersede an explicit click, components shared the browser library's abort singleton, and a password manager could ignore cancellation indefinitely. Chrome with the user's enabled 1Password extension reproduced the indefinite pending request. Ceremonies now own cancellation from options through verification, explicit clicks win over autofill, unmount/dismissal cancels only the owning request, and an independent cancellation promise plus a two-minute foreground deadline restores the UI even when the provider never settles.

Signed challenge cookies are scoped per ceremony and bound to the issuing origin. Up to three pending challenges of each kind coexist so another tab cannot replace the expected challenge. An atomic, expiring spent marker in the existing authOtps collection rejects replay even with copied cookies and zero-counter credentials. Registration and authentication advertise version 1.1.0 in both capability manifests, and the client checks the selected origin's contract before beginning.

Security settings now scope cached passkeys to the active account, discard late account-list responses, and display a retry when fetching fails. Error messages distinguish unsupported origins, duplicate registration and unavailable credentials. A shared relying-party ID does not replicate credentials between production and development databases; the UI no longer claims otherwise.

The iOS target gains its missing webcredentials entitlement. A public Apple association handler, canonical API registration, local proxy and Vercel routing serve the matching association as JSON instead of the SPA shell. Fork-safe setup is in README.md.

## Validation

- Real local API with a software P-256 authenticator: 54 checks passed, including registration, login, mutation authorization, revoke/delete, parallel challenges, saved-cookie replay, wrong origin, missing user verification and mismatched user handle.
- Ceremony, codec, challenge-cookie, Apple association and client-negotiation tests: 13 passed.
- Both capability manifest suites: 10 passed.
- Vite/Nitro production build and Vercel output verification passed. Built server fetch smoke confirms the Apple JSON association and origin-scoped passkey 1.1.0 manifest.
- Chrome with 1Password enabled: reproduced ignored cancellation, verified Cancel restores the button, and checked login and test-account settings at desktop 1440x1000 and mobile 390x844, including the expanded registration form and footer. Closing registration cancels the request and clears its password field.
- XcodeGen plus generic iOS Simulator Debug build passed with the associated-domain entitlement. A signed Release archive and IPA also built with Xcode 26.6 and an existing matching App Store distribution profile. The exported IPA passes strict signature verification and contains the correct application identifier and webcredentials entitlement.
- TypeScript ratchet reports 109 errors against a 108-error nonblocking baseline; no errors point to the passkey changes. This is not a clean full-project typecheck.

## Rollout and remaining acceptance

The existing installed profiles already permit Associated Domains. THINGTIME_APPLE_APP_IDS is now configured and read-back verified in the Thingtime Vercel project for production, preview and custom develop; its public identifier was checked against the signed IPA. Existing deployments do not acquire changed environment values, so a fresh deployment is required. The final pre-configuration preview at 39fbbe82d and its origin-scoped manifest/docs routes were verified, and Web CI passed.

Remaining: merge and deploy the web change to production, then distribute/install the signed iOS build. Production still returns HTML at the Apple association URL until the code is released. Apple Developer permissions were not changed. Verify Face ID/Touch ID, iCloud Passwords, and 1Password sign-in/registration on real devices after rollout; software cryptographic coverage and an unsigned simulator build do not establish that acceptance.

Local web: http://localhost:19040 (Nitro 19042, HMR 19041). Tailscale/Funnel could not be verified: the local launcher points to a missing /Applications/Tailscale.app executable.

Graphify retains earlier successful semantic chunks. The latest semantic refresh had two image/document requests rejected by the proxy body limit (413), and a remaining slow request was stopped after five minutes. Structural refresh and portable report/HTML generation completed instead; the latest rollout notes are not fully semantically indexed.

## Native TestFlight follow-up (2026-09-05)

The web repair is merged into develop (#641) and production main (#651). The
native follow-up starts from the current Watch build 24 source and backports
the same passkey repair to its preview, preserving the Watch companion and
notification support. Build 25 retains `https://pr-596.previews.dev.thingtime.com`
and adds `webcredentials:thingtime.com` to the phone entitlement.

Validation: 13 passkey, 8 API registry, 3 runtime capability, 57 device and
8 notification tests pass. The Vite/Nitro build and Vercel output verification
pass. Both signed build-25 bundles retain production APNs entitlements and
matching versions/origins; the phone association matches Apple's live CDN.
Simulator tests, TestFlight processing and real-device acceptance are separate
checks; a signed archive alone does not establish credential-provider success.
The structural Graphify refresh completed; the local semantic proxy was
unavailable, so new documentation was not semantically indexed.
