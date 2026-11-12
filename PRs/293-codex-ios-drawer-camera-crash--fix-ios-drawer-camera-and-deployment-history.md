# PR #293 — iOS drawer, camera permissions, and deployment history

## Scope

- Reuse the shared mobile drawer trigger inside the native WebView so it moves
  with the open drawer instead of leaving a duplicate native-only control at
  the drawer edge.
- Declare the camera, microphone, and photo-library purpose strings required by
  iOS media capture.
- Add a second disclosure level to the native Web destination drawer. A branch
  expands into its recent immutable Vercel deployments, and the newest ready
  deployment is labelled `Last successful` when a newer build is still queued.
- Preserve the existing latest-per-branch Vercel API response while adding a
  bounded `deploymentGroups` history contract for newer clients.

## Deployment-history design

The Vercel endpoint scans the existing bounded deployment window, sorts it
newest first, deduplicates paginated results, and returns up to 20 deployments
per selected branch. The native client requests ten. Legacy clients continue
to use `deployments`, which remains one latest deployment per branch.

Preview-targeted native builds try their configured preview API first. They
fall back to production when the preview is unavailable, serves the legacy
contract, or is tokenless; among legacy fallbacks the client keeps the response
with the richest deployment list. Existing drawer data remains visible during
background refreshes.

## Validation

- XcodeGen regeneration and iOS Simulator build-for-testing, including all
  hosted unit-test targets.
- Seven focused Vercel status/history tests and targeted ESLint.
- Full client plus Nitro/Vercel production build and output verification.
- Local managed-stack Vercel API group: 3/3 passing.
- Local managed-stack API documentation group: 297/297 passing, including the
  generated GET and POST docs checks for the deployments endpoint.
- Live branch-preview API: 50 deployment groups, 46 with history, and the
  current branch returning one building deployment followed by six ready
  immutable deployments.
- Signed Release IPA: version 1.0, build 15, branch-preview URL, all privacy
  purpose strings, valid deep signature, and executable present.
- App Store Connect build 15: `VALID`, `IN_BETA_TESTING`, auto-notify enabled.
- Graphify structural and semantic refresh using the local Codex proxy.

## Manual follow-up

No iOS simulator was booted during the deployment-history pass, so disclosure,
scrolling, selection, and real camera capture still need a final tap-through on
a booted Simulator or physical device. The native app and its test bundle
compile successfully.
