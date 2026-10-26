# Protected unsigned native compilation

The default `preflight` mode checks control transport, isolation, and explicitly
requested detached-watchdog cleanup using inert work only. It still requires
an exact current owner PR/head SHA, but never downloads, extracts or executes
candidate source. A green preflight is not native compilation acceptance.

Explicit `native` mode builds the macOS password host/extension and iOS
simulator scheme and tests the local PasswordCore/FileSync packages only after
all gates pass. Neither mode signs, installs, launches apps, uses Apple
credentials, publishes releases, or uploads to TestFlight.

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
      mode:
        required: false
        default: preflight
        type: choice
        options: [preflight, native]
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
      mode: ${{ inputs.mode }}
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

Only protected code executes as the sudo-capable runner or root. Admission
preserves two reviewed commits: H1 contains the trusted helper/tests; H2 pins
the workflow's helper checkout and `CONTROL_SHA` literally to H1. The main
listener pins its reusable implementation to H2. Preserve H1 ancestry through
a normal merge; do not squash away the helper commit or silently rewrite pins.

Current H1 is `4dddacc04ceb1c50762e42654f49ecc9585ec915`. The workflow does not
resolve a mutable helper branch or use caller `github.sha`/`github.workflow_sha`
to select helper code. It checks out H1 with credentials disabled and verifies
HEAD equals H1 before invoking the supervisor. Caller input selects only the
candidate PR/SHA, never a helper ref or path. The artifact's `controllerSha`
identifies **helper H1**, while GitHub's reusable-workflow run provenance and
the listener's immutable reference identify **workflow H2**. These are separate
from the candidate source SHA. A helper update requires a new reviewed helper
commit and a subsequent reviewed literal-pin change.

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

On the dedicated ephemeral hosted macOS VM, trusted root code first verifies
both Runner.Listener and Runner.Worker effective UIDs from PID/UID/executable
metadata. They must match the proposed runner transport UID. The observed
mDNSResponder UID must differ from it. Missing or conflicting identities fail
before policy mutation with a diagnostic report. No process arguments or
credentials are inspected.

The PF root rules allow only that verified runner UID: TCP rules use explicit
`flags any keep state` so a full state flush can synchronize established
control connections; separate UDP rules retain their state contract. Then
unconditional IPv4 and IPv6 rules deny all remaining outbound protocols.
This also denies root/system brokers rather than relying on PF UID matching
for ICMP. PF user association itself covers only TCP/UDP. Existing states are
flushed before any candidate extraction or execution. This is not a proxy
variable, hostname deny list, or compiler sandbox bypass. Compiler child
sandboxes remain enabled.

Before candidate execution, the lane checks PF enabled/loaded rules, fresh UID
and denied sudo authority, direct IPv4/IPv6 TCP, direct UDP/DNS, and a nested
child sandbox under the same UID. Direct denial probes also run as root and
under the observed DNS broker UID using owned probe groups, without changing
or killing the system broker. Two credential-free `api.github.com/meta` HTTPS
probes run as the runner UID five seconds apart while PF remains active;
system DNS, TLS hostname/certificate verification and HTTP 200 are required.
A failed hostname/TLS gate aborts, reaps owned probes/isolated descendants,
restores PF, and retains failure/cleanup evidence before artifact upload.
There is no DNS broker exemption, arbitrary forwarding, endpoint/IP allowlist,
or resolver change. These fixed documented GitHub control-host probes establish
only immediate public control HTTPS. They do not authenticate the runner's
long-poll protocol or establish DNS-cache-expiry continuity. Trusted runner positive controls must reach
the same IPv4 TCP/UDP addresses first. IPv6 positive-control availability is
reported separately; absence of an IPv6 route is not transport-level proof of
IPv6 enforcement. The explicit loaded IPv6 deny rule remains mandatory.
Redirects and alternate DNS names do not grant an exception. A refused PF
operation, failed required control, or child-sandbox failure stops compilation;
there is no permissive fallback.

A detached root watchdog starts before account/PF changes with a 120-second
bootstrap deadline and persisted root-owned state. Only successful control and
isolation gates permit `native` mode to extend it to the 45-minute build budget
plus a 60-second cleanup reserve. In `preflight`, trusted code instead requests
watchdog cleanup and waits for its completion marker. This exercises the real
detached cleanup path; it is not a simulated supervisor-loss/cancellation test.

Owned commands get separate process groups and a default 15-second timeout;
probes have explicit 15–25-second bounds. A command timeout kills/reaps only
its owned group; it never kills the runner UID. Cleanup has a 60-second budget
and 10-second lock-acquisition bound, verifies owned probe groups and isolated
UID descendants are gone, then restores `/etc/pf.conf` and releases its PF enable
token. It removes only the temporary identity/group/source/home/build state.
The final watchdog reap is bounded too. The same cleanup lock serializes native
deadline promotion, cleanup claiming and command admission. A root-owned
cleanup-start marker prevents any later launch. Each trusted command launcher
waits on a private pipe until its process group is durably registered; parent
loss before release produces EOF and no command execution. The watchdog
rechecks the latest deadline under the lock, preventing a stale bootstrap
cleanup decision from racing native promotion.

Safe phase labels are flushed to stdout
and a durable report. Lost stdout/report storage cannot prevent cleanup.
No deadline or static test proves that a watchdog survived an actual VM loss.
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
