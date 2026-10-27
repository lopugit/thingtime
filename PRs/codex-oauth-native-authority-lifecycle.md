# Bound native negative-authority supervision

The hosted inert run 40377327335 timed out in the negative-authority phase
with no candidate execution and no complete cleanup/restoration proof. The
active helper ran sudo inside an unprivileged Python subprocess timeout. Its
actual hosted OS/PAM cause remains unproven.

This focused repair keeps the negative test and all isolation/admission gates.
The trusted root supervisor directly owns the fixed numeric-drop command,
registered process group, five-second command deadline and bounded kill/reap.
All standard descriptors use null devices, so arbitrary output and inherited
pipe EOF cannot become evidence. Normal refusal 1 is accepted only after the
launcher; trusted drop/exec failures use distinct exit 111. No workflow, helper
pin, listener, firewall or cleanup policy changes are included.

Root and Kestrel reviewed the frozen source. All 48 safe tests passed, including
five new regressions covering fixed command/descriptors, exit/signal/timeout
classification, launcher-failure separation and exact owned fixture reap. No
privilege, actual sudo, Keychain, candidate or hosted operation ran locally.

The repair is intentionally partial and inactive under existing immutable
helper pins. Supported exclusive launchd user-domain/service ownership and
teardown/no-respawn proof remain unresolved; process absence does not prove a
dormant service cannot restart. IPv6 still needs a usable task-owned positive
fixture and policy traversal/counter proof. Do not remove those gates, broadly
kill user services, relax network denial or dispatch this feature branch. A
separate reviewed H1/H2 admission must follow any complete future repair.

## Refuse false network-denial evidence

A synthetic source audit reproduced an unavailable IPv6 baseline followed by
a successful denial result for the same `ENETUNREACH` failure. The baseline
now requires usable IPv4 and IPv6 TCP plus UDP/DNS controls before policy
activation; the supervisor revalidates the saved evidence before declaring
the isolation gates passed. Missing, malformed, false and duplicate-family
records fail closed. IPv6 baseline failures retain only the fixed
`baseline-tcp6` stage/error/errno diagnostic.

Direct socket denial and negative hostname probes now accept timeout-class
failures only. Route, refused connection, permission and other socket failures
cannot become successful denial evidence. A timeout by itself does not prove
PF traversal or counter attribution; those requirements remain open alongside
exclusive launchd ownership and teardown/no-respawn proof.

49 selected safe tests passed, including four new network-evidence regressions.
The audit guarded live `kill`, `killpg` and `fork` operations and excluded the
three existing live-process fixtures that need them. No real network, sudo,
account mutation, PF, candidate, credential, hosted or native operation ran.
Admission, pins and workflows are unchanged; this remains a partial inactive
source correction, with no hosted or native acceptance claimed.

See [the regression checklist](../.github/TESTING.md) and
[the native control-plane contract](../.github/NATIVE_COMPILE.md).

## Explicit unavailable task-lifecycle admission

The next audit found no executable backend that establishes exclusive launchd
bootstrap/service ownership. Numeric setuid, process-group reap and UID process
absence cannot supply that authority or exclude dormant service respawn. The
source now refuses both modes after read-only runner admission and before UID
allocation, watchdog/account/PF mutation or candidate access. Fixed diagnostics
identify the unsupported backend and do not claim cleanup or isolation passed.
Caller environment or existing receipt files cannot enable it.

Two new deterministic regressions cover both modes, no-receipt/no-environment
bypass and actual supervisor ordering with every downstream operation mocked.
No privileged, real-process, network, candidate or hosted execution is required.
The runbook records the exact next namespace/lifecycle implementation and
KeepAlive/escaped-child/parent-loss/cancellation/teardown/no-respawn acceptance
gate. This is an inactive source safety stop, not a delivered launchd backend;
existing admission and helper/workflow pins remain unchanged.

## Bounded inert hosted platform experiment

A separate helper and PR-only experiment workflow test the actual hosted
`user/<fresh UID>` bootstrap lifecycle with fixed inert fixtures. Normal and
simulated parent-loss cases check task credentials/bootstrap placement,
cross-UID admission refusal, KeepAlive respawn, escaped descendants and exact
owned cleanup with sixty seconds of no-respawn observation. Unknown platform
statuses or ownership/cleanup failures quarantine the disposable guest. The
runner, system, GUI and login domains are never teardown targets.

