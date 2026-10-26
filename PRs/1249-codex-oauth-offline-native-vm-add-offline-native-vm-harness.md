# PR 1249 — Offline native VM host harness

This testing-tooling PR provides private fresh Apple Silicon guest preparation,
read-only restore diagnostics, a separately supervised installer and bounded
first-boot framebuffer viewer. It does not deploy a Thingtime product app or
complete feature-native compilation. The [runbook](../docs/offline-native-vm.md)
describes supported commands, fixed devices, leases and refusal/cleanup rules.

## Source and safe verification

- Dependency-free SwiftPM host harness: 56 safe tests pass, zero failures or
  compiler warnings, independently repeated. Tests exercise private file/identity
  admission, lifecycle callbacks, cancellation/stop deadlines and quarantine.
- Minimal task-cache APPL bundle packaging: eight inert Python fixture tests
  independently pass. No binary execution, app signing, registration or launch
  occurs in this suite. Previously reviewed Swift source remained unchanged.
- Independent reviews cover metadata locking, FIFO/alias refusal, installer
  cancellation contract, final-installed identity admission, checkpoint fencing,
  viewer input/device readback and packaging. Whitespace/plist checks pass.

## Root-observed real milestones (2026-10-27)

These are actual local operations performed by the coordinating agent, separate
from the safe source tests. Local receipts and independent audits retain their
exact task pairing, binary digests and process outcomes without committing
private machine identity/disk content.

- Signed entitled local restore metadata inspection passed for Tahoe 26.6.2,
  build 25G83; this is current VZ metadata acceptance, not just ZIP metadata.
- Fresh preparation validated the fixed configuration and created a new original
  hardware/machine-ID/auxiliary/boot/output pair without booting a guest.
- Bounded installation succeeded in 366.95 seconds: installer callback succeeded,
  stopped VM observed, worker exited normally with exit 0 and was reaped, without hard kill
  or quarantine. Installation does not establish Setup Assistant or readiness.
- Signed CLI viewer observed running/start callback, then root cancelled the exact
  parent. It stopped/reaped normally with exit 0 without hard kill/quarantine; paired file
  identities remained unchanged. This proves boot and that cancellation path.
- A task-specific signed APPL bundle passed strict signing/layout checks. Exact
  bundle CUA binding showed its task title, host Stop control and guest Apple
  startup framebuffer, despite generic app inventory omission. Ordinary click/text
  entry progressed through language/region, new-device/offline setup and the
  privacy notice to Create a Mac Account. Modifier/case combinations were not
  reliable (Cmd+A did not select all); triple-click/Backspace corrected the field.
  No password, account creation or legal terms were submitted. The host Stop and
  checkpoint button stopped the session normally with exit 0, worker reap,
  reason=requested and no hard kill/quarantine; readiness remained false. A CUA
  read after window exit timed out, which does not override the actual exit and
  stopped checkpoint receipts. There is no current task VM running.

The enforced guest configuration has no network, share or socket devices and no
clipboard/serial proxy; only the task's read-only input and owned mutable disks
are attached. Actual installation success makes no claim that host Apple-service
traffic was offline. No guest output is mounted or executed on the host.

## Remaining gates

The original installed pair is preserved under lease; final installed/checkpoint
identities (including Apple auxiliary-size growth) govern reuse. Missing callback,
failed stop, abnormal exit, hard kill or missing checkpoint blocks another start.
A booted guest or visible framebuffer is not credential delivery, legal assent,
Setup Assistant, guest toolchain readiness, output transport or native acceptance.
`run` remains closed with `guestReadinessUnavailable`.

The immutable input remains source dbc617030cb6d95d942eff7764bbbd6421fa5e11.
A separate root-observed comparison found all 193 tracked native source members
unchanged at feature head 9f4c3de0c; that does not rewrite/relabel the manifest or
prove a build. Later admission must bind a verified source-closure comparison.

There is no release, signing-key export, provider-secret use, production rollout
or feature merge in this PR. Preview is N/A for host testing tooling. PR remains
open; native compilation and the OAuth/password feature acceptance remain open.
