# Offline native VM harness (preparation and installer milestones)

`apple/OfflineNativeVM` is a dependency-free SwiftPM host CLI for a task-owned
Apple Silicon macOS VM. Its machine-readable contract is `offline-native-vm
manifest`, feature `native.offline-vm` version `1.0.0`. This is testing tooling,
not a Thingtime app update, installer, release workflow or network API.

The host harness compiles and tests private file handling, fresh preparation,
read-only restore inspection and a distinct bounded installer lifecycle with
mocks. **Real preparation/installation/teardown acceptance is still pending.**
Setup Assistant, guest toolchain verification and candidate run admission remain
unimplemented. `run` and its internal runtime worker fail with
`guestReadinessUnavailable`; no imported VM or caller readiness assertion can
admit candidate execution. Do not claim a native build or VM disposal from the
mock tests or successful read-only Apple restore metadata inspection.

## Threat model and fixed boundary

Trust the authorized host user/root and reviewed host executable. Treat source,
guest code, guest disks and results as untrusted. Host/root tampering is outside
this boundary. The harness never imports an existing VM or adopts a user's
machine identity, disks, accounts or auxiliary storage.

Construction always sets `networkDevices`, `directorySharingDevices`,
`socketDevices`, serial ports, audio, consoles, keyboards and pointing devices
to empty arrays. There is no NIC enable flag, NAT, bridging, socket proxy,
clipboard integration, shared directory or guest-to-host execution path. The
headless virtual display does not expose a host window or clipboard. Only three
block devices are configured: fresh writable boot/output files and a task input
attachment with `readOnly: true`. Configuration is read back and `validate()`
is required before constructing a VM. Readback is configuration evidence;
actual launch/network/teardown evidence remains a separate acceptance gate.

Apple's `VZDiskImageStorageDeviceAttachment` supports **RAW block images only**,
with file sizes divisible by 512. An ISO9660 raw image is acceptable input bytes;
a UDIF `.dmg` container is not this contract. The suffix does not determine
format. The host never mounts the guest output, parses it as a receipt, executes
it, or automatically removes it. A guest cannot write the host-only receipt
files through a share or serial channel because none exists.

## Safe build and tests

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test \
  --package-path apple/OfflineNativeVM \
  --scratch-path /private/tmp/offline-native-vm-build
