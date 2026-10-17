#!/usr/bin/env bash
# Reproducible Android debug acceptance; fixture credentials never enter adb arguments or build outputs.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
fixture="${1:-}"
picker_test="${THINGTIME_FOLDER_PICKER_TEST:-0}"
offline_test="${THINGTIME_OFFLINE_FILES_TEST:-0}"
download_state="${THINGTIME_OFFLINE_DOWNLOAD_STATE:-}"
two_way="${THINGTIME_TWO_WAY_SYNC_TEST:-0}"
sync_deletion="${THINGTIME_DELETE_SYNC_TEST:-0}"
[[ "$sync_deletion" == 0 || "$sync_deletion" == 1 ]] || { echo 'THINGTIME_DELETE_SYNC_TEST must be 0 or 1.' >&2; exit 1; }
[[ "$sync_deletion" == 0 || "$two_way" == 1 ]] || { echo 'Deletion acceptance requires two-way acceptance.' >&2; exit 1; }
conflict_review="${THINGTIME_CONFLICT_SYNC_TEST:-0}"
[[ "$sync_deletion" == 0 || "$conflict_review" == 0 ]] || { echo 'Run deletion and concurrent edit review acceptance separately.' >&2; exit 1; }
file_history="${THINGTIME_FILE_HISTORY_TEST:-0}"
file_export="${THINGTIME_FILE_EXPORT_TEST:-0}"
native_versions="${THINGTIME_NATIVE_VERSIONS_TEST:-0}"
[[ "$native_versions" == 0 || "$native_versions" == 1 ]] || { echo 'THINGTIME_NATIVE_VERSIONS_TEST must be 0 or 1.' >&2; exit 1; }
[[ "$native_versions" == 0 || ( "$offline_test" == 1 && -z "$download_state" ) ]] || { echo 'Native versions acceptance requires THINGTIME_OFFLINE_FILES_TEST=1 without a cloud download fixture.' >&2; exit 1; }
native_trash="${THINGTIME_NATIVE_TRASH_TEST:-0}"
[[ "$native_trash" == 0 || "$native_trash" == 1 ]] || { echo 'THINGTIME_NATIVE_TRASH_TEST must be 0 or 1.' >&2; exit 1; }
[[ "$native_trash" == 0 || ( "$offline_test" == 1 && -z "$download_state" ) ]] || { echo 'Native recovery acceptance requires THINGTIME_OFFLINE_FILES_TEST=1 without a cloud download fixture.' >&2; exit 1; }
[[ "$file_export" == 0 || "$file_export" == 1 ]] || { echo 'THINGTIME_FILE_EXPORT_TEST must be 0 or 1.' >&2; exit 1; }
[[ "$file_export" == 0 || "$file_history" == 1 ]] || { echo 'File export acceptance requires THINGTIME_FILE_HISTORY_TEST=1.' >&2; exit 1; }
[[ "$file_history" == 0 || "$file_history" == 1 ]] || { echo 'THINGTIME_FILE_HISTORY_TEST must be 0 or 1.' >&2; exit 1; }
[[ "$file_history" == 0 || -n "$fixture" ]] || { echo 'File History acceptance requires a disposable local account fixture.' >&2; exit 1; }
[[ "$conflict_review" == 0 || "$conflict_review" == 1 ]] || { echo 'THINGTIME_CONFLICT_SYNC_TEST must be 0 or 1.' >&2; exit 1; }
[[ "$conflict_review" == 0 || "$two_way" == 1 ]] || { echo 'Conflict acceptance requires two-way acceptance.' >&2; exit 1; }
[[ "$two_way" == 0 || "$two_way" == 1 ]] || { echo 'THINGTIME_TWO_WAY_SYNC_TEST must be 0 or 1.' >&2; exit 1; }
[[ "$two_way" == 0 || -n "$download_state" ]] || { echo 'Two-way acceptance requires THINGTIME_OFFLINE_DOWNLOAD_STATE.' >&2; exit 1; }
if [[ -n "$download_state" ]]; then offline_test=1; fi
[[ "$offline_test" == 0 || "$offline_test" == 1 ]] || { echo 'THINGTIME_OFFLINE_FILES_TEST must be 0 or 1.' >&2; exit 1; }
[[ "$offline_test" == 0 || -n "$fixture" ]] || { echo 'Offline Files acceptance requires a disposable local account fixture.' >&2; exit 1; }
upload_test="${THINGTIME_FOLDER_UPLOAD_TEST:-0}"
descriptor_test="${THINGTIME_FOLDER_DESCRIPTOR_TEST:-0}"
approval_test="${THINGTIME_FOLDER_APPROVAL_TEST:-0}"
[[ "$approval_test" == 0 || "$approval_test" == 1 ]] || { echo 'THINGTIME_FOLDER_APPROVAL_TEST must be 0 or 1.' >&2; exit 1; }
if [[ "$approval_test" == 1 ]]; then picker_test=1; fi
[[ "$descriptor_test" == 0 || "$descriptor_test" == 1 ]] || { echo 'THINGTIME_FOLDER_DESCRIPTOR_TEST must be 0 or 1.' >&2; exit 1; }
if [[ "$descriptor_test" == 1 ]]; then picker_test=1; fi
[[ "$upload_test" == 0 || "$upload_test" == 1 ]] || { echo 'THINGTIME_FOLDER_UPLOAD_TEST must be 0 or 1.' >&2; exit 1; }
if [[ "$upload_test" == 1 ]]; then picker_test=1; fi
[[ "$picker_test" == 0 || "$picker_test" == 1 ]] || { echo 'THINGTIME_FOLDER_PICKER_TEST must be 0 or 1.' >&2; exit 1; }
[[ "$picker_test" == 0 || -n "$fixture" ]] || { echo 'Picker acceptance requires a disposable local account fixture.' >&2; exit 1; }
[[ "$offline_test" == 0 || "$picker_test" == 0 ]] || { echo 'Run offline Files and existing-folder acceptance separately.' >&2; exit 1; }
serial="${ANDROID_SERIAL:-}"
if [[ -z "$serial" ]]; then
  serial="$(adb devices | awk 'NR>1 && $2=="device" { print $1 }')"
  [[ -n "$serial" && "$serial" != *$'\n'* ]] || { echo 'Set ANDROID_SERIAL to one connected test device.' >&2; exit 1; }
