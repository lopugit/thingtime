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
