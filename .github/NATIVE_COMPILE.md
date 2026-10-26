# Protected unsigned native compilation

The default `preflight` mode checks control transport, isolation, and explicitly
requested detached-watchdog cleanup using inert work only. It still requires
an exact current owner PR/head SHA, but never downloads, extracts or executes
candidate source. A green preflight is not native compilation acceptance.

Explicit `native` mode builds the macOS password host/extension and iOS
simulator scheme and tests the local PasswordCore/FileSync packages only after
all gates pass. Neither mode signs, installs, launches apps, uses Apple
credentials, publishes releases, or uploads to TestFlight.

## Current acceptance limit

The reviewed authority-supervision continuation is a partial source repair,
not a usable admitted fallback. Existing immutable H1/H2 pins are unchanged.
The observed authority timeout/remaining-UID cleanup failure still requires
supported launchd service ownership/teardown and usable IPv6 policy proof
before any newly authorized hosted preflight or native execution. See
[the repair note](../PRs/codex-oauth-native-authority-lifecycle.md) and
[the regression checklist](../TESTING.md).

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

Current H1 is `a0d410b29f251ffcc0ec399c085ea501b767379d`. The workflow does not
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

A detached root watchdog starts before account/PF changes with a 180-second
bootstrap deadline and persisted root-owned state. Only successful control and
isolation gates permit `native` mode to extend it to the 45-minute build budget
plus a 60-second cleanup reserve. In `preflight`, trusted code instead requests
watchdog cleanup and waits for its completion marker. This exercises the real
detached cleanup path; it is not a simulated supervisor-loss/cancellation test.

Owned commands get separate process groups and a default 15-second timeout;
each denial subprobe has a 3-second socket / 12-second process bound, separate
started/passed markers, and no aggregate 25-second cliff. Control probes retain
15-second bounds. The total bootstrap cap remains independent of subprobe
budgets and may fail closed before all worst-case subprobes finish. Preflight
has a 10-minute job ceiling; native keeps 65 minutes. A command timeout kills/reaps only
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

After policy activation, identity transitions use a trusted numeric
`setgroups([])` → `setgid` → `setuid` → verified real/effective IDs → exec
path, preserving the registered process group without sudo/PAM monitor
processes. The negative sudo-authority check runs before PF activation.
The detached watchdog redirects stdin to null and stdout/stderr to its
root-owned private work log outside the artifact directory, closing other descriptors so it cannot retain the
runner job capture pipes. Captured-command timeouts still reap the direct child
when an inherited writer prevents pipe EOF. Failed reap diagnostics contain
only PID/PPID/UID/PGID/state/executable metadata; zombies and escaped groups
remain visible and never count as absence. Networking remains denied if any
isolated UID process remains.

Safe phase labels are flushed to stdout
and a durable report. Lost stdout/report storage cannot prevent cleanup.
Watchdog session/descriptor setup is inside an exception fence. A private
5-second readiness pipe and immediate child-exit check must pass before
identity/PF mutations. Each subsequent owned-command admission also detects
watchdog exit and closes further execution. Startup EOF, timeout or death
fails closed, records failure and reaps only that child.
Even when cleanup fails, independent finalization writes an atomic, readable,
root-owned sanitized `watchdog-evidence.json` snapshot. The protected active
log stays outside uploaded artifacts; snapshot failure never claims policy
restoration.

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

Hosted inert run 40363777116 passed both runner HTTPS probes, then its first
isolated aggregate probe timed out and cleanup still saw the isolated UID.
No candidate was acquired or executed. Remaining processes' live/zombie state
and the exact cause were not captured; sudo/session and inherited-pipe hazards
are source findings, not a proven explanation of that run. This repair still
requires independent review and a new hosted preflight artifact before native
mode can be attempted.

## Darwin credential verification and trusted failures

Modern macOS Python `os.getgroups()` is a directory group-access list, not a
readback of cleared kernel credentials. The numeric drop retains
`setgroups([])` → `setgid(target)` → `setuid(target)`, then requires expected
real/effective UID/GID and exactly one kernel group slot containing the intended
GID. Darwin stores the effective primary GID in slot zero; requiring an empty
list was incorrect. No extra/root/admin group is admitted. `setgroups` opts out
of memberd participation; do not substitute `initgroups` or restore directory
memberships.

The accessor uses only the unsuffixed public `getgroups` symbol from fixed
`/usr/lib/libSystem.B.dylib`, with declared `int` / 32-bit `gid_t` ABI. Missing
symbols, errno, invalid system/count limits, changed counts or extra groups fail
closed. It does not invoke a raw syscall or inspect another process/account.
The earlier Python directory-list assertion is removed from the redundant
pre-policy authority probe; canonical numeric-drop verification runs before exec.

Primary source revisions reviewed:

- [CPython 3.9.6 getgroups implementation](https://github.com/python/cpython/blob/db3ff76da19004f266b62e98a81bdfd322861436/Modules/posixmodule.c#L7508-L7549)
  and [Python's macOS contract](https://docs.python.org/3.9/library/os.html#os.getgroups).
- [Apple Libc alias header](https://github.com/apple-oss-distributions/Libc/blob/71bbe350ab79eef58113991d817ccc6165061a64/include/unistd.h#L477-L481)
  and [directory-backed extension](https://github.com/apple-oss-distributions/Libc/blob/71bbe350ab79eef58113991d817ccc6165061a64/sys/getgroups.c#L22-L54).
- [XNU kernel credential groups](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_prot.c#L388-L446),
  [zero-list normalization](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_prot.c#L1354-L1390)
  and [memberd opt-out](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_prot.c#L1434-L1461).

Inert run 40370525585 exited before authority/PF, with restored-state cleanup
and no candidate extraction/execution. Its baseline child stderr was not retained,
so this known source defect is not an observed diagnosis of that hosted exit.
Trusted pre-policy failure evidence now accepts fixed stage/error enums, errno
and exit codes only. It excludes arbitrary stderr/stdout, messages, arguments
and environment values; candidate output is never parsed as trusted diagnostics.
[XNU preserves memberd opt-out across setuid](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_prot.c#L741-L752).
Hosted baseline, isolation and full native acceptance still require actual runs.
