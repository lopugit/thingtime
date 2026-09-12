# PR 774 — Widget endpoints and release/recovery integration

The native Mac companion saves named server endpoints and keeps credentials in
per-origin Keychain entries. Every Mac widget can select a saved endpoint; content,
Thing identifiers and click destinations are scoped to it. Missing endpoints never
fall back silently. Existing unconfigured widgets follow the active endpoint.

## Release and recovery

A dedicated `widgets-release.yml` job handles relevant main pushes or owner-only
main dispatches. It resolves exact trusted main source, checks out without retained
publication credentials, runs Widgets/Recovery tests, and only then imports the
existing Developer ID and notarization secrets. It publishes Widgets and matching
Recovery ZIPs plus checksums only after notarization, stapling and verification of
the extracted archives. It does not replace Electron's latest-release marker.

Recovery adds a Widgets product, recognizes the Widgets asset prefix, and isolates
its cache, installation target and handoff actions from all other products. Existing
bundle-ID, signing-team, production trust and rollback checks apply unchanged.

## Validation and acceptance

- Twelve native Widgets tests cover OAuth, saved endpoints, links and cache isolation.
- Twenty-four Recovery tests cover catalog/architecture selection, component-specific
  cache and installer validation, and existing signed/unsigned/rollback boundaries.
- Four release-contract checks cover trusted-main gating, version sourcing,
  production refusal of development signing and complete artifact publication.
- YAML and every embedded Bash step parse; production build/verification scripts
  pass Bash syntax checks. The required repository secret names already exist;
  their values were not read or copied.
- The first notarized GitHub release and real download/install from its asset remain
  pending: this work is on the feature PR, and no primary-branch promotion is implied.
- No iOS TestFlight release or new production Widgets signing identity is installed
  by this change. The iOS Simulator build passed for shared widget changes.
