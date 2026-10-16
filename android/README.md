# Thingtime Android

Native Android shell for the existing Thingtime web UI. Requires Android 8.0
(API 26) or newer and an updated Android System WebView. The first native
capability is account-scoped device pairing; file/Photos access and background
sync are separate work in [the acceptance ledger](../docs/mobile-file-sync.md).

## Build and run

Install JDK 17, Android SDK platform/build-tools 35, platform-tools and a supported
emulator image (or connect a test phone). Set `JAVA_HOME` and `ANDROID_HOME` to
your local installations. The checked-in Gradle wrapper verifies its distribution
checksum. No account-specific credentials or signing keys belong in git.

```sh
./android/gradlew -p android assembleDebug testDebugUnitTest lintDebug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.thingtime.mobile.dev/com.thingtime.mobile.MainActivity
```

Production defaults to `https://thingtime.com`. To target a compatible fork or
preview, pass `-PthingtimeWebUrl=https://your-thingtime.example` at build time.
The native bridge is restricted to that exact origin and main frame. Sign into
a full account, open Things or Settings → Things, then choose **Add this device**.
Older servers without the advertised pairing capability versions fail closed.

For local development, start the checkout's PM2 stack with `npm run web-pms` and
read its port with `npm run web-ports`. Build with
`-PthingtimeWebUrl=http://127.0.0.1:<web-port>` and run
`adb reverse tcp:<web-port> tcp:<web-port>`. Only debug builds permit loopback
HTTP; release builds require HTTPS. Debug installs use `com.thingtime.mobile.dev`.
Release signing and Play Store delivery are not configured by this checkpoint.

## Native acceptance

`android/scripts/test-mobile-devices.sh` runs JVM, lint, build and emulator/device
tests, then launches the rebuilt app. Set `ANDROID_SERIAL` if more than one test
device is connected. Without a fixture, the local API test is skipped.

For real pairing acceptance, create a disposable full account through the local
`POST /api/v1/auth/register` endpoint and save `base`, `username`, `password` and
`userId` in a mode-0600 JSON file outside the repository/web root. Then run:

```sh
ANDROID_SERIAL=<test-device-id> android/scripts/test-mobile-devices.sh /absolute/path/private-fixture.json
```

The script streams the fixture into the debug app's private storage, never adb
arguments or APK assets. Tests consume/delete it and sign the disposable session
out. The encrypted pairing record and its server device remain for retry tests.
Tests verify signature compatibility with the iOS/server fixture, exact completion
replay, account/origin isolation, cancellation, revocation, Keystore encryption,
tamper rejection, API readback and the installed Things connection control.

Software Ed25519 seeds and pending requests are encrypted with an Android
Keystore AES-GCM key and stored under `noBackupFilesDir` using atomic writes.
They never cross the JavaScript bridge. This does not claim hardware Ed25519
signing. Missing/corrupt storage fails closed. Navigation/backgrounding cancels
foreground work; no continuous background presence or file permission is claimed.

Implementation references: [Android WebView message listener](https://developer.android.com/reference/androidx/webkit/WebViewCompat.WebMessageListener),
[Android Keystore](https://developer.android.com/privacy-and-security/keystore),
[AGP 8.9 compatibility](https://developer.android.com/build/releases/agp-8-9-0-release-notes).
