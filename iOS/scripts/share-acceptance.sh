#!/usr/bin/env bash
set -euo pipefail
# Real system-sheet harness. Supply the final simulator .app; no personal simulator is used.
ROOT=$(cd "$(dirname "$0")/.." && pwd)
STATE=${SHARE_ACCEPTANCE_STATE:-$(mktemp -d /tmp/thingtime-share-acceptance.XXXXXX)}
# Respect active xcode-select and explicit DEVELOPER_DIR.
CREATED_SIM=0
cleanup() {
 if [[ -n ${SIM:-} ]]; then
  SNAPSHOT_DATA=$(xcrun simctl get_app_container "$SIM" com.thingtime.appletime data 2>/dev/null || true)
  if [[ -n "$SNAPSHOT_DATA" && -d "$SNAPSHOT_DATA/Documents/Shared" ]]; then ditto "$SNAPSHOT_DATA/Documents/Shared" "$STATE/imported-shares"; fi
  FIXTURE_SNAPSHOT=$(xcrun simctl get_app_container "$SIM" com.thingtime.shareacceptance data 2>/dev/null || true)
  if [[ -n "$FIXTURE_SNAPSHOT" && -d "$FIXTURE_SNAPSHOT/tmp" ]]; then
   python3 - "$FIXTURE_SNAPSHOT/tmp" "$STATE/original-live-photo" <<'LIVE_FIXTURE'
import pathlib,shutil,sys
photos=sorted(pathlib.Path(sys.argv[1]).rglob('live-photo.jpg'),key=lambda p:p.stat().st_mtime)
if photos:
 out=pathlib.Path(sys.argv[2]);out.mkdir(exist_ok=True)
 for source in photos[-1].parent.glob('live-photo.*'):shutil.copy2(source,out/source.name)
LIVE_FIXTURE
  fi
 fi
 if [[ "$CREATED_SIM" == 1 ]]; then
  xcrun simctl shutdown "$SIM" >/dev/null 2>&1 || true
  xcrun simctl delete "$SIM" >/dev/null 2>&1 || true
 fi
}
trap cleanup EXIT
mkdir -p "$STATE/source"
cp -R "$ROOT/ShareAcceptance/." "$STATE/source/"
python3 - "$STATE/source/Host" <<'PY'
import base64, pathlib, sys, wave, zipfile
p=pathlib.Path(sys.argv[1])
with wave.open(str(p/'fixture.wav'),'wb') as f:
 f.setnchannels(1); f.setsampwidth(2); f.setframerate(8000); f.writeframes(b'\0\0'*8000)
with zipfile.ZipFile(p/'fixture.zip','w') as f: f.writestr('exact-content.txt','Thingtime ZIP exact bytes')
# Minimal valid one-page PDF, with deterministic bytes.
parts=[b'1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n',b'2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n',b'3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n']
data=b'%PDF-1.4\n'; offsets=[0]
for part in parts: offsets.append(len(data)); data+=part
xref=len(data); data+=b'xref\n0 4\n0000000000 65535 f \n'+b''.join(f'{n:010d} 00000 n \n'.encode() for n in offsets[1:]); data+=f'trailer<</Size 4/Root 1 0 R>>\nstartxref\n{xref}\n%%EOF\n'.encode()
(p/'fixture.pdf').write_bytes(data)
PY
ffmpeg -loglevel error -f lavfi -i color=c=green:s=64x64:d=1 -frames:v 1 -y "$STATE/source/Host/fixture.png"
ffmpeg -loglevel error -f lavfi -i color=c=blue:s=64x64:d=1 -c:v libx264 -pix_fmt yuv420p -y "$STATE/source/Host/fixture.mp4"
xcodegen generate --spec "$STATE/source/project.yml" --project "$STATE/source"
if [[ -z ${SHARE_ACCEPTANCE_SIMULATOR:-} ]]; then
 read -r RUNTIME DEVICE < <(xcrun simctl list runtimes -j | python3 -c 'import json,sys; r=max((r for r in json.load(sys.stdin)["runtimes"] if r["isAvailable"] and r["platform"]=="iOS"),key=lambda r:tuple(map(int,r["version"].split(".")))); print(r["identifier"],next(d["identifier"] for d in r["supportedDeviceTypes"] if d["productFamily"]=="iPhone"))')
 SIM=$(xcrun simctl create 'Thingtime Share Acceptance' "${SHARE_ACCEPTANCE_DEVICE:-$DEVICE}" "${SHARE_ACCEPTANCE_RUNTIME:-$RUNTIME}")
 CREATED_SIM=1
