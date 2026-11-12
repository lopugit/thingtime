#!/bin/bash
set -euo pipefail
umask 077
workspace=$1
tmp=$2
out=$3
mkdir -p "$out/site"
socket="$tmp/control.sock"
docker=(/opt/homebrew/bin/docker -H unix:///Users/lopu/.colima/thingtime-agents/docker.sock)
image=$(cat "$tmp/test-image-id")
cli="$workspace/electron/scripts/agent-browser.mjs"
node "$workspace/electron/scripts/test-agent-browser-host.cjs" "$tmp/manager" "$socket" /Users/lopu/.colima/thingtime-agents/docker.sock "$image" 3584 > "$tmp/manager.log" 2>&1 &
manager=$!
claimed=''
session=''
cleanup() {
 if test -n "$claimed"; then node "$cli" release --socket "$socket" --lease-file "$tmp/lease" < /dev/null > "$tmp/release.log" 2>&1 || :; fi
 kill "$manager" 2>/dev/null || :
 wait "$manager" 2>/dev/null || :
 if test -n "$session"; then
  remaining=$("${docker[@]}" ps -aq --filter "label=com.thingtime.agent.session=$session")
  node -e 'console.log(JSON.stringify({sessionId:process.argv[1],remainingOwnedContainers:process.argv[2]?process.argv[2].split("\n"):[]}))' "$session" "$remaining" > "$out/cleanup.json"
 fi
}
trap cleanup EXIT
for i in {1..40}; do test ! -S "$socket" || break; kill -0 "$manager"; sleep 0.25; done
node "$cli" manifest --socket "$socket" < /dev/null > "$tmp/manifest.json"
node -e 'const r=require(process.argv[1]);if(!/^1\./.test(r.features?.["agent.browsers"]||"")||!/^1\./.test(r.features?.["agent.network-policy"]||""))process.exit(1)' "$tmp/manifest.json"
node "$cli" status --socket "$socket" < /dev/null > "$tmp/status.json"
node -e 'console.log(JSON.stringify(require(process.argv[1]).assignments[0]))' "$tmp/manager/assignments.json" | node "$cli" claim --socket "$socket" --lease-file "$tmp/lease" > "$tmp/claim.json"
claimed=1
node "$cli" launch --socket "$socket" --lease-file "$tmp/lease" < /dev/null > "$tmp/launch.json"
session=$(node -p 'require(process.argv[1]).sessionId' "$tmp/launch.json")
container=$("${docker[@]}" ps -q --filter "label=com.thingtime.agent.session=$session")
test -n "$container"
"${docker[@]}" inspect "$container" > "$tmp/inspect.json"
node - "$workspace" "$tmp/inspect.json" "$session" <<'JS' > "$out/boundary.json"
const {verifyContainerBoundary}=require(process.argv[2]+'/electron/lib/agent-browsers/containers.cjs');
const inspect=require(process.argv[3])[0], session=process.argv[4];
verifyContainerBoundary(inspect,session);
const h=inspect.HostConfig;
console.log(JSON.stringify({session,image:inspect.Image,network:h.NetworkMode,mounts:inspect.Mounts,ports:h.PortBindings,readOnly:h.ReadonlyRootfs,user:inspect.Config.User,memoryBytes:h.Memory,cpu:h.NanoCpus}));
JS
printf '%s\n' "$container" > "$tmp/container-id"
printf '%s\n' "$session" > "$tmp/session-id"
"${docker[@]}" exec "$container" sh -c 'mkdir -p /home/pwuser/qa/server /home/pwuser/qa-attachments /tmp/qa-public /tmp/qa-out/site /tmp/qa-out/import'
"${docker[@]}" exec "$container" sh -c 'test -x /usr/local/bin/mongod; test -f /opt/thingtime-mcp/MCP/node_modules/playwright/index.mjs; test -f /opt/thingtime-browser/prepare-native.cjs; test -r /opt/thingtime-browser/browser.json'
tar -C "$workspace/remix/.vercel/output/static" -cf - . | "${docker[@]}" exec -i "$container" tar -xf - -C /tmp/qa-public
"${docker[@]}" exec -i "$container" sh -c 'cat > /home/pwuser/qa/config.json' < "$workspace/remix/.vercel/output/config.json"
tar -C "$workspace/remix/.vercel/output/functions/__server.func" -cf - . | "${docker[@]}" exec -i "$container" tar -xf - -C /home/pwuser/qa/server
"${docker[@]}" exec -i "$container" node - < "$tmp/prepare.cjs" > "$out/native-libraries.json"
"${docker[@]}" exec -i "$container" sh -c 'cat > /tmp/qa-runtime.mjs' < "$tmp/linux-runtime.mjs"
"${docker[@]}" exec -i "$container" sh -c 'cat > /tmp/qa-start.cjs' < "$tmp/linux-start.cjs"
"${docker[@]}" exec -d "$container" sh -c 'node /tmp/qa-start.cjs > /tmp/qa-server.log 2>&1'
if ! "${docker[@]}" exec "$container" node -e 'const fs=require("fs");(async()=>{for(let i=0;i<140;i++){if(fs.existsSync("/tmp/qa-ready.json")){console.log(fs.readFileSync("/tmp/qa-ready.json","utf8"));return}if(fs.existsSync("/tmp/qa-failure"))throw Error(fs.readFileSync("/tmp/qa-failure","utf8"));await new Promise(r=>setTimeout(r,500));}throw Error("QA start timeout")})().catch(e=>{console.error(e.message);process.exitCode=1})' > "$out/health.json"; then
 "${docker[@]}" exec "$container" tail -12 /tmp/qa-server.log; exit 1
fi
chrome=$("${docker[@]}" exec "$container" node -p 'require("/opt/thingtime-browser/browser.json").executable')
"${docker[@]}" exec "$container" "$chrome" --version > "$out/chrome-version.txt"
"${docker[@]}" exec "$container" sha256sum /home/pwuser/qa/server/index.mjs /tmp/qa-public/index.html > "$out/container-build-hashes.txt"
"${docker[@]}" exec -i "$container" sh -c 'cat > /tmp/qa-site.test.mjs' < "$tmp/site.test.mjs"
playwright=/opt/thingtime-mcp/MCP/node_modules/playwright/index.mjs
origin=http://127.0.0.1:18724
printf 'Current compiled app ready in %s\n' "$container"
set +e
"${docker[@]}" exec -e TT_SITE_EDITABLE_ORIGIN="$origin" -e TT_SITE_EDITABLE_SESSION="$session" -e TT_SITE_EDITABLE_ARTIFACTS=/tmp/qa-out/site -e TT_SITE_EDITABLE_TRANSPORT_OUTAGE_FILE=/tmp/qa-offline.flag -e TT_SHARED_PLAYWRIGHT_PATH="$playwright" -e TT_SHARED_CHROME_PATH="$chrome" "$container" node --test /tmp/qa-site.test.mjs | tee "$out/site/test.log"
site_rc=${PIPESTATUS[0]}
set -e
"${docker[@]}" exec "$container" tar -cf - -C /tmp/qa-out/site . | tar -xf - -C "$out/site"
printf '%s\n' "$site_rc" > "$tmp/site-exit"
if test -f "$tmp/import-ready"; then
 mkdir -p "$out/import"
 "${docker[@]}" exec -i "$container" sh -c 'cat > /tmp/qa-import.test.mjs' < "$tmp/import.mjs"
 "${docker[@]}" exec -i "$container" sh -c 'cat > /tmp/qa-export.json' < "$workspace/artifacts/anonymous-release-2026-11-09/render/thingtime-draft.json"
 set +e
 "${docker[@]}" exec -e TT_IMPORT_ORIGIN="$origin" -e TT_IMPORT_SESSION="$session" -e TT_IMPORT_ARTIFACTS=/tmp/qa-out/import -e TT_IMPORT_BUNDLE=/tmp/qa-export.json -e TT_SHARED_PLAYWRIGHT_PATH="$playwright" -e TT_SHARED_CHROME_PATH="$chrome" "$container" node --test /tmp/qa-import.test.mjs | tee "$out/import/test.log"
 import_rc=${PIPESTATUS[0]}
 set -e
 "${docker[@]}" exec "$container" tar -cf - -C /tmp/qa-out/import . | tar -xf - -C "$out/import"
else
 import_rc=0
fi
"${docker[@]}" exec "$container" cat /sys/fs/cgroup/memory.events > "$out/memory-events.txt"
"${docker[@]}" exec "$container" cat /tmp/qa-server.log | rg '^\{' > "$out/server-requests.jsonl" || :
test "$site_rc" = 0 && test "$import_rc" = 0
