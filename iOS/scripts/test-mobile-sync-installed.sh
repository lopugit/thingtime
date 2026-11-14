#!/usr/bin/env bash
# Prepare normal authentication for visible CUA/manual installed-app acceptance.
# The default mode prepares authentication; opt-in export/photo scenarios exercise
# their documented disposable fixtures and visible native permission prompts.
set -euo pipefail
: "${DEST:?Set DEST to a concrete iOS simulator destination}"
if [ "${THINGTIME_PHOTO_BACKUP_TEST:-0}" = "1" ]; then
  case "$DEST" in
    'platform=iOS Simulator,'*) ;;
    *) echo 'Photos acceptance requires a disposable iOS Simulator destination.' >&2; exit 1 ;;
  esac
fi
fixture="${1:?Pass a mode-0600 disposable loopback account JSON fixture}"
fixture="$(python3 -c 'import os,sys;print(os.path.abspath(sys.argv[1]))' "$fixture")"
if [ -n "${THINGTIME_PHOTO_REOPEN_RECEIPT:-}" ]; then
  THINGTIME_PHOTO_REOPEN_RECEIPT="$(python3 -c 'import os,sys;print(os.path.abspath(sys.argv[1]))' "$THINGTIME_PHOTO_REOPEN_RECEIPT")"
  export THINGTIME_PHOTO_REOPEN_RECEIPT
fi
cd "$(dirname "$0")/.."
derived="${MOBILE_DEVICE_DERIVED_DATA:-$PWD/build/mobile-device-tests}"
mkdir -p "$derived"
lockdir="$derived/.mobile-installed-acceptance.lock"
if ! mkdir "$lockdir" 2>/dev/null; then
  echo "Another installed acceptance owns $lockdir; verify its recorded PID before recovering a stale lock." >&2
  exit 1
fi
printf '%s\n' "$$" > "$lockdir/pid"
runfile=""
trap 'if [ -n "$runfile" ]; then rm -f "$runfile"; fi; rm -f "$lockdir/pid"; rmdir "$lockdir"' EXIT
results="$derived/PhotosAcceptance-$$"
mkdir -m 700 "$results"
run_verified_test() {
  phase="$1"
  selector="$2"
  result="$results/$phase.xcresult"
  xcodebuild test-without-building -xctestrun "$runfile" -destination "$DEST" \
    -parallel-testing-enabled NO -only-testing:"$selector" -resultBundlePath "$result"
  xcrun xcresulttool get test-results summary --path "$result" | python3 -c '
import json,sys
s=json.load(sys.stdin)
assert s.get("totalTestCount",0)>0 and s.get("passedTests",0)>0 and s.get("failedTests",0)==0 and s.get("skippedTests",0)==0, "Installed acceptance did not execute passing tests"
print("IOS_INSTALLED_EXECUTED_PASS: tests="+str(s["passedTests"]))'
}
origin="$(python3 - "$fixture" <<'PY'
import json,pathlib,sys,urllib.parse
path=pathlib.Path(sys.argv[1]);assert path.stat().st_mode & 0o077 == 0
f=json.loads(path.read_text());u=urllib.parse.urlparse(f['base'])
assert u.scheme=='http' and u.hostname in ('localhost','127.0.0.1') and not u.username and not u.password
assert f['username'] and f['password'];print(f['base'])
PY
)"
verify_storage_ready() {
  node --input-type=module - "$fixture" "$1" <<'JSREADY'
import fs from 'node:fs';
const fixture=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const origin=new URL(fixture.base);
if(origin.origin!==fixture.base||origin.protocol!=='http:'||!['localhost','127.0.0.1'].includes(origin.hostname)) throw Error('Expected the exact disposable loopback origin');
let cookies=[];
async function api(path,body){
 const response=await fetch(origin.origin+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Origin:origin.origin,'Content-Type':'application/json',Cookie:cookies.join('; ')},body:body?JSON.stringify(body):undefined});
 cookies.push(...response.headers.getSetCookie().map(value=>value.split(';')[0]));
 if(!response.ok) throw Error('Storage-readiness prerequisite refused '+path+' (HTTP '+response.status+')');
 return response.json();
}
await api('/api/v1/login',{username:fixture.username,password:fixture.password});
const identity=await api('/api/v1/auth/me');
if(!fixture.userId||identity.user?.id!==fixture.userId) throw Error('The disposable fixture account changed');
const manifest=await api('/.well-known/thingtime-capabilities.json');
if(manifest.origin!==origin.origin) throw Error('Storage-readiness origin changed');
for(const [feature,minor,patch] of [['api.admin-migrations',4,1],['api.health-nitro',3,0]]){
 const v=manifest.features?.[feature]?.version?.split('.').map(Number);
 if(!v||v[0]!==1||v[1]<minor||(v[1]===minor&&v[2]<patch)) throw Error('Missing storage-readiness contract '+feature);
}
const health=await api('/api/v1/health/nitro');
const status=await api('/api/v1/admin/migrations');
const storage=status.migrations?.find(row=>row.id==='backfill-user-storage-accounting');
if(health.storageAccounting?.state!=='ready'||storage?.pending!==0) throw Error('Initialize the isolated database with the canonical backfill-user-storage-accounting migration before acceptance; never reconcile a normal writer failure silently');
console.log('IOS_STORAGE_READY: '+process.argv[3]+' pending='+storage.pending);
await api('/api/v1/auth/accounts/remove',{userId:fixture.userId});
JSREADY
}
if [ "${THINGTIME_PHOTO_UI_AUTOMATION:-0}" = "1" ]; then verify_storage_ready baseline; fi
test_class="MobileSyncInstalledTests"
if [ "${THINGTIME_FILE_EXPORT_TEST:-0}" = "1" ]; then test_class="FileExportInstalledTests"; fi
if [ "${THINGTIME_PHOTO_BACKUP_TEST:-0}" = "1" ]; then test_class="PhotoBackupInstalledTests"; fi
xcodegen generate
xcodebuild -project Thingtime.xcodeproj -scheme Thingtime -destination "$DEST" -derivedDataPath "$derived" \
  THINGTIME_WEB_URL="$origin" build-for-testing
