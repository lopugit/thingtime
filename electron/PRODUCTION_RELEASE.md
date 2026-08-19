# Electron production release control-plane patch

Executable Electron release behavior lives on the protected `github-actions`
ref. The `main`-branch shim cannot safely change that ref. Before re-enabling
release publication, update its `.github/workflows/electron-release.yml` as
follows.

## Required behavior

1. Add `MCP/**` and `macos/**` to the direct-push path triggers.
2. Install `MCP` dependencies as well as Remix and Electron dependencies.
3. Before packaging, run:

   ```sh
   corepack pnpm --dir MCP run typecheck
   corepack pnpm --dir MCP test
   corepack pnpm --dir MCP run build:desktop
   swift test --package-path macos/ThingtimeNode
   swift build --package-path macos/ThingtimeNode --configuration release --product ThingtimeNode
   swift build --package-path macos/ThingtimeNode --configuration release --product ThingtimeNodeBridge
   corepack pnpm --dir electron test
   ```

4. Replace the former `dist:unsigned` build with
   `corepack pnpm --dir electron run dist`. Do not retain an unsigned fallback.
5. Import a **Developer ID Application** `.p12` into an ephemeral CI keychain
   before `dist` runs. Set `THINGTIME_ELECTRON_SIGNING_IDENTITY`, `CSC_NAME`,
   and `CSC_KEYCHAIN` to that imported identity/keychain so the Swift helper and
   Electron outer bundle use the same team and identity. Delete the temporary
   keychain in an `if: always()` cleanup step.
6. Provide one complete electron-builder notarization credential set. The
   recommended CI set is `APPLE_API_KEY`, `APPLE_API_KEY_ID`,
   `APPLE_API_ISSUER`, and `APPLE_TEAM_ID`. Keep all values in GitHub Actions
   secrets; never write certificate or key content to the repository or logs.
7. Publish only after `dist` has completed its strict signature,
   `spctl --assess`, and `xcrun stapler validate` checks.

## Secret mapping

Use repository or environment secrets with placeholders equivalent to:

```yaml
env:
  MAC_CSC_LINK: ${{ secrets.MAC_CSC_LINK }}
  MAC_CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
  APPLE_API_KEY_BASE64: ${{ secrets.APPLE_API_KEY_BASE64 }}
  APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
  APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
  APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

`MAC_CSC_LINK` is the base64-encoded Developer ID Application `.p12`, not an
Apple Development, Apple Distribution, or Developer ID Installer certificate.
The import step must avoid echoing any secret and must grant `/usr/bin/codesign`
access to the ephemeral keychain key.

`APPLE_API_KEY_BASE64` is the base64-encoded App Store Connect `.p8`. The
workflow must decode it into `RUNNER_TEMP` and set `APPLE_API_KEY` to that
temporary file path; `APPLE_API_KEY` itself is not the key contents.

## Concrete protected-workflow steps

Keep the existing metadata, duplicate-release, asset collection, release-note,
and publication steps. Add MCP installation after the current Remix install,
replace the unsigned build step with the following sequence, and place cleanup
after publication. This is a template for the protected ref; placeholders are
GitHub secrets and no secret value belongs in source control.

```yaml
- name: Install MCP dependencies
  if: steps.existing_release.outputs.exists != 'true'
  run: corepack pnpm --dir MCP install --frozen-lockfile

- name: Test desktop runtimes
  if: steps.existing_release.outputs.exists != 'true'
  run: |
    set -euo pipefail
    corepack pnpm --dir MCP run typecheck
    corepack pnpm --dir MCP test
    corepack pnpm --dir MCP run build:desktop
    swift test --package-path macos/ThingtimeNode
    swift build --package-path macos/ThingtimeNode --configuration release --product ThingtimeNode
    swift build --package-path macos/ThingtimeNode --configuration release --product ThingtimeNodeBridge
    corepack pnpm --dir electron test

- name: Import Developer ID and notarization credentials
  if: steps.existing_release.outputs.exists != 'true'
  shell: bash
  env:
    MAC_CSC_LINK: ${{ secrets.MAC_CSC_LINK }}
    MAC_CSC_KEY_PASSWORD: ${{ secrets.MAC_CSC_KEY_PASSWORD }}
    APPLE_API_KEY_BASE64: ${{ secrets.APPLE_API_KEY_BASE64 }}
    APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
    APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
  run: |
    set -euo pipefail
    keychain_path="${RUNNER_TEMP}/thingtime-signing.keychain-db"
    certificate_path="${RUNNER_TEMP}/thingtime-developer-id.p12"
    api_key_path="${RUNNER_TEMP}/AuthKey_${APPLE_API_KEY_ID}.p8"
    keychain_password="$(openssl rand -hex 32)"

    printf '%s' "${MAC_CSC_LINK}" | /usr/bin/base64 -D > "${certificate_path}"
    printf '%s' "${APPLE_API_KEY_BASE64}" | /usr/bin/base64 -D > "${api_key_path}"
    chmod 600 "${certificate_path}" "${api_key_path}"

    security create-keychain -p "${keychain_password}" "${keychain_path}"
    security set-keychain-settings -lut 21600 "${keychain_path}"
    security unlock-keychain -p "${keychain_password}" "${keychain_path}"
    security import "${certificate_path}" -k "${keychain_path}" \
      -P "${MAC_CSC_KEY_PASSWORD}" -T /usr/bin/codesign -T /usr/bin/security
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
      -k "${keychain_password}" "${keychain_path}"
    security list-keychains -d user -s "${keychain_path}"
    security default-keychain -d user -s "${keychain_path}"

    identity="$(security find-identity -v -p codesigning "${keychain_path}" \
      | sed -nE 's/.*"(Developer ID Application:[^"]+)".*/\1/p' | head -n 1)"
    test -n "${identity}"

    {
      echo "CSC_KEYCHAIN=${keychain_path}"
      echo "CSC_NAME=${identity}"
      echo "THINGTIME_ELECTRON_SIGNING_IDENTITY=${identity}"
      echo "APPLE_API_KEY=${api_key_path}"
      echo "APPLE_API_KEY_ID=${APPLE_API_KEY_ID}"
      echo "APPLE_API_ISSUER=${APPLE_API_ISSUER}"
      echo "APPLE_TEAM_ID=${APPLE_TEAM_ID}"
    } >> "${GITHUB_ENV}"

- name: Build signed and notarized Electron bundle
  if: steps.existing_release.outputs.exists != 'true'
  run: corepack pnpm --dir electron run dist

- name: Remove ephemeral signing material
  if: always()
  shell: bash
  run: |
    security delete-keychain "${RUNNER_TEMP}/thingtime-signing.keychain-db" 2>/dev/null || true
    rm -f "${RUNNER_TEMP}/thingtime-developer-id.p12" "${RUNNER_TEMP}"/AuthKey_*.p8
```

The protected workflow currently sets `CSC_IDENTITY_AUTO_DISCOVERY=false` at
job scope. Remove that value or change it to `true`; the production build also
sets discovery explicitly after it has verified the requested Developer ID
identity. Never add `continue-on-error` to signing, notarization, Gatekeeper, or
stapler validation.

At the 2026-08-19 PR #68 checkpoint, the canonical local `build` and
`install:local` paths passed with a stable Apple Development identity, including
strict deep signature and repository verifier checks on byte-identical built
and installed bundles. The local keychain had no Developer ID Application
identity, so Gatekeeper rejection is expected for that local artifact. The
protected `github-actions` workflow remains stale and production `dist`,
notarization, stapling, and Gatekeeper acceptance remain blocked until this
protected-ref patch and its production credentials are provisioned.