/private/tmp/offline-native-vm-build/debug/offline-native-vm manifest
```

No external packages, personal credentials, signing identity, installation or VM
boot are needed for compilation/mocked tests. Actual Apple metadata/configuration
operations require the virtualization entitlement; the repo provides
`Virtualization.entitlements` for a separately authorized task-executable signing
step. Compilation alone does not establish entitlement/service availability.
Fixed `VZErrorDomain`/integer-code diagnostics are retained on platform refusal;
never disable protections or substitute a prior compatibility receipt. Tests exclusively create private UUID fixture roots and sparse
files, then remove those exact fixtures. Mock process tests never enumerate or
signal host users, process names or arbitrary PIDs. The build uses the normal
SwiftPM sandbox; no sandbox disabling option is required.

## Read-only restore diagnostic

`inspect-restore /absolute/path/to/restore.ipsw` inspects authorized existing
local Apple restore media without copying it or creating a task/disk/VM. It
rejects non-regular files before open, holds a read-only nonblocking/non-following
descriptor, requires a current-user-owned
regular file with no hardlink aliases, and checks file identity/size/timestamps
after the metadata callback. Public restore-media modes may be readable by
others; this command does not adopt their parent as a private task root.

The same Apple local metadata adapter has a 30-second callback deadline with a
locked one-shot handoff; late callbacks after cancellation are ignored. A
refusal emits only fixed error labels and at most four underlying fixed Apple
error domains/numeric codes; arbitrary descriptions, userInfo, paths and output
are omitted. Success reports observed OS/build and supported hardware metadata,
not installation, Setup Assistant, licensing, VM boot or network acceptance.
Actual use still needs the separately reviewed entitled executable. This command
never fetches restore images, installs, prepares mutable disks or starts a VM.

## Task preparation contract

`init PARENT TASK_UUID` exclusively creates a mode-0700 task directory beneath
an existing private, current-user-owned parent. Every directory component must
be a real directory, not a symlink. On macOS use canonical `/private/tmp/...`
rather than the `/tmp` symlink. `owner.json` binds the task ID, UID and directory
inode/device. Inputs, lease, receipts and mutable images remain beneath it.

Place only the authorized local Apple restore image, host-generated raw source
input and `guest.json` under `TASK/inputs`, each privately owned with no hardlink
aliases. Preserve sparse/raw format; do not copy `.env`, profiles, credentials,
Keychain files, signing keys or personal guest data. The manifest is exact-key
JSON (unknown fields fail); toolchain labels describe prerequisites, not an
assertion that they have been installed:

```json
{
  "contractVersion": "1.0.0",
  "taskID": "00000000-0000-4000-8000-000000000001",
  "sourceSHA": "0000000000000000000000000000000000000000",
  "guestOS": "26.6.2",
  "architecture": "arm64",
  "toolchain": {
    "xcode": "<reviewed version>", "macOSSDK": "<reviewed SDK>",
    "simulatorSDK": "<reviewed SDK>", "xcodegen": "<reviewed version>",
    "offlineDependenciesSHA256": "<64 lowercase hex digits>"
  },
  "restoreImage": {"file": "restore.ipsw", "format": "ipsw", "sha256": "<64 lowercase hex digits>"},
  "input": {"file": "source.img", "format": "raw", "sha256": "<64 lowercase hex digits>"},
  "bootGiB": 100, "outputGiB": 8, "cpuCount": 4, "memoryGiB": 8,
  "deadlineSeconds": 3600
}
```

`validate TASK` and `plan TASK` inspect ownership, required fields, hashes and
input block alignment without allocating a VM, installing a guest or preparing
disks. They explicitly report `configurationValidated: false`,
`preparationAdmitted: false` and `guestAcceptance: false`.

`prepare TASK` is a separate mutating operation, not dry-run. It takes an
exclusive host lease, atomically consumes the task and creates a unique run
root. Through the local-file Apple restore metadata API it selects a supported
hardware model and requires the observed OS version to match `guestOS`. It
creates a **fresh** `VZMacMachineIdentifier`, empty boot/output RAW images with
exclusive creation and `ftruncate`, and new auxiliary storage paired with that
hardware model. It records original file identities and hardware/identifier
hashes in host-only `preparation.json`, state `prepared-empty`. It validates and
reads back the no-NIC configuration, recording `configuration-readback.json`.
Apple framework metadata is not an assertion that guest installation/signature
verification, Setup Assistant, account creation or Xcode licensing completed.
No VM or installer starts during preparation. Interrupted/failed preparation
leaves the consumed marker and artifacts intact; do not recycle that task or
fabricate a success receipt.

File opens use `O_NOFOLLOW`, private ownership/modes, regular-file and nlink-one
checks. Hashing/copying retains the same descriptor and checks inode, size,
mtime/ctime and named-path identity before/after. Authorized host mutation is
out of scope. No arbitrary library, command, network or existing-VM path can be
selected through the manifest.

## Separate installation phase

`install TASK RUN_UUID` accepts only the harness's own `prepared-empty` receipt,
matching task/source/manifest, original hardware and machine-ID hashes, and
recorded private boot/output/auxiliary file identities. It acquires the exclusive
task lease and creates `install-attempt.json` with exclusive creation **before**
starting a worker. The immutable attempt starts in `pending-quarantined` state;
if its parent dies or never writes finalization, the artifacts remain quarantined
and a second installation attempt is refused even after the lease releases.
No existing VM is imported and no new identity replaces the prepared pair.

The installer is a separate VM-queue state machine. It starts only from stopped,
retains `VZMacOSInstaller`, and never calls pause/stop during active installation.
On deadline/cancellation/parent loss it calls `installer.progress.cancel()` only
after `install` has begun, then allows at most 60 seconds for the installer
completion callback. No callback means unknown teardown and quarantine; a
stopped-looking VM alone cannot stand in for the installer callback. After that
callback it separately allows 15 seconds for supported VM stop/observation.
Failed stop, cancellation or failed installation never establishes success.

The independent parent uses `deadlineSeconds`, requests termination (handled as
installer cancellation), then allows 90 seconds for cancellation/stop/final
receipt exit, followed by exact-worker SIGKILL and five seconds for reap if
necessary. This is intentionally separate from the runtime stop grace. A hard
kill, missing callback, missing stopped observation, unreadable receipt or failed
reap cannot be successful disposal. The one-shot attempt persists; no automatic
retry or reuse occurs. Parent/worker crash cannot be presented as proof of
platform resource destruction. Unknown artifacts must stay quarantined pending
supported recovery; never broad-kill host users/services to manufacture proof.

Only a successful installer callback, observed stopped VM, exact worker reap,
no cancellation/hard kill/failure and final private file identities can yield
`installation.json` with `installed: true`, `quarantined: false`, state
`installed-not-ready`. That host finalization supersedes the attempt's initial
pending state. Setup/toolchain/readiness remain false, and candidate execution
stays closed. No guest filesystem is mounted or output executed on the host.

The local IPSW API does not promise that installation needs no Apple-service
personalization. Keep the guest without a NIC and let an explicitly authorized
bounded real installer result establish feasibility; metadata support and third
party image labels do not establish installation success. Actual installation
also does not complete Setup Assistant, establish a guest account or accept any
license on the user's behalf.

## Lifecycle scaffold and remaining admission

The dormant execution scaffold separates the parent deadline from the VZ
worker: empty credential-free environment, task HOME/TMPDIR, closed standard
input/output/error and host-only JSON receipts. Parent deadline/cancellation
requests worker termination; the worker requests destructive `VZ.stop` and
observes `.stopped`. After 15 seconds the parent requests SIGKILL of its exact
owned worker and allows five seconds for reaping. Hard kill or missing VZ stop
observation always means `teardownUnknown`, never successful disposal. Parent
loss and an independent worker deadline also request VZ stop. No broad UID kill,
launchd domain operation, host firewall change or external broker is involved.
These timings are code/mocked evidence, not a measured real VM stop guarantee.

Before enabling a candidate run, complete real installer acceptance and implement
and independently review readiness transitions accepting only this harness's own fresh preparation under
its lease, preserving original boot/auxiliary/model/identifier pairing. Hold
that lease through confirmed VZ stop and worker reap; never reuse a consumed
identity concurrently. Exercise the installer cancellation gates and add guest setup/toolchain gates,
retain actual stop/cancellation receipts, and verify the no-NIC configuration
on a real task-owned guest before native candidate execution. Guest output is
still untrusted, even when a build reports success.

The cached restore image, host Xcode license state, a compatible SDK or a ready
source archive are separate prerequisites; none proves installed guest readiness.
No new download, license acceptance, guest install/start or native build is
implied by this document.

## Primary platform contracts

- [Apple: disk-image attachment](https://developer.apple.com/documentation/virtualization/vzdiskimagestoragedeviceattachment): RAW local block images and read-only attachment.
- [Apple: Mac platform configuration](https://developer.apple.com/documentation/virtualization/vzmacplatformconfiguration): preserve original saved-VM model, auxiliary storage and machine identifier; independent concurrent VMs require distinct identities/storage.
- [Apple: local restore metadata](https://developer.apple.com/documentation/virtualization/vzmacosrestoreimage): local image support and hardware requirements; the harness never calls the network fetch method.
- [Apple: installing macOS](https://developer.apple.com/documentation/virtualization/installing-macos-on-a-virtual-machine): stopped initial VM, no stop/pause during installation, and installer progress cancellation.
- [Apple: virtual machine stop](https://developer.apple.com/documentation/virtualization/vzvirtualmachine/stop(completionhandler:)): destructive forced stop and completion result.
- [Apple: network devices](https://developer.apple.com/documentation/virtualization/vzvirtualmachineconfiguration/networkdevices): an empty device array exposes no virtual network device.

SDK header evidence was checked against installed stable Xcode 26.6, macOS SDK
26.5, on 2026-10-27. Real guest provisioning and platform behavior remain to be
verified separately. This CLI exposes no web surface; no preview/server is
created.
