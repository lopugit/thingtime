# PR #627: GitHub release catalogue and Recovery installer repair

Date: 2026-09-05

Product: [PR #627](https://github.com/lopugit/thingtime/pull/627),
`codex/recovery-release-sync` into `develop`.
Protected builder: [PR #628](https://github.com/lopugit/thingtime/pull/628),
merged into `github-actions` as `50e810da23952c17b93b89de4f63153892b1d515`.

## Findings

- GitHub initially contained exactly two published releases, builds 3 and 4.
  Recovery's two rows matched the server; recent workflow runs had not created
  additional downloadable releases.
- Main release run `33507740703` failed before publication. Its old builder used
  an unsigned distribution command with a version lacking `.unsigned` and omitted
  the companion Recovery build. The protected PR gate also tested the wrong
  event name for reusable workflow callers.
- The actual public build 4 ZIP contains no `_CodeSignature/CodeResources` seals.
  Extracting it and running `codesign --verify --deep --strict` reproduces the
  reported error. Client-side signature bypasses would hide a malformed release.
- Recovery selected archives alphabetically without checking Mac architecture,
  fetched each component independently, and ran blocking extraction on the UI
  thread. Waiting for subprocess exit before draining output could deadlock.
- A release containing both apps reused its GitHub ID for both SwiftUI list rows.
  The installed app visibly selected both rows and opened the desktop download
  when Recovery was clicked. Component-scoped row identities fix that collision.
- Existing cache hits escaped re-verification, rollback cleanup could delete the
  remaining backup, and a damaged installed bundle could prevent repair because
  it could not enter the verified cache.

## Resulting behavior

One complete paginated snapshot supplies desktop and Recovery rows, deduplicates
releases, selects the current architecture, and reports published versus compatible
counts. Failed later pages preserve the previous complete list. Downloads validate
archives and signatures in background work; malformed legacy ZIPs show an actionable
error. Cached bundles are reverified before reuse.

The installer validates the replacement before switching apps. A damaged previous
app is preserved separately rather than falsely marked verified. Failed rollback
retains its backup. Detached helper errors reopen Recovery with a durable notice.

Main and approved PR releases share the protected builder. Gates re-check owner,
source SHA, event, ref, and PR eligibility. Both desktop and Recovery archives are
built and verified from clean extraction. With all six signing/notarization secrets
absent, the existing policy produces explicitly labelled unsigned prereleases;
partial configuration fails. Signed/notarized production remains a separate lane.

## Validation

- 19 Swift tests cover pagination, duplicate pages, architecture selection,
  rate-limit preservation, malformed ZIP cleanup, cache re-verification, large
  subprocess output, damaged installation repair, invalid replacement protection,
  installer notices, and trust boundaries.
- 79 Electron tests pass. The outdated renderer contract now checks the canonical
  shell mount before compatibility fallbacks.
- Unsigned Recovery packaging succeeds from an absent cache root, including its
  extracted archive verification.
- The local app was built and installed in `~/Applications/Thingtime Recovery.app`
  with the same Apple Development designated requirement as the existing app.
  Staged and installed signatures verify. The installed UI reports GitHub counts
  and rejects the actual malformed build 4 ZIP without changing installed apps.
- The protected builder's gate tests, existing workflow contracts, actionlint,
  required CI, and CodeQL pass.
- [Cloud run 33948509016](https://github.com/lopugit/thingtime/actions/runs/33948509016)
  successfully published both Electron and Recovery unsigned archives from product
  commit `650e27fa5d1384008ed0889addd9e1c8138ce2fa`. That run precedes the final
  damaged-installation tests and persistent helper notices in this PR.

## Delivery boundaries

The owner subsequently authorized merging the changes into `main`. During that
promotion, a new screenshot showed the damaged build 4 still looking installable.
Both legacy builds 3 and 4 were inspected and have zero signature resource seals.
Release notes now support a component-scoped withdrawal marker; Recovery retains
the history with an UNAVAILABLE label and blocks the download before transfer.
Regression coverage checks component isolation and the store's download guard.

The protected builder repair is deployed and PR #627 is merged into develop. Its
scoped main promotion also includes the unavailable-release follow-up. The six cloud signing
secrets are absent, so the verified cloud build is explicitly unsigned rather than
a Developer ID/notarized release. Legacy malformed public assets remain blocked.

No web UI changed. Vercel preview authorization is skipped for this native-only
delivery; the PR checks contain the current deployment status. Graphify portable
outputs are refreshed; a large semantic chunk exceeded the local proxy request
limit during the initial refresh, while structural indexing completed.
