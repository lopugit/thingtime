# Device folder sync from a browser

Open **Things → device → File sync & backup → Open device sync & backup →
Manage sync connections**
while signed into the account that owns the device. The management entry no
longer depends on a local Electron bridge or pairing on the viewing computer.
The installed app continues to use its direct local controls for its own device.

Saved private connections use the existing `file-sync` Things, configuration
editor, revision checks, cloud-folder authorization, exclusions and resource
controls. Existing folder bindings can be edited while the device is offline.
Adding or changing a device folder requires a current response from that device;
account metadata alone never grants filesystem access.

The browser sends high-level management requests through
`/api/v1/devices/sync-control` (`api.devices-sync-control` 1.1.0). The installed
app claims requests for its verified local pairing and runs the existing native
sync runtime. Transfers, grants, automatic jobs, inventories, priorities and
conflict journals remain on the device. File contents do not pass through this
control channel. Closing the browser does not stop a job started on the device.

Folder pickers and operating-system permission dialogs appear on the target
device. The device must be awake, connected, signed into the same account and
running an updated app to answer live controls. Offline status is not reported as
an empty folder list or successful execution. Saved settings and already synced
cloud files remain available independently of the live connection.

## Authorization and request lifecycle

The API requires the current full user and Home data plane, checks the owned
paired device on every operation, and returns private/no-store responses. A
protected control Thing carries each short-lived request; ordinary Thing APIs
cannot create or alter these records. Claims are atomic and completion requires
the matching lease. A claimed request is never automatically executed a second
time after a crash or uncertain response. Clients keep the original request ID
when checking an uncertain outcome.

The worker verifies native account/device/server identity before claiming and
executing work. Starting a job rereads the private saved connection and verifies
its revision. Account, server and storage changes cancel stale views and workers.
Conflict decisions and upload priorities retain their existing revision guards.
Native download approvals, recoverable Trash and source policy checks continue
to apply.

## Code and checks

- `remix/app/components/Devices/DeviceSyncBrowser.tsx` selects direct local or
  remote management from the same owned-device entry point.
- `RemoteDeviceSync.tsx` uses the existing configuration editor and editable
  settings blocks for remote management.
- `remix/app/fileSync/remoteSyncProtocol.ts`, `remoteSyncClient.client.ts` and
  `remoteSyncWorker.client.ts` define the control contract and its two ends.
- `remix/app/api/utils/devices/deviceSyncControl.ts` and the registered route
  own authorization, leases and short-lived persistence.

Run the device, file-sync and API-capability suites, then
`node remix/scripts/test-remote-device-sync-ui.mjs` for isolated browser checks
without an Electron bridge. The fixture uses synthetic account/device responses;
it does not prove installed macOS permissions or live cross-device transport.
The corresponding installed-app checklist is in `TESTING.md`.

For the compiled API and actual Mongo transaction checks, install `mongod` and
run these commands from the repository root:

```sh
NITRO_PRESET=node_middleware npm --prefix remix run build:server
npm --prefix remix run test:device-sync:control -- .output/server/index.mjs "$(command -v mongod)"
```

The second argument may instead be an explicit path to the `mongod` executable.
The launcher requires the compiled `node_middleware` entry and runs it with plain
Node. It verifies that the endpoint, docs and both capability manifests return
Nitro JSON, then creates two synthetic accounts and a signed device pairing
through the canonical HTTP APIs. Checks cover concurrent claims, transactionally
serialized queue backpressure, ownership, leases, immutable retries, generic
protected-kind write rejection, result readback and device revocation.

`scripts/test-device-sync-control.mjs` owns a fresh mode-0700 temporary directory
and starts `mongod` with `--bind_ip 127.0.0.1 --port 28179 --replSet
sync-control-fixture --wiredTigerCacheSizeGB 0.25 --nounixsocket`. Its `--dbpath`
and `--logpath` point inside that new directory. The compiled server listens on
`127.0.0.1:28180`; both ports must be unused. The launcher bootstraps its own
single-node replica, passes only `PATH` and fresh fixture environment values to
child processes, uses a temporary home directory and synthetic signing secret,
and sends fixture email through the console provider. It terminates both child
processes and removes their database files on completion. These controls isolate
fixture credentials and storage; they do not install an OS network sandbox.


### Private source-location metadata

