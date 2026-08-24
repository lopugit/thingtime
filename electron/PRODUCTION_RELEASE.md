# Electron production release control plane

Executable release behavior belongs on the protected `github-actions` branch.
Product branches contain only GitHub-required listeners, so a review PR never
supplies its own signing, notarization, or publishing steps.

Two centrally maintained workflows serve different release lanes:

- `electron-release.yml` builds the ordinary stable Electron release after a
  `main` change.
- `electron-pr-release.yml` builds a reviewable signed prerelease for an
  explicitly approved PR and also attaches the independent Thingtime Recovery
  application.

## Approved PR prereleases

The `develop` listener uses `pull_request_target` for `labeled`, `reopened`,
and `synchronize` events, then calls the reusable worker at
`lopugit/thingtime/.github/workflows/electron-pr-release.yml@github-actions`.
That worker independently re-reads the live PR record before it does any
checkout. Automatic publication requires all of the following:

1. The PR head repository is exactly `lopugit/thingtime`.
2. The PR author association is `OWNER`.
3. The PR currently has the `desktop-release` label.

The repository owner can instead manually dispatch the thin listener with a
numeric PR number. The worker revalidates that caller identity and the PR's
same-repository head in either mode. Forks and ordinary contributors never
reach a macOS runner with signing credentials.

The worker resolves the PR's current head SHA through GitHub's API, checks out
only that immutable SHA with `fetch-depth: 1` and `persist-credentials: false`,
and completes the unsigned MCP, native, Recovery, and Electron checks before it
imports any certificate or notarization material. Its GitHub write token is
scoped to API and final release-publication steps; the checked-out source build
does not retain one.

## Secret mapping

Configure these repository or protected-environment GitHub Actions secrets
using your own values. Do not put a certificate, key, password, or account id
in this repository, logs, or a PR description.

```text
MAC_CSC_LINK=<base64-developer-id-application-p12>
MAC_CSC_KEY_PASSWORD=<p12-password>
APPLE_API_KEY_BASE64=<base64-app-store-connect-p8>
APPLE_API_KEY_ID=<app-store-connect-key-id>
APPLE_API_ISSUER=<app-store-connect-issuer-id>
APPLE_TEAM_ID=<apple-developer-team-id>
```

`MAC_CSC_LINK` must contain a **Developer ID Application** certificate. Apple
Development is suitable for a stable local TCC identity and Apple Distribution
is for App Store distribution; neither satisfies direct Gatekeeper distribution.

The worker imports the `.p12` and decoded App Store Connect key into a fresh
temporary keychain under `RUNNER_TEMP`, confirms the identity begins with
`Developer ID Application:`, gives only `codesign`/`security` the required key
access, and deletes the keychain and temporary files in an `if: always()`
cleanup step.

## Desktop and Recovery artifacts

After unsigned validation, the worker runs `corepack pnpm --dir electron run
dist` with the imported identity and notarization API-key environment. It then
runs `macos/ThingtimeRecovery/script/build-production-release.sh` with the same
Developer ID identity. The Recovery script signs its nested helper before the
outer application, notarizes and staples the ZIP, and runs strict `codesign`,
Gatekeeper, and stapler checks.

Publication requires both the Electron updater-compatible ZIP and exactly one
separately signed Recovery ZIP. The prerelease SemVer form includes its source
provenance, for example:

```text
0.1.0-pr.68.codex-thingtime-mcp-desktop-connectors.gabcdef123456
```

The release notes retain the full PR number, normalized branch, and commit.
The updater and Recovery launcher independently verify cache and installed
bundles before offering launch or atomic installation; no unsigned fallback is
permitted.

## Local versus production proof

At the PR #68 checkpoint, local builds used a stable Apple Development identity
and proved strict deep-signature verification, installed-bundle verification,
the standalone Recovery UI, and a genuine Recovery self-replacement/relaunch.
Those local artifacts are intentionally not direct-distribution releases.

Production publication remains fail-closed until the six secrets above are
configured and the dedicated `github-actions` builder/releaser plus the thin
`develop` listener have been merged. A credential failure is safer than
publishing a TCC-unstable, unsigned, or unnotarized artifact.
