# Reviewed experiment: inert persistent denial on one disposable hosted VM

Reviewed for publication, 27 October 2026. Hosted execution remains pending and
requires separate exact-head approval. The workflow's helper references and
digest follow the immutable E1/E2 procedure below; published bytes require the
safe checker's `--final E1` mode. The preserved local draft receipt records the
earlier placeholder state. No label, dispatch, candidate or native compilation
is authorized by this document. Existing native H1/H2 pins, listener, admission
and the earlier lifecycle experiment remain unchanged.

## Lifetime contract and scope

GitHub documents a fresh hosted VM per standard job, including `macos-15`, and
[automatic destruction of hosted macOS VMs at job end](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications#required-clean-up-on-self-hosted-runners).
The provider VM is the proposed lifetime boundary. PF denial is never restored,
its enable reference is never released, and no account/UID/state is recycled.
No user/system/runner/GUI/login launchd domain is inspected, registered in or
booted out. No deprecated bootstrap API is used. Root state remains for provider
disposal, including on failure. Best-effort killing is limited to exact trusted
probe process groups that time out; it is not the lifetime proof.

This is one fresh `macos-15` job (eight-minute limit), with a fixed reviewed
helper only. No matrix, candidate checkout/archive/import, native build, cache,
signing asset, account credential/profile or installation is included. The
fixture uses a numerically distinct UID/GID with cleared supplementary groups;
it creates no OS account. Directory-service numeric searches and a PID check
select within 5500–5699. These checks establish only unused observed numeric
credentials, **not** exclusive launchd ownership. The fixture deliberately makes
no launchd calls. The trusted runner/root remain outside the fixture.

GitHub's [passwordless runner sudo](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#administrative-privileges)
means live runner separation remains necessary despite disposal. The draft
never claims it is completely established: `candidateAdmission`,
`nativeCompileAdmitted`, `candidateExecuted` and `platformAcceptance` remain false
in every receipt. No candidate step exists. Direct setuid denial, canaries and
a synthetic broker must not substitute for enforcement against arbitrary stock
service delegation or access to real transport credentials.

## Ordered observations and gates

| Stage | Required observation | Failure boundary / limitation |
| --- | --- | --- |
| Reviewed source | Owner `lopugit`, exact full-SHA label `tt-pd-<E2>`, fresh open same-repo PR/head/base/author; immutable E1 checkout/digest; actual workflow W bytes equal reviewed E2 bytes | Abort before helper execution. No caller-supplied helper or candidate path. |
| Transport identity | PID/PPID/UID/executable metadata identifies both Actions daemons; DNS broker UID differs | No process arguments, environment, credentials or unrelated private records are read. |
| Numeric authority | Fixed fixture has exact UID/GID/groups; `sudo -n true` returns normal refusal 1; setting UID to transport UID gets EPERM | Timeout, signal, launch error or success fails before PF. This is not exhaustive privilege-escalation proof. |
| Trusted file canaries | Root private synthetic credential is unreadable; policy, root receipt canary and root helper cannot be opened writable | Only synthetic file access is attempted; no contents are read/written on unexpected success. No claim about arbitrary real credential locations. |
| Synthetic IPC | Kernel `getpeereid` matches fixture/runner; an intentionally reachable task-owned UNIX endpoint denies fixture and admits runner | Fixed peer-credential contract only. No stock Mach/XPC service inventory/probing and no claim that all services enforce it. |
| Before PF | Runner succeeds to the exact IPv4/IPv6 TCP targets and receives a matching UDP DNS response; control DNS is resolved and recorded before policy; numeric-IP HTTPS verifies hostname/TLS/200 | Missing IPv6 route, timeout, refusal or other positive-control failure aborts **before policy mutation**. |
| PF activation | Fixed rules admit only verified transport UID TCP/UDP, explicitly block fixture/root/DNS-broker probes and finally all other outbound IPv4/IPv6 protocols; existing states flushed | No resolver exemption, address allowlist expansion, proxy fallback or compiler sandbox change. Enable/load/readback uncertainty fails, retaining any applied policy. |
| Policy attribution | For each fixture/root/broker protocol: timeout-class denial plus positive delta in that role's exact destination/protocol/UID rule label; PF enabled and loaded-rules digest unchanged | Unsupported `pfctl -s labels` format, missing/duplicate rows, zero delta, route/refusal errors fail. Counters are UID/rule aggregates, not packet-to-PID tracing. |
| Escape and parent loss | Supervisor exits 75; detached watchdog releases a previously launched separate-session fixed fixture; that survivor itself repeats all denial probes, with corresponding label deltas | No kill/absence/no-respawn assumption. PID reuse/lifetime ownership is not inferred; fixed probe has an independent 90-second alarm. |
| Runner continuity | Credential-free runner HTTPS connects the same pre-policy-resolved numeric addresses (without DNS calls), retaining api.github.com SNI/certificate validation, under PF after supervisor loss; the real upload action must then upload only allowlisted JSON while denial stays loaded | HTTPS is not authenticated long-poll, live broker DNS or DNS-cache-expiry proof. The real upload action can still fail through denied broker DNS; no broker exemption is permitted. Upload success plus external artifact readback is required separately. |
| Disposal | Job reaches terminal state on the documented fresh provider VM | No in-guest destruction receipt exists. Report `providerDisposalRequired=true`, `providerDestructionObserved=false`, never observed cleanup/restoration. |

Commands are bounded to ten seconds; socket attempts to two seconds; sudo to
three seconds; owned probe wait/reap to ten/three seconds. The detached watchdog
has a five-second readiness handshake, a 160-second absolute observation
window and 210-second alarm. The supervisor has a 150-second alarm. The runner
waits at most 215 seconds for the watchdog receipt, within its job limit.
Readiness is required before observations and watchdog liveness is rechecked
before PF. No watchdog restart or experiment retry exists.

The root writes only `provenance.json` and `result.json` for upload (0644 under a
new 0755 report directory, explicitly correcting umask 077). State/policy and
synthetic credential are root-private; fixture output is bounded and never
uploaded directly. No raw command output/domain dump/process arguments,
environment or credential values enter receipts. Admission enforces exactly nine allowlisted keys and their string/SHA/literal-boolean contracts, rejecting unexpected fields rather than projecting them into the report. Sanitized stage and specific fixed failure codes survive trusted child failures; raw exceptions, arguments and stderr do not enter receipts. Source validation failures
can precede receipts; early helper failures normally have only `result.json`.
A missing watchdog/result or failed upload remains an observation failure.

## Review, pin and later evidence procedure

1. Review the helper, safe checker, this specification and workflow bytes.
   Run `python3 .github/scripts/native-persistent-denial-experiment.test.py --draft`
   and `actionlint .github/workflows/native-persistent-denial-experiment.yml`.
   Local tests use mocks/temporary files only; they never load PF, change
   identity, open a network connection, signal a process or start a job.
2. After approval to prepare immutable local commits: commit reviewed helper/checker/docs
   as E1. Replace **both** forty-zero helper references with E1 and the sixty-four
   zero digest with SHA256 of the E1 helper. Run the checker with `--final E1`;
   it compares exact Git object bytes and both literal pins. Commit workflow as
   E2. Preserve E1 and all original native H1/H2 references.
3. Parent independently reviews final E1/E2 bytes, hashes, current open PR/head,
   actor and base. Publish only after that review. A separate explicit run
   approval is still required. No local draft command applies labels.
4. If approved later, parent applies exactly one `tt-pd-<full E2 SHA>` label.
   The workflow fetches fresh PR data, compares E2 workflow bytes with actual
   W source bytes, verifies E1 and hashes the helper before root invocation.
   There is no relabel/rerun fallback. An observer must deduplicate exact
   head/event/time and preserve the one job handle and terminal receipt.
5. On terminal outcome, read back the exact artifact ID/digest and only the two
   allowlisted JSON names. Verify E1/E2/W hashes, activation/denial/escape phases,
   upload continuity and failure stage separately. Do not call provider disposal
   observed or promote native admission from a successful inert run.

The next proof gap after this experiment remains a supported argument and
verification for **live** candidate isolation from the exempt runner identity,
real transport credentials and arbitrary privileged services. Synthetic canary
and peer-UID tests deliberately do not close it. Candidate source, compile,
signing/publication and any change to original admission require their own
reviewed contracts and authorization.

## Hosted run 40444943200 and diagnostic-only follow-up — 2026-10-27

[The single approved run](https://github.com/lopugit/thingtime/actions/runs/40444943200)
completed with failure. E1 `5c5a0e936810e0bf06b7db90717c0827fa531350`, E2
`b82a61899be67ae495d0d932fa47610e9e4a2fcf` and actual W
`641becbf7792992bce84005c878b79048c97461c` passed byte binding. Artifact
`12707851644` contained only `result.json`; upload/readback and archive digest
matched. The result failed in `authority` with `fixed-probe-os-error-22`, before
positive controls or PF mutation. Escape, parent-loss and policy attribution
were not reached. Upload success before PF does not establish continuity under
retained denial. No provenance file was expected at this early checkpoint.

The existing broad authority phase covers several operations. A diagnostic-only
follow-up preserves every call, argument, order and acceptance condition, while
adding allowlisted operation labels around group clearing, gid/uid changes,
each numeric ID read, ID/group verification, group readback, sudo launch and
normal-refusal check, transport-setuid attempt and each synthetic canary open.
The root result retains its broad `failureStage` and adds `failureOperation`
with the specific fixed label, plus the sanitized failure code. Child envelopes
reject unknown operation labels/extra fields; exceptions never contribute
identity names, paths, stderr, command output or secret material. Local
`--helper-only` tests support this pre-pin stage; final immutable publication
still requires `--final E1` with two exact E1 pins and the helper digest.

A likely cause is the current `os.getgroups()` readback for an accountless UID.
[Python's documented macOS behavior](https://docs.python.org/3/library/os.html#os.getgroups)
distinguishes the extended group-access list from the effective group list and
says modern deployment-target results are not changed by `setgroups()`.
[Apple's published libc implementation](https://github.com/apple-oss-distributions/Libc/blob/71bbe350ab79eef58113991d817ccc6165061a64/sys/getgroups.c#L34-L52)
returns EINVAL if lookup of the current numeric UID finds no account; other
group-resolution failures can also return it. The [published XNU implementation](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_prot.c#L1266-L1299)
accepts a zero-length `setgroups` input rather than establishing that empty
input itself is invalid. Installed `setuid(2)`, `setgid(2)` and `getgroups(2)`
also document EINVAL cases, so the numeric errno alone is ambiguous.

These primary sources identify a plausible operation; they are not proof of the
hosted Python/libc build or the actual failing syscall. The follow-up neither
removes group verification nor interprets errors as empty groups, creates an
account, changes group expectations, or substitutes a private syscall. A future
separately reviewed hosted observation must identify the operation first. No
new execution is authorized here; original native pins/admission and all prior
terminal evidence remain unchanged.