else SIM=$SHARE_ACCEPTANCE_SIMULATOR; fi
printf '%s\n' "$SIM" > "$STATE/simulator-id"
xcrun simctl boot "$SIM" || true
xcrun simctl bootstatus "$SIM" -b
if [[ -n ${THINGTIME_SIMULATOR_APP:-} ]]; then xcrun simctl install "$SIM" "$THINGTIME_SIMULATOR_APP"; fi
xcrun simctl get_app_container "$SIM" com.thingtime.appletime app >/dev/null
printf 'STATE=%s\nSIMULATOR=%s\n' "$STATE" "$SIM"
xcodebuild -project "$STATE/source/ShareAcceptance.xcodeproj" -scheme ShareAcceptance -parallel-testing-enabled NO -destination "platform=iOS Simulator,id=$SIM" -derivedDataPath "$STATE/build" build-for-testing CODE_SIGNING_ALLOWED=NO > "$STATE/build.log" 2>&1
xcrun simctl install "$SIM" "$STATE/build/Build/Products/Debug-iphonesimulator/ShareAcceptance.app"
xcrun simctl privacy "$SIM" grant photos com.thingtime.shareacceptance
xcodebuild -project "$STATE/source/ShareAcceptance.xcodeproj" -scheme ShareAcceptance -parallel-testing-enabled NO -destination "platform=iOS Simulator,id=$SIM" -derivedDataPath "$STATE/build" -resultBundlePath "$STATE/results.xcresult" test-without-building CODE_SIGNING_ALLOWED=NO > "$STATE/test.log" 2>&1
APP_DATA=$(xcrun simctl get_app_container "$SIM" com.thingtime.appletime data)
FIXTURE_DATA=$(xcrun simctl get_app_container "$SIM" com.thingtime.shareacceptance data)
python3 - "$APP_DATA/Documents/Shared" "$STATE/source/Host" "$STATE/byte-verification.json" "$FIXTURE_DATA/tmp" <<'VERIFY'
import hashlib,json,pathlib,subprocess,sys
shared,fixtures=map(pathlib.Path,sys.argv[1:3])
files=[p for p in shared.rglob('*') if p.is_file()]
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
checks={}
result={'sharedFileCount':len(files),'fixtures':{},'checks':checks}
for f in fixtures.glob('fixture.*'):
 if f.suffix=='.swift':continue
 matches=[str(p.relative_to(shared)) for p in files if digest(p)==digest(f)]
 result['fixtures'][f.name]={'sha256':digest(f),'matches':matches}
for name in ['fixture.pdf','fixture.zip','fixture.wav','fixture.mp4']:
 checks[name+' exact bytes']=bool(result['fixtures'][name]['matches'])
checks['25 attachments exact bytes']=all(any(p.read_bytes()==f'attachment {i} exact bytes'.encode() for p in files) for i in range(25))
checks['custom UTI exact bytes']=any(p.read_bytes()==b'unknown custom type exact bytes' for p in files)
checks['text preserved']=any('Thingtime share acceptance – text\nUnicode: café 🌏' in p.read_text(errors='replace') for p in files)
checks['URL preserved']=any('https://example.com/thingtime-share?fixture=1' in p.read_text(errors='replace') for p in files)
checks['directory child exact bytes']=any(p.read_bytes()==b'directory child exact bytes' for p in files)
# UIImage can be re-encoded. Require a decoded image at its original dimensions.
images=[p for p in files if p.suffix.lower() in ['.png','.jpg','.jpeg','.heic'] or p.read_bytes().startswith((b'\x89PNG\r\n\x1a\n', b'\xff\xd8\xff'))]
checks['UIImage decodes at 64x64']=False
for image in images:
 info=subprocess.run(['sips','-g','pixelWidth','-g','pixelHeight',str(image)],capture_output=True,text=True)
 if info.returncode==0 and 'pixelWidth: 64' in info.stdout and 'pixelHeight: 64' in info.stdout:checks['UIImage decodes at 64x64']=True
# The entire mixed source must be committed in one user-visible batch.
def is_mixed_batch(batch):
 payload=[p for p in (batch/'Files').rglob('*') if p.is_file()]
 return (len(payload)>=5 and all(any(p.read_bytes()==(fixtures/name).read_bytes() for p in payload) for name in ['fixture.pdf','fixture.wav','fixture.mp4']) and any('https://example.com/share' in p.read_text(errors='replace') for p in payload) and any('Thingtime share acceptance' in p.read_text(errors='replace') for p in payload))
checks['mixed batch atomic']=any(is_mixed_batch(batch) for batch in shared.iterdir() if batch.is_dir())
# Photos acceptance independently compares both original generated resource streams.
live_photos=sorted(pathlib.Path(sys.argv[4]).rglob('live-photo.jpg'),key=lambda p:p.stat().st_mtime)
live_sources=list(live_photos[-1].parent.glob('live-photo.*')) if live_photos else []
live_result={}
for source in live_sources:
 live_result[source.name]={'sha256':digest(source),'matches':[str(p.relative_to(shared)) for p in files if digest(p)==digest(source)]}
result['livePhotoOriginalResources']=live_result
checks['Photos Live Photo exact still and motion']=len(live_sources)==2 and all(v['matches'] for v in live_result.values())
pathlib.Path(sys.argv[3]).write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
assert all(checks.values()), 'Failed checks: '+', '.join(name for name,passed in checks.items() if not passed)
VERIFY