fi
origin='https://thingtime.com'
if [[ -n "$fixture" ]]; then
  origin="$(python3 - "$fixture" <<'PY'
import json,os,stat,sys,urllib.parse
p=sys.argv[1]
if stat.S_IMODE(os.stat(p).st_mode)&0o077: raise SystemExit('Test fixture must be mode 0600')
c=json.load(open(p)); u=urllib.parse.urlparse(c['base'])
if u.scheme!='http' or u.hostname not in ('127.0.0.1','localhost') or u.username or u.password or u.path not in ('','/') or u.query or u.fragment or not u.port: raise SystemExit('Use an explicit loopback test origin with a port')
if not all(isinstance(c.get(k),str) and c[k] for k in ('username','password','userId')): raise SystemExit('Missing disposable test account fields')
print(c['base'].rstrip('/'))
PY
)"
fi
"$root/gradlew" -p "$root" assembleDebug assembleDebugAndroidTest testDebugUnitTest lintDebug "-PthingtimeWebUrl=$origin"
adb -s "$serial" install -r "$root/app/build/outputs/apk/debug/app-debug.apk"
adb -s "$serial" install -r "$root/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
cleanup() { adb -s "$serial" shell run-as com.thingtime.mobile.dev rm -f files/device-test-fixture.json files/download-test-cloud.json >/dev/null 2>&1 || true; }
trap cleanup EXIT
if [[ -n "$fixture" ]]; then
  port="${origin##*:}"
  adb -s "$serial" reverse "tcp:$port" "tcp:$port"
  adb -s "$serial" shell run-as com.thingtime.mobile.dev mkdir -p files
  adb -s "$serial" shell run-as com.thingtime.mobile.dev sh -c '"cat > files/device-test-fixture.json"' < "$fixture"
fi
if [[ -n "$download_state" ]]; then
  python3 - "$download_state" "$fixture" <<'PYDATA'
import json,os,stat,sys
p=sys.argv[1]
assert stat.S_IMODE(os.stat(p).st_mode)&0o077==0
s=json.load(open(p)); f=json.load(open(sys.argv[2]))
assert s['ownerId']==f['userId'] and s['origin']==f['base'] and not s.get('cleaned')
assert len(s['files'])==2 and all(x['size']>0 and len(x['sha256'])==64 for x in s['files'])
PYDATA
  adb -s "$serial" shell run-as com.thingtime.mobile.dev sh -c '"cat > files/download-test-cloud.json"' < "$download_state"
fi
result="$(mktemp)"
test_args=()
if [[ "$sync_deletion" == 1 ]]; then test_args+=(-e syncDeletion true); fi
if [[ "$native_trash" == 1 ]]; then test_args+=(-e nativeTrash true); fi
if [[ "$native_versions" == 1 ]]; then test_args+=(-e nativeVersions true); fi
if [[ "$file_export" == 1 ]]; then test_args+=(-e fileExport true); fi
if [[ "$file_history" == 1 ]]; then test_args+=(-e fileHistory true); fi
if [[ "$offline_test" == 1 ]]; then
  test_args+=(-e offlineSelection true)
  if [[ "$two_way" == 1 ]]; then test_args+=(-e twoWaySync true); fi
  if [[ "$conflict_review" == 1 ]]; then test_args+=(-e conflictReview true); fi
  if [[ -n "$download_state" ]]; then test_args+=(-e offlineDownload true); fi
  if [[ -n "$download_state" ]]; then
    echo 'Create Thingtime offline through the native New offline folder flow. Inspect it in Android Files when prompted.'
  else
    echo 'Create ThingtimeOfflineQA through the native New offline folder flow. Inspect it in Android Files when prompted.'
  fi
fi
if [[ "$picker_test" == 1 ]]; then
  test_args+=(-e folderSelection true)
  if [[ "$descriptor_test" == 1 ]]; then test_args+=(-e folderDescriptor true); fi
  if [[ "$approval_test" == 1 ]]; then test_args+=(-e folderApproval true); fi
  if [[ "$upload_test" == 1 ]]; then test_args+=(-e folderUpload true); fi
  echo 'When the installed app is ready, choose Documents/ThingtimeSyncQA through its Folder access control.'
fi
echo 'Wait for the live QA_READY or consent prompt before interacting with the app.'
if ! adb -s "$serial" shell am instrument -w "${test_args[@]}" com.thingtime.mobile.dev.test/androidx.test.runner.AndroidJUnitRunner | tee "$result"; then
  rm -f "$result"
  exit 1
fi
if ! grep -q '^OK (' "$result"; then rm -f "$result"; exit 1; fi
rm -f "$result"
adb -s "$serial" shell am start -n com.thingtime.mobile.dev/com.thingtime.mobile.MainActivity