The workflow uses only read-only contents/PR permissions, pins an independently
reviewed helper commit and digest, binds the owner-applied label to the current
PR head, and compares reviewed/actually-executed workflow bytes. There is no
candidate checkout, PF operation, secret context or native build. Helper and
workflow commits are reviewed separately; the owner label/run remain withheld
until final exact-source review. Existing native H1/H2 pins are unchanged.

The safe local checker covers workflow/Python syntax and fourteen deterministic label, report, allocation, cleanup
and timeout cases. It executes no host command, real signal, account operation
or hosted job. See [the full experiment spec](../.github/NATIVE_LIFECYCLE_EXPERIMENT.md).
Actual hosted observations, candidate network denial, unsigned compilation and
signed provider/device acceptance remain separate unfinished gates.

## Hosted initialization and report-access failure — 2026-10-27

Run [40438204623](https://github.com/lopugit/thingtime/actions/runs/40438204623)
validated reviewed E1/E2 and actual workflow W, then both cases failed during
identity allocation with `bounded-fresh-identity-range-exhausted`. Lifecycle
fixtures and simulated parent loss were not reached. Both uploads failed
with `EACCES` on the allowlisted provenance file; no artifact or cleanup
acceptance survived. See the preserved E1/E2/W and bounded next evidence plan
in [the experiment spec](../.github/NATIVE_LIFECYCLE_EXPERIMENT.md#hosted-run-40438204623-initialization-evidence-and-proposed-repair).

The narrow proposed repair applies explicit permissions only to the new
allowlisted report directory and records aggregate allocator rejection
counters/stages inside existing provenance JSON. Local mode/control and
mocked allocation regressions preserve existing-directory modes, unknown-status
refusal, UID bounds and private output boundaries. No trigger or acceptance is
implied; original native pins/admission/PF remain unchanged.

## Reviewed persistent-denial experiment — 2026-10-27

The reviewed provider-disposal lifetime contract now has a separate reviewed inert
experiment. It retains PF denial until the one hosted macOS job VM is
destroyed, tests labeled packet counters and an escaped fixture after actual
supervisor exit, and requires real runner artifact continuity. Controlled root
file canaries and a synthetic peer-credential IPC service are narrow observations;
stock-service delegation and real transport-credential isolation remain unproven.
No candidate is admitted. Original native H1/H2/PF admission is unchanged.
The new workflow follows independent E1/digest and E2 pins. Parent readback of
the immutable local commits precedes runnable publication; hosted execution
requires a separate exact-head approval. No new run has been triggered.
See [the contract and evidence procedure](../.github/NATIVE_PERSISTENT_DENIAL_EXPERIMENT.md).
The previous runs 40438204623 and 40440369530 and their terminal receipts remain
unchanged; their fixtures never reached lifecycle acceptance.

## Authority EINVAL diagnostic follow-up — 2026-10-27

Persistent-denial run [40444943200](https://github.com/lopugit/thingtime/actions/runs/40444943200)
passed exact-source validation and saved readable, digest-verified result evidence,
then failed at the authority phase with `fixed-probe-os-error-22` before any PF
attempt. Positive controls, policy attribution and parent-loss fixtures did not
run. Artifact continuity was proved only before PF. Its E1/E2/W and terminal
receipt remain preserved; no retry is implied.

The follow-up adds fixed sanitized operation labels around the unchanged numeric
credential drop and authority calls. It does not relax enforcement or remove
`os.getgroups()`. [Python documents extended macOS group-read behavior](https://docs.python.org/3/library/os.html#os.getgroups),
and [Apple libc returns EINVAL when the UID has no account](https://github.com/apple-oss-distributions/Libc/blob/71bbe350ab79eef58113991d817ccc6165061a64/sys/getgroups.c#L34-L52).
[Published XNU accepts an empty setgroups input](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_prot.c#L1266-L1299).
This makes group readback a strong hypothesis for the deliberately accountless
fixture, not an identified hosted syscall or matching-binary proof. The next
reviewed evidence must name the operation before any supported group-observation
or setup contract is changed. Candidate admission remains false even on success.
