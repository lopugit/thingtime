# Device folder sync from a browser

Open **Things → device → Device sync & backup → Manage sync connections**
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