Ordinary control continues to require 1.0.0. Clients separately negotiate the
optional 1.1.0 source-location contract; older origins keep ordinary controls and
explicit destination selection. Contract 1.1.0 preserves optional `roots[].sourcePath` through status pages and
folder-management results. An updated Mac native adapter (fileAccessVersion
1.15.0) supplies the absolute POSIX location of its exact current owner-scoped
bookmark; it omits stale/unavailable grants and Photos. The existing encrypted
control payload and owner/device/current-pairing/lease fences protect this
metadata. It does not enter public manifests or grant parent-directory access.
Clients must keep it separate from executable root-relative file paths. Missing
metadata leaves an explicit cloud destination choice available; existing saved
connection destinations are never automatically moved or retargeted.

### Device-wide resource status and policy

Control contract `api.devices-sync-control` 1.2.0 adds rootless
`{ action: "resources", operation: "read" }` and
`{ action: "resources", operation: "save", deviceResourceLimits }` commands.
Policy contains positive `transferBytesPerSecond` and `scanBytesPerSecond`,
plus integer `cpuPercent` from 1 to 100. The selected Mac requires
`fileAccessVersion` 1.16.0 and `fileResourceLimitsVersion` 1.1.0. These commands
work while connections are paused, require current owner/device authorization,
and neither grant filesystem roots nor start transfers. Saves retain one
immutable request identity across uncertain replies.

The existing status heartbeat supplies optional `resourceUsage` with the
selected device's policy and current measurements. The overview and connection
manager share one coalesced, paged session qualified by account, origin, device
and identity generation. It stops while hidden or unused and discards old
identity measurements. Missing CPU, memory or throughput measurements stay
unavailable; a viewing browser's preferences are never saved as remote policy.
Older origins retain ordinary 1.0.0 controls and optional 1.1.0 source paths.

Control 1.3.0 additionally carries optional per-job directional progress through
the same status heartbeat. Resource read/save retains its 1.2.0 minimum; source
paths retain 1.1.0 and ordinary controls retain 1.0.0. Clients negotiate the
optional progress contract before projecting it, without another poller.

## Sync resource history

The app-owned native sync runner records observations during admitted runs, even
when no dashboard is open. History is retained in the source app's IndexedDB
journal across restarts, scoped by selected API origin, owner, paired device and
data plane. Removing that app's local storage removes its local history. History
begins with the updated collector; earlier measurements cannot be reconstructed.
A remote browser reads the source through the existing paired control mailbox
and requires `api.devices-sync-control` 1.4.0. The source must be connected for a
fresh remote read. This does not start, resume or change a sync connection.

Live readings retain their observation time. A paused or completed job cannot
present its last nonzero rate as live. Historical buckets show means of measured
samples, not time-weighted utilization or total transferred bytes. Per-metric
sample counts distinguish partial coverage; empty intervals and unavailable CPU,
scan or indexer memory stay unknown. CPU scopes identify the measured sync work;
these figures are not whole-device CPU or memory. Collection uses a five-second
cadence, suspends across gaps, and never interpolates unobserved activity. Range
reads process every matching record in bounded batches; chart resolution does
not discard retained history or impose a maximum user-selected time window.

Electron resource collector `fileResourceLimitsVersion` 1.1.1 merges the active
transport governor into read-only resource responses after verifying the selected
origin, owner and device. These reads never create or alter a resource policy.
Transport readings expire after two seconds and clear when their worker exits;
older 1.1.0 collectors remain compatible but may provide partial measurements.


## Healthy startup timing

Use `node remix/scripts/test-mac-paged-sync.mjs --wide --wide-mixed --wide-count=8 --canonical-worker --streaming-two-way --healthy`
for the small isolated 40-path/26-file diagnostic. Omit `--healthy` for
accepted-stage/commit/publication loss and restart coverage; neither lane replaces
the other. Use the same cardinality for before/after comparisons and retain
`THINGTIME_MAC_PAGED_EVIDENCE_PATH` source certificates. First confirmation,
first HTTP upload byte, strict reconciliation and unchanged-run timings are
separate observations. Resource policy remains 5,000,000 B/s (5 MB/s), CPU 15%.

Guarded early planning rejects an unusable journal ancestor before requesting
connection policy or opening protected point reads. This only defers the hint;
it supplies no authority, observation or receipt. Surviving hints still check
current saved connection policy before reading either replica, and all actual
native effects keep fresh identity verification. Strict reconciliation remains
responsible for deferred entries and completion.
