#!/usr/bin/env bash
# Opt-in native UI acceptance, exclusively on a disposable task-owned simulator.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SHARED_DRAFT_SIMULATOR_ID:?Create a dedicated simulator named Thingtime shared draft dismiss QA and set its UUID}"
derived="${SHARED_DRAFT_DERIVED_DATA:-/tmp/codex-ios-shared-draft-dismiss/DerivedData}"
sim="$SHARED_DRAFT_SIMULATOR_ID"
xcrun simctl list devices available --json | python3 -c '
import json,sys
v=json.load(sys.stdin); device=next((d for devices in v["devices"].values() for d in devices if d["udid"]==sys.argv[1]),None)
assert device and device["name"].startswith("Thingtime shared draft dismiss QA"), "Refusing a simulator not dedicated to this disposable fixture"
assert device["state"]=="Booted", "Boot the dedicated simulator first"
' "$sim"
xcodegen generate
xcodebuild -project Thingtime.xcodeproj -scheme Thingtime -destination "platform=iOS Simulator,id=$sim" \
  -derivedDataPath "$derived" CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES DEVELOPMENT_TEAM= ONLY_ACTIVE_ARCH=YES build-for-testing
xcrun simctl install "$sim" "$derived/Build/Products/Debug-iphonesimulator/Thingtime.app"
group="$(xcrun simctl get_app_container "$sim" com.thingtime.appletime group.com.thingtime.widgets)"
python3 - "$group" "$derived" <<'PY'
import json, pathlib, plistlib, sys
root=pathlib.Path(sys.argv[1]); assert root.is_dir()
id='11111111-1111-4111-8111-111111111111'
directory=root/'ShareInbox'/'ready'/id
payload=directory/'payload'; payload.mkdir(parents=True,exist_ok=True)
(payload/'text.txt').write_text('Synthetic retained shared draft',encoding='utf-8')
(directory/'receipt').write_text(id,encoding='utf-8')
(directory/'composer.json').write_text(json.dumps({'origin':'https://thingtime.com','textPaths':['text.txt'],'completed':False}),encoding='utf-8')
(directory/'.reminder-dismissed').unlink(missing_ok=True)
products=pathlib.Path(sys.argv[2])/'Build/Products'
source=max(products.glob('Thingtime_iphonesimulator*.xctestrun'),key=lambda p:p.stat().st_mtime)
data=plistlib.loads(source.read_bytes())
data['ThingtimeUITests'].setdefault('EnvironmentVariables',{})['THINGTIME_SHARED_DRAFT_UI_AUTOMATION']='1'
(products/'SharedDraftReminderAcceptance.xctestrun').write_bytes(plistlib.dumps(data))
PY
xcodebuild test-without-building -xctestrun "$derived/Build/Products/SharedDraftReminderAcceptance.xctestrun" \
  -destination "platform=iOS Simulator,id=$sim" -only-testing:ThingtimeUITests/SharedDraftReminderUITests
