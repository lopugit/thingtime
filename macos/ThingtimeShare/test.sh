#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTPUT="${THINGTIME_SHARE_TEST_OUTPUT:-$(mktemp -d "${TMPDIR:-/tmp}/thingtime-share-tests.XXXXXX")}"
mkdir -p "$OUTPUT"
if [[ -z "${THINGTIME_SHARE_TEST_OUTPUT:-}" ]]; then trap 'rm -rf "$OUTPUT"' EXIT; fi
SDK="$(xcrun --sdk macosx --show-sdk-path)"
SHARED=("$ROOT/iOS/ShareSupport/ShareInbox.swift" "$ROOT/iOS/ShareSupport/ShareComposerSession.swift")
xcrun swiftc -swift-version 5 -parse-as-library -sdk "$SDK" "${SHARED[@]}" "$ROOT/macos/ThingtimeShare/MacShareItemImporter.swift" "$ROOT/macos/ThingtimeShare/NativeShareTests.swift" -o "$OUTPUT/NativeShareTests"
xcrun swiftc -swift-version 5 -D THINGTIME_SHARE_TESTING -parse-as-library -sdk "$SDK" "${SHARED[@]}" "$ROOT/macos/ThingtimeShare/ShareBridgeMain.swift" -o "$OUTPUT/ThingtimeShareBridge-test"
"$OUTPUT/NativeShareTests"
python3 - "$OUTPUT" <<'PY'
import json, pathlib, subprocess, sys, tempfile
out = pathlib.Path(sys.argv[1])
with tempfile.TemporaryDirectory(prefix='thingtime-share-stdio-') as root:
    request = subprocess.check_output([out/'NativeShareTests','--fixture-root',root],text=True).strip()
    p = subprocess.Popen([out/'ThingtimeShareBridge-test','--group','group.test','--request',request,'--origin','https://renderer.example','--endpoint','https://api.example','--test-root',root],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    def call(method, **fields):
        body = dict(method=method,requestId=request,accountId='test-owner'); body.update(fields)
        p.stdin.write(json.dumps(body)+'\n'); p.stdin.flush()
        return json.loads(p.stdout.readline())
    assert call('manifest')['result']['maxChunkBytes'] == 262144
    incoming = call('getIncomingShare')['result']
    file = incoming['attachments'][0]['id']
    assert call('read',fileId=file,offset=0,length=True)['ok'] is False
    assert call('read',fileId=file,offset=0,length=5)['result']['base64'] == 'AAECA/8='
    assert call('getIncomingShare',requestId='not-a-uuid')['ok'] is False
    assert call('complete')['ok'] is False
    p.stdin.close(); assert p.wait(timeout=5) == 0
print('Native stdio protocol tests passed')
PY
