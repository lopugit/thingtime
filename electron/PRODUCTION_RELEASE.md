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

## Secret mapping and distribution selection

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

When all six values are absent, the same owner-approved PR worker instead
builds the temporary **UNSIGNED** lane. If any, but not all, values are present,
the worker stops: a partially configured release must never be mislabelled as
either trusted or unsigned. UNSIGNED means no Developer ID certificate and no
notarization; the bundles use only ad-hoc signatures so their nested macOS code
can execute after the user has explicitly approved macOS's warning.

## Desktop and Recovery artifacts

After source validation, a fully configured worker runs `corepack pnpm --dir
electron run dist` with the imported identity and notarization API-key
environment, then runs
`macos/ThingtimeRecovery/script/build-production-release.sh`. The Recovery
script signs its nested helper before the outer application, notarizes and
staples the ZIP, and runs strict `codesign`, Gatekeeper, and stapler checks.

When credentials are entirely absent, the worker instead runs `corepack pnpm
--dir electron run dist:unsigned` and
`macos/ThingtimeRecovery/script/build-unsigned-release.sh`. Those artifacts are
given unmistakable `UNSIGNED` asset names and a SemVer suffix of `.unsigned`.
They are not a substitute for the signed lane.

Each PR prerelease retains source provenance, for example:

```text
0.1.0-pr.68.codex-thingtime-mcp-desktop-connectors.gabcdef123456
0.1.0-pr.68.codex-thingtime-mcp-desktop-connectors.gabcdef123456.unsigned
```

The release notes retain the full PR number, normalized branch, commit, and
distribution type. The regular updater cache accepts only the signed/notarized
lane. Thingtime Recovery lists an unsigned release with a permanent UNSIGNED
badge and requires an explicit acknowledgement before it can cache, launch, or
atomically install that bundle. macOS can independently require the user to
choose **System Settings → Privacy & Security → Open Anyway** before first
launch; Recovery never calls an unsigned bundle a verified update.

## Local versus production proof

At the PR #68 checkpoint, local builds used a stable Apple Development identity
and proved strict deep-signature verification, installed-bundle verification,
the standalone Recovery UI, and a genuine Recovery self-replacement/relaunch.
Those local artifacts are intentionally not direct-distribution releases.

The trusted production lane remains fail-closed until all six secrets are
configured. The temporary unsigned lane is available only to the same
owner-approved PR release gate, is clearly marked at every artifact boundary,
and is intended to be retired when the trusted credentials arrive.
