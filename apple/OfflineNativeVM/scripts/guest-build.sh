#!/bin/bash
# Fixed guest-only recipe. Media creation never runs this file. No sudo, license
# acceptance, credential import, network enablement, signing or product launch.
# Every entry crosses this boundary; there is no caller-selectable clean-stage argument.
exec /usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin LANG=C LC_ALL=C \
    /bin/bash --noprofile --norc -s -- "$@" <<'OFFLINE_GUEST_RECIPE'
set -euo pipefail
umask 077
[ "$#" -eq 2 ] || exit 64
media=$1
work=$2
case "$media:$work" in /*:/*) ;; *) exit 64 ;; esac
# No reused mutable workspace. No imported host HOME, tokens or developer state.
/bin/mkdir -m 700 "$work"
/bin/mkdir -m 700 "$work/home" "$work/tmp" "$work/output" "$work/bin"
export HOME="$work/home" TMPDIR="$work/tmp/"
export USER=$(/usr/bin/id -un) LOGNAME=$(/usr/bin/id -un)
result="$work/output/guest-result.txt"
phase='media-verification'
trap 'code=$?; if [ "$code" -ne 0 ]; then /usr/bin/printf "result=failed\nphase=%s\ncandidateAcceptance=false\n" "$phase" > "$result"; fi' EXIT
manifest="$media/build-manifest.json"
read_manifest() { /usr/bin/plutil -extract "$1" raw -o - "$manifest"; }
verify_member() {
    expected=$(read_manifest "files.$1.sha256")
    actual=$(/usr/bin/shasum -a 256 "$media/$2")
    actual=${actual%% *}
    [ "$actual" = "$expected" ]
}
verify_member sourceArchive source.tar
verify_member sourceManifest source-manifest.json
verify_member xcodeArchive Xcode.tar.gz
verify_member xcodegen xcodegen
verify_member recipe guest-build.sh
[ "$(read_manifest contractVersion)" = '1.0.0' ]
[ "$(read_manifest candidateAdmission)" = 'false' ]
phase='toolchain-extraction'
/usr/bin/tar -xzf "$media/Xcode.tar.gz" -C "$work"
/usr/bin/tar -xf "$media/source.tar" -C "$work"
/bin/cp "$media/xcodegen" "$work/bin/xcodegen"
/bin/chmod 700 "$work/bin/xcodegen"
export DEVELOPER_DIR="$work/Xcode.app/Contents/Developer"
export PATH="$work/bin:$DEVELOPER_DIR/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin"
phase='vendor-signature'
/usr/bin/codesign --verify --deep --strict -R='anchor apple and identifier "com.apple.dt.Xcode"' \
    "$work/Xcode.app" > "$work/output/vendor-signature.log" 2>&1
phase='toolchain-versions'
/usr/bin/xcrun xcodebuild -version > "$work/output/xcode-version.txt" 2>&1
/usr/bin/grep -Fx "Xcode $(read_manifest toolchain.xcode)" "$work/output/xcode-version.txt" > /dev/null
/usr/bin/grep -Fx "Build version $(read_manifest toolchain.xcodeBuild)" "$work/output/xcode-version.txt" > /dev/null
[ "$(/usr/bin/xcrun xcodebuild -version -sdk macosx SDKVersion)" = "$(read_manifest toolchain.macOSSDK)" ]
[ "$(/usr/bin/xcrun xcodebuild -version -sdk iphonesimulator SDKVersion)" = "$(read_manifest toolchain.simulatorSDK)" ]
[ "$("$work/bin/xcodegen" --version)" = "Version: $(read_manifest toolchain.xcodegen)" ]
# Checks only: never accept terms or run first-launch installers automatically.
phase='license-or-first-launch-prerequisite'
/usr/bin/xcrun xcodebuild -license check > "$work/output/license-check.log" 2>&1
/usr/bin/xcrun xcodebuild -checkFirstLaunchStatus > "$work/output/first-launch-check.log" 2>&1
phase='project-generation'
"$work/bin/xcodegen" generate --no-env --spec "$work/source/macos/ThingtimePasswords/project.yml" \
    --project "$work/source/macos/ThingtimePasswords" > "$work/output/mac-generation.log" 2>&1
"$work/bin/xcodegen" generate --no-env --spec "$work/source/iOS/project.yml" \
    --project "$work/source/iOS" > "$work/output/ios-generation.log" 2>&1
# Reject executable custom phases/rules and remote package references in both graphs.
for graph in "$work/source/macos/ThingtimePasswords/ThingtimePasswords.xcodeproj/project.pbxproj" \
             "$work/source/iOS/Thingtime.xcodeproj/project.pbxproj"; do
    if /usr/bin/grep -Eq 'PBXShellScriptBuildPhase|PBXBuildRule|XCRemoteSwiftPackageReference' "$graph"; then
        phase='unsupported-build-graph'
        exit 1
    fi
done
phase='password-core-tests'
/usr/bin/xcrun swift test --package-path "$work/source/apple/Passwords" \
    --scratch-path "$work/output/password-core-build" > "$work/output/password-core-tests.log" 2>&1
phase='file-sync-tests'
/usr/bin/xcrun swift test --package-path "$work/source/apple/FileSync" \
    --scratch-path "$work/output/file-sync-build" > "$work/output/file-sync-tests.log" 2>&1
# No archive/export/test action, automatic provisioning, validation skips or signing.
# All app resources, providers, Watch/widget dependencies and tests remain included.
phase='mac-unsigned-build'
/usr/bin/xcrun xcodebuild -project "$work/source/macos/ThingtimePasswords/ThingtimePasswords.xcodeproj" \
    -scheme ThingtimePasswords -configuration Release -destination 'platform=macOS,arch=arm64' \
    -derivedDataPath "$work/output/mac/DerivedData" -clonedSourcePackagesDirPath "$work/output/mac/clones" \
    -packageCachePath "$work/output/mac/package-cache" -disableAutomaticPackageResolution \
    -skipPackageUpdates -disablePackageRepositoryCache -resultBundlePath "$work/output/mac/result.xcresult" \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= DEVELOPMENT_TEAM= \
    PROVISIONING_PROFILE_SPECIFIER= THINGTIME_WEB_URL=https://example.invalid \
    THINGTIME_PASSWORD_KEYCHAIN_GROUP=unsigned.com.thingtime.passwords \
    "CLANG_MODULE_CACHE_PATH=$work/output/mac/module-cache" \
    "SWIFT_MODULECACHE_PATH=$work/output/mac/swift-module-cache" build > "$work/output/mac-build.log" 2>&1
phase='ios-simulator-test-target-compilation'
/usr/bin/xcrun xcodebuild -project "$work/source/iOS/Thingtime.xcodeproj" -scheme Thingtime \
    -configuration Debug -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$work/output/ios/DerivedData" -clonedSourcePackagesDirPath "$work/output/ios/clones" \
    -packageCachePath "$work/output/ios/package-cache" -disableAutomaticPackageResolution \
    -skipPackageUpdates -disablePackageRepositoryCache -resultBundlePath "$work/output/ios/result.xcresult" \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= DEVELOPMENT_TEAM= \
    PROVISIONING_PROFILE_SPECIFIER= THINGTIME_WEB_URL=https://example.invalid \
    THINGTIME_PASSWORD_KEYCHAIN_GROUP=unsigned.com.thingtime.passwords \
    "CLANG_MODULE_CACHE_PATH=$work/output/ios/module-cache" \
    "SWIFT_MODULECACHE_PATH=$work/output/ios/swift-module-cache" build-for-testing > "$work/output/ios-build.log" 2>&1
phase='ios-test-bundle-evidence'
/usr/bin/find "$work/output/ios/DerivedData/Build/Products" -name '*.xctestrun' -type f \
    > "$work/output/ios-test-plans.txt"
/usr/bin/find "$work/output/ios/DerivedData/Build/Products" -path '*/ThingtimeTests.xctest/Info.plist' -type f \
    > "$work/output/ios-test-bundles.txt"
if [ ! -s "$work/output/ios-test-plans.txt" ] || [ ! -s "$work/output/ios-test-bundles.txt" ]; then
    /usr/bin/printf 'iosTestTarget=unavailable\nplatformSkip=true\noverallSuccess=false\n' > "$work/output/ios-test-target.txt"
    exit 1
fi
/usr/bin/printf 'iosTestTarget=compiled\niosTestsExecuted=false\n' > "$work/output/ios-test-target.txt"
/usr/bin/printf 'result=compiled\nsourceCommit=%s\ncandidateAcceptance=false\noutputTrusted=false\n' \
    "$(read_manifest sourceCommit)" > "$result"
OFFLINE_GUEST_RECIPE
