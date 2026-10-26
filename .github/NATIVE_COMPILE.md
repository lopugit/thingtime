# Protected unsigned native compilation

This compile-only lane builds the macOS password host/extension and iOS
simulator scheme, then retains logs and isolation evidence. It tests the local
PasswordCore and FileSync packages. It never signs, installs, launches apps,
uses Apple credentials, publishes releases, or uploads to TestFlight. It is
separate from signed installation and real-device acceptance.

## Admission and entry point

Review the controller workflow, Python supervisor, archive extractor, probes,
and tests independently before admitting them to `github-actions`. Do not
execute a controller feature branch as privileged code to test its own trust.
The implementation rejects feature-branch dispatches and all PR events.

GitHub requires default-branch registration for a new manual workflow. Keep
that bootstrap separate from merging the feature being compiled. The small
main listener should be separately reviewed, reference an admitted immutable
controller commit, and do nothing except delegate this manual operation:

```yaml
name: Native compile
on:
  workflow_dispatch:
    inputs:
      source_pr:
        required: true
        type: string
      source_sha:
        required: true
        type: string
permissions:
  contents: read
  pull-requests: read
jobs:
  compile:
    if: >-
      github.repository == 'lopugit/thingtime' &&
      github.event_name == 'workflow_dispatch' &&
      github.ref == 'refs/heads/main' &&
      github.actor == github.repository_owner
    uses: lopugit/thingtime/.github/workflows/native-compile.yml@REVIEWED_CONTROLLER_SHA
    with:
      source_pr: ${{ inputs.source_pr }}
      source_sha: ${{ inputs.source_sha }}
```

The exact listener filename is `.github/workflows/native-compile-listener.yml`.
Replace the placeholder with the actual admitted 40-character controller commit;
do not use the candidate source SHA. No `secrets: inherit` is needed. The root
supervisor also checks the selected origin repository, owner actor, manual
event, hosted-runner marker, and exact listener/ref identity. Direct execution
is accepted only for this implementation on protected `github-actions`.

After admission and listener registration, dispatch with an explicit PR number
and its observed current immutable head SHA. For example, PR 1240 originally
had head `6b672f9e24f1971913aa3163957eb2157cc49066`; fetch its current head before
using it. The live API gate requires an open, same-repository owner PR and an
exact head match. There is no merge, signing, installation or release operation
in this workflow.

## Trust boundary

Only protected code executes as the sudo-capable runner or root. The reusable
workflow resolves the current `github-actions` SHA through GitHub's API, checks
out that exact admitted controller revision with credentials disabled, and
verifies its HEAD before invoking the trusted supervisor. Caller input can
select only the candidate PR/SHA, never a controller/helper ref or path. The
listener's reusable implementation is pinned separately. The artifact records
the selected helper/controller SHA independently of the candidate SHA.

The candidate tarball is downloaded by its immutable GitHub commit URL as
opaque bytes. The runner/root never checks out, imports, tests, or executes its
files. Root merely copies the archive and hashes its bytes. After enforcement,
a trusted extractor running as the isolated UID selects only `apple/`, `iOS/`
and `macos/ThingtimePasswords/`; it rejects traversal, links, special files and
duplicates. Native entry points are checked there. Candidate `.github` helpers
and top-level scripts are ignored, and candidate `sitecustomize.py`/module
names cannot enter trusted Python's `-I -S` import context. PR-owned XcodeGen
specs, package manifests and tests first execute as that unprivileged UID.

Each run uses a fresh locked identity, a separate primary group, empty home,
private source/build directories, closed inherited descriptors, null stdin,
and an allowlisted environment. The runner home is made private on that job
VM. No `.env`, personal profiles, account credentials or signing assets are
copied. Only local Swift packages are required; XcodeGen acquisition precedes
the network boundary.

## Enforced network policy and cleanup

On the dedicated ephemeral hosted macOS VM, trusted root code replaces the PF
root rules: runner-UID TCP/UDP transport remains available for control, then
unconditional IPv4 and IPv6 rules deny all remaining outbound protocols.
This also denies root/system brokers rather than relying on PF UID matching
for ICMP. PF user association itself covers only TCP/UDP. Existing states are
flushed before any candidate extraction or execution. This is not a proxy
variable, hostname deny list, or compiler sandbox bypass. Compiler child
sandboxes remain enabled.

Before candidate execution, the lane checks PF enabled/loaded rules, fresh UID
and denied sudo authority, direct IPv4/IPv6 TCP, direct UDP/DNS, and a nested
child sandbox under the same UID. Trusted runner positive controls must reach
the same IPv4 TCP/UDP addresses first. IPv6 positive-control availability is
reported separately; absence of an IPv6 route is not transport-level proof of
IPv6 enforcement. The explicit loaded IPv6 deny rule remains mandatory.
Redirects and alternate DNS names do not grant an exception. A refused PF
operation, failed required control, or child-sandbox failure stops compilation;
there is no permissive fallback.

A detached root watchdog starts before account/PF changes. It uses persisted,
root-owned state and a cleanup lock. On completion, interruption, supervisor
loss or deadline, cleanup kills and checks all build-UID descendants before
restoring `/etc/pf.conf` and releasing the owned PF enable token. It removes
only that run's temporary identity, group and source/home/build directories.
The GitHub job VM is disposable. Never run privileged helper operations on a
developer Mac or a self-hosted runner.

## Validation and acceptance

Safe local checks:

```sh
/usr/bin/python3 -I -S .github/scripts/native-compile-ci.test.py
actionlint .github/workflows/native-compile.yml
```

The adversarial archive fixture poisons candidate helper/module names and
verifies they remain inert. Other tests cover wrong/self-hosted caller guards,
exact source admission, traversal/link/duplicate refusal, protocol/address-family
rules, cleanup ordering, and refusal to restore networking while descendants
remain. These checks never load PF, create accounts or dispatch jobs locally.

The first hosted run must still establish PF permissions, effective network and
subprocess enforcement, watchdog/cancellation behavior, and successful full
Xcode builds. Probes do not establish absence of every potential operating
system broker route. Keep any failed or unavailable case explicit, and do not
treat static tests as hosted acceptance. Download `native-compile-evidence` for
source/controller SHAs, archive digest, loaded rules, positive and negative
controls, unsigned result, and compiler log. A green unsigned run leaves the
signed Keychain/AutoFill/passkey/device/UI gates outstanding.

References: [GitHub hosted VM/privilege documentation](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
[manual workflow registration](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow),
[reusable workflow caller context](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations),
[macOS 15 Arm64 Xcode inventory](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-arm64-Readme.md),
and installed macOS `pf.conf(5)` / `pfctl(8)` manuals.
