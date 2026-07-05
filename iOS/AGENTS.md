# Thingtime iOS Agent Runbook

This directory contains the native iOS shell for Thingtime. Treat
`project.yml` as the source of truth; generated Xcode project files are build
artifacts and should stay untracked.

## Apple Developer And TestFlight Flow

- Use `scripts/testflight-beta.sh` from this `iOS/` directory for TestFlight
  uploads. It loads ignored values from `iOS/.env` when present and then runs
  `bundle exec fastlane beta`.
- Keep all Apple account values out of git. Put real values only in the shell
  environment or ignored `iOS/.env`; keep `.p8` files in the local/private
  config folder, not in the repo.
- Required upload env:
  - `ASC_KEY_ID`: App Store Connect API key ID for the individual Apple account
    that can see the Thingtime app.
  - `ASC_ISSUER_ID`: issuer ID from App Store Connect Users and Access.
  - `ASC_KEY_CONTENT`: base64-encoded `.p8` contents. The current Fastlane lane
    expects key content, not a key filepath.
  - `DEVELOPMENT_TEAM`: Apple developer team/App ID prefix used for Thingtime.
  - `PRODUCT_BUNDLE_IDENTIFIER`: `com.thingtime.appletime`.
  - `THINGTIME_WEB_URL`: optional webview URL; omit it to build
    `https://thingtime.com`, or set it to a Vercel branch deployment for
    TestFlight preview builds.
- Before spending time on signing problems, verify App Store Connect auth. The
  key, issuer, and `.p8` must be able to call the App Store Connect API and
  list the Thingtime app by bundle ID. A 401 from Apple means the key ID,
  issuer ID, or `.p8` file do not match, even if the filename looks right.
- Do not reuse LiDAR-project keys, issuer IDs, bundle IDs, or provisioning
  assumptions. Thingtime's app record is the source of truth for this app.
- If several local `.p8` files exist, test each candidate key against App Store
  Connect and use the one that can see the Thingtime app. Do not infer the
  correct key from filename alone.
- Use an Xcode install that has the required iPhoneOS SDK. For beta SDKs, set
  `DEVELOPER_DIR` explicitly, for example:

  ```sh
  export DEVELOPER_DIR="/Applications/Xcode-beta.app/Contents/Developer"
  xcodebuild -runFirstLaunch
  xcrun --sdk iphoneos --show-sdk-version
  ```

- The Fastlane lane syncs an Apple Distribution certificate and App Store
  provisioning profile through the App Store Connect API before archiving. Use
  `SKIP_CERT_SYNC=1` or `SKIP_PROFILE_SYNC=1` only when the correct signing
  asset is already installed and you intentionally want to skip that sync.
- If export fails with a cloud signing permission/profile lookup error while a
  valid App Store profile is already installed, set
  `PROVISIONING_PROFILE_SPECIFIER` to that installed profile name. The lane
  will use manual export mapping only when this variable is present.
- For each TestFlight upload, bump `CURRENT_PROJECT_VERSION` in `project.yml`.
  `CFBundleVersion` and `CFBundleShortVersionString` are generated from
  `project.yml`; do not edit generated `.xcodeproj` files to change versioning.
- After a successful upload, verify the IPA metadata when useful:

  ```sh
  /usr/bin/unzip -p build/Thingtime.ipa 'Payload/Thingtime.app/Info.plist' | \
    plutil -p -
  ```

## Common Command

```sh
cd iOS
cp .env.example .env
# Fill .env with the required Apple values, then encode the matching p8 key:
export ASC_KEY_CONTENT="$(base64 -i /path/to/AuthKey_KEYID.p8)"
scripts/testflight-beta.sh
```

## Simulator Testing

- `scripts/test.sh` defaults through the shared build destination, which may be
  a generic simulator destination. If Xcode rejects that for tests with "Tests
  must be run on a concrete device", pick an available simulator with
  `xcrun simctl list devices available` and rerun, for example:

  ```sh
  DEST='platform=iOS Simulator,id=<simulator-uuid>' ./scripts/test.sh
  ```