runfile="$derived/Build/Products/MobileSyncInstalledAcceptance-$$.xctestrun"
python3 - "$fixture" "$derived" "$runfile" <<'PY'
import json,os,pathlib,plistlib,sys
fixture=json.load(open(sys.argv[1]));products=pathlib.Path(sys.argv[2])/'Build/Products'
source=max(products.glob('Thingtime_iphonesimulator*.xctestrun'),key=lambda p:p.stat().st_mtime)
data=plistlib.load(source.open('rb'))
data['ThingtimeTests'].setdefault('EnvironmentVariables',{}).update({
 'THINGTIME_PHOTO_NEW_INDEX_TEST':os.environ.get('THINGTIME_PHOTO_NEW_INDEX_TEST','0'),
 'THINGTIME_PHOTO_INDEX_REBUILD_TEST':os.environ.get('THINGTIME_PHOTO_INDEX_REBUILD_TEST','0'),
 'THINGTIME_PHOTO_INDEX_TEST':os.environ.get('THINGTIME_PHOTO_INDEX_TEST','0'),
 'THINGTIME_PHOTO_UI_AUTOMATION':os.environ.get('THINGTIME_PHOTO_UI_AUTOMATION','0'),
 'THINGTIME_PHOTO_DEFERRED_TEST':os.environ.get('THINGTIME_PHOTO_DEFERRED_TEST','0'),
 'THINGTIME_PHOTO_AUTOMATIC_TEST':os.environ.get('THINGTIME_PHOTO_AUTOMATIC_TEST',os.environ.get('THINGTIME_PHOTO_BACKUP_TEST','0')),
 'THINGTIME_PHOTO_EXPECT_NEWEST':os.environ.get('THINGTIME_PHOTO_EXPECT_NEWEST','0'),
 'THINGTIME_PHOTO_POLICY_TEST':os.environ.get('THINGTIME_PHOTO_POLICY_TEST','0'),
 'THINGTIME_PHOTO_BACKGROUND_TEST':os.environ.get('THINGTIME_PHOTO_BACKGROUND_TEST','0'),
 'THINGTIME_PHOTO_RESUME_GRANT':os.environ.get('THINGTIME_PHOTO_RESUME_GRANT',''),'THINGTIME_SYNC_INSTALLED_ACCEPTANCE':'1','THINGTIME_PHOTO_BACKUP_TEST':os.environ.get('THINGTIME_PHOTO_BACKUP_TEST','0'),'THINGTIME_FILE_EXPORT_TEST':os.environ.get('THINGTIME_FILE_EXPORT_TEST','0'),'THINGTIME_DEVICE_TEST_ORIGIN':fixture['base'],
 'THINGTIME_DEVICE_TEST_USERNAME':fixture['username'],'THINGTIME_DEVICE_TEST_PASSWORD':fixture['password']})
if os.environ.get('THINGTIME_PHOTO_UI_AUTOMATION') == '1':
 assert os.environ.get('THINGTIME_PHOTO_BACKUP_TEST') == '1'
 receipt=os.environ.get('THINGTIME_PHOTO_REOPEN_RECEIPT')
 data['ThingtimeTests']['EnvironmentVariables']['THINGTIME_PHOTO_PREPARE_ONLY']='0' if receipt else '1'
 if receipt:
  path=pathlib.Path(receipt);assert path.stat().st_mode & 0o077 == 0
  saved=json.loads(path.read_text())
  assert all(isinstance(saved.get(key),str) and saved[key] for key in ('id','name','rootId','localRootId')) and saved.get('files')
  data['ThingtimeTests']['EnvironmentVariables'].update({'THINGTIME_PHOTO_REOPEN_RECEIPT':json.dumps(saved),'THINGTIME_PHOTO_RESUME_GRANT':saved['localRootId']})
 data['ThingtimeUITests'].setdefault('EnvironmentVariables',{}).update({
  'THINGTIME_PHOTO_UI_AUTOMATION':'1','THINGTIME_DEVICE_TEST_ORIGIN':fixture['base']})
fd=os.open(sys.argv[3],os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600);os.fchmod(fd,0o600)
with os.fdopen(fd,'wb') as out:plistlib.dump(data,out)
PY
if [ "${THINGTIME_PHOTO_UI_AUTOMATION:-0}" = "1" ] && [ -z "${THINGTIME_PHOTO_REOPEN_RECEIPT:-}" ]; then
  run_verified_test prepare "ThingtimeTests/$test_class"
  verify_storage_ready after-prepare
  run_verified_test consent ThingtimeUITests/PhotoLibraryConsentUITests
  verify_storage_ready after-consent
  python3 - "$runfile" <<'PYRUN'
import plistlib,sys
p=sys.argv[1]
with open(p,'rb') as source:data=plistlib.load(source)
data['ThingtimeTests']['EnvironmentVariables']['THINGTIME_PHOTO_PREPARE_ONLY']='0'
with open(p,'wb') as target:plistlib.dump(data,target)
PYRUN
fi
run_verified_test originals "${THINGTIME_MOBILE_TEST_SELECTOR:-ThingtimeTests/$test_class}"
if [ "${THINGTIME_PHOTO_UI_AUTOMATION:-0}" = "1" ]; then verify_storage_ready after-originals; fi
