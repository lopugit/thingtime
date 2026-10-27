# Review-only hosted experiment: native task launchd lifecycle

Status: independently reviewed experiment source for publication. Publishing does not authorize a hosted run. Existing native helper/workflow pins and admissions remain untouched. This is one bounded inert experiment, not native compilation acceptance.

The inert helper, PR-only workflow and safe local checker have independent source review. The final helper commit, workflow bytes and PR head require parent review before the separately authorized owner label can trigger a hosted run. Privileged execution and dispatch remain withheld pending that exact review.

## Selected platform and question

Use one GitHub Actions workflow run, with two sequential `macos-15` jobs on independent GitHub-hosted guests. Cases are `normal` and simulated `parent-loss` after fixture admission. Each job has an 8-minute ceiling, a 120-second supervisor alarm, detached watchdog with a 180-second observation deadline, ten-second command limits and a sixty-second no-respawn observation. No nested VM, personal Mac execution, VM EULA acceptance, private credentials, provider calls, candidate download/checkout, PF change, app build, signing, installation or UI is involved.

Question: on the actual hosted OS, can root create a fresh disabled UID/group and its exact `user/<uid>` domain; can its service demonstrably run as that UID inside its bootstrap context, refuse mutation of a different fresh task-owned UID domain, respawn under KeepAlive, and then be removed with escaped descendants by exact owned teardown under normal and supervisor-loss paths?

Official GitHub docs say hosted macOS jobs use fresh VMs, while nested virtualization is not officially supported. That makes the existing hosted guest the bounded experiment target, without introducing a new virtualization stack or license action.

## Files and exact local review

```sh
python3 .github/scripts/native-lifecycle-experiment.test.py
```

This parses helper and embedded workflow Python, verifies pinned official action refs and token scope, and runs fourteen deterministic label, report-mode, allocation and cleanup/timeout tests. It executes no subprocess, privilege change, UID inventory, signal, network request, account operation or launchctl command. Temporary filesystem fixtures are new directories under `/tmp`; no repository file changes occur.

Durable source locations:

- `native-lifecycle-experiment.py` -> `.github/scripts/native-lifecycle-experiment.py`
- `native-lifecycle-experiment.yml` -> `.github/workflows/native-lifecycle-experiment.yml`

The workflow pins the separately reviewed helper commit in both its checkout and declared provenance. The safe checker also supports `--helper-only` to validate the first helper commit before the workflow exists, or `--workflow <path>` when reviewing a prepared workflow outside its final location.

The published helper commit E1 is `5e8da0ea14707276769fc420f2a522b8715fc0a8`, with source SHA-256
`d7c074d4ac55ab3c20d1b80bd9be6b163f5153651d3434b131e4d65850a5fd98`.

## Helper SHA, reviewed head and actual workflow SHA

There are three different immutable references:

1. E1 is the commit containing the independently reviewed inert helper. The workflow checks out E1 explicitly with credentials disabled and sparse checkout restricted to that helper. Its bytes must match the literal SHA-256 in the workflow. Candidate source and candidate scripts are never acquired.
2. E2 is the final PR head containing the reviewed workflow that pins E1. After reviewing E2, the authorized owner applies `tt-life-<E2>` to PR1251. The event must be `pull_request:labeled`, sender `lopugit`, same repository, expected branch, open state and base `github-actions`. Pushes and ordinary PR updates never trigger this experiment.
3. W is `github.workflow_sha`, the actual source commit GitHub selected for workflow execution. PR workflows use a merge ref, so W must not silently be called E2. Before root execution, the validation step uses the built-in read-only token to compare exact workflow bytes at E2 and W. It also rereads the current PR head and rejects a stale label if HEAD moved. Provenance records E1, E2 and W separately.

Permissions are only `contents: read` (immutable helper and workflow contents) and `pull-requests: read` (fresh head/state check). There is no `secrets` context, `secrets: inherit`, custom credential, cache or environment. `GH_TOKEN` exists only in the runner validation step. The root helper receives `env -i` with explicit non-secret hosted markers and the runner UID, and all fixture commands receive a fixed empty-derived environment. Artifact upload uses the existing pinned official action; its runtime authorization is not passed to fixtures.

GitHub supports `labeled` activity directly on `pull_request`, without the default-branch registration required for `workflow_dispatch`. A conflicted PR will not run; fix the actual conflict rather than switch to `pull_request_target`. A label applied by a workflow's `GITHUB_TOKEN` will not start another workflow. Use only the already authorized owner-authenticated supported CLI/API session; do not add or retrieve a credential to make the experiment run.

After helper review/commit E1, the workflow must contain its forty-character lowercase SHA in both literal pin locations. Validate the final bytes with:

```sh
python3 .github/scripts/native-lifecycle-experiment.test.py --final "$experiment_helper_sha"
```

The checker expects the workflow in `.github/workflows/` to contain that exact SHA twice; source hash must still match. Do not use the native H1, candidate source SHA, a branch name or caller-provided ref as E1. Commit the final workflow as E2, review its diff, then inspect fresh PR head. Only after parent authorizes this exact hosted experiment, the exact trigger commands are:

```sh
experiment_reviewed_head=$(gh pr view 1251 --repo lopugit/thingtime --json headRefOid --jq .headRefOid)
test "$experiment_reviewed_head" = "$experiment_expected_reviewed_head"
gh label create "tt-life-$experiment_reviewed_head" --repo lopugit/thingtime --color 6b7280 --description 'Exact-head owner approval for one inert hosted lifecycle experiment'
gh pr edit 1251 --repo lopugit/thingtime --add-label "tt-life-$experiment_reviewed_head"
```

`experiment_expected_reviewed_head` must be the E2 just reviewed. These commands are a proposed trigger, not instructions already executed by this child. If the label already exists, inspect why; do not blindly remove/re-add or repeatedly dispatch. Preserve the single run handle. This adds no approval to the existing native workflow and changes none of its pins.

## Actual helper command and owned effects

The workflow invokes only the pinned fixed helper, through the runner's existing `sudo -n` capability:

```sh
sudo -n /usr/bin/env -i \
  GITHUB_ACTIONS="$GITHUB_ACTIONS" RUNNER_ENVIRONMENT="$RUNNER_ENVIRONMENT" \
  GITHUB_REPOSITORY="$GITHUB_REPOSITORY" RUNNER_TEMP="$RUNNER_TEMP" \
  SUDO_UID="$(id -u)" \
  /usr/bin/python3 -I -S "$helper" supervise "$CASE" "$report" "$RUNNER_TEMP/inert-admission.json"
```

All account/group names are generated `_ttlife...` names. Allocation is bounded to numeric UID/GID 5500-5699 and must find absent user/group IDs, no UID processes and an absent task domain; the runner UID is excluded. Before every cleanup, exact newly created DS records must still match the generated name's UID, primary GID, task home and `/usr/bin/false` shell. Incomplete or conflicting records are quarantined; no guessed delete is attempted.

Two fresh identities are used: task and inert sentinel. Both are exclusively this experiment's resources. The sentinel exists only to test cross-UID domain refusal without touching the runner, GUI, login or system service definitions.

Exact mutation targets are:

- `dscl . -create /Groups/<generated-name> PrimaryGroupID <fresh-id>` and disabled `/Users/<generated-name>` fields.
- `launchctl bootstrap user/<fresh-id>` for each owned identity.
- `launchctl bootstrap user/<task-id> <root-owned-fixed-plist>` and a fixed inert user-owned plist.
- `launchctl kill SIGKILL user/<task-id>/com.thingtime.inert.main.<generated-name>` to exercise only the fixture's KeepAlive behavior.
- Fixture's foreign probe: `launchctl bootstrap user/<sentinel-id> <same-inert-plist>`; the inert foreign definition has `RunAtLoad=false`, `KeepAlive=false`, no MachServices and `/usr/bin/true`. Unexpected admission is failure, never a privilege to continue.
- Cleanup only: `launchctl bootout user/<fresh-id>` and `pkill -KILL -u <fresh-id>`, then exact own account/group deletion after absence observation and ownership reread. No system/runner/login/GUI bootout, global launchctl action, process-name kill or runner-UID signal occurs.

User-domain services supply UID/GID; `UserName`/`GroupName` are not used because Apple's manual says those keys apply only in the system domain. The fixture asserts real/effective UID/GID, rejects root/admin supplementary groups, requires normal `sudo -n true` refusal, and checks documented `launchctl manageruid` equals task UID. It positively admits the same inert plist into its own domain before testing foreign admission.

The fixed fixture records its PID and an escaped `start_new_session=True` child PID. The trusted supervisor independently confirms both are in the task UID inventory, kills only the main service through its exact service target and requires a new main PID under KeepAlive. The user-owned event is a fixture hint; it cannot alone establish process ownership.

## Expected observations and hypothesis limits

Required observations: two main service PIDs under task UID, an escaped child, matching bootstrap manager UID, successful own-domain admission, specific foreign permission refusal, successful exact domain removal, no UID processes or task domain for sixty seconds, and exact record deletion. The detached root watcher must perform cleanup independently after the supervisor deliberately exits 75 in the parent-loss case. This is simulated supervisor loss at a known post-admission checkpoint, not actual GitHub cancellation or arbitrary SIGKILL timing.

The helper deliberately treats return code 113 for missing user domain and 1/13 for cross-UID permission refusal as **platform hypotheses**. It does not parse `launchctl print` structure. Any different status, timeout, inaccessible domain, inventory failure, unexpected registration, wrong manager or absent fixture fails this experiment. Do not expand the accepted status set just to obtain a green result. Capture and classify the exact hosted platform behavior first. A passing experiment does not turn these statuses into a production machine-readable domain API.

Raw launchctl domain dumps, process arguments, environment dumps, DS documents and fixture output are not uploaded. Artifacts are only `provenance.json`, `fixture.json` and `result.json`, containing fixed labels, numeric IDs/status counts and reviewed SHAs. All command stdout/stderr is captured privately and not serialized. Host/build version metadata can be added through explicit allowlisted fields after review.

Abort behavior: if ownership, teardown or observation is uncertain, do not delete guessed resources, do not restore a firewall, do not retry a permissive path, do not run candidate code. Mark quarantine and let GitHub discard the entire disposable job VM. This experiment never changes PF, so there is no local firewall rollback. A watchdog deadline while its supervisor still appears alive publishes a quarantine result instead of racing that live supervisor's mutations. Root-owned task temporary directories are intentionally left to guest disposal.

## Bounded route to the actual unsigned compile

If observations pass, implement the admitted native lane's bootstrap placement using the established task user domain and independently reviewed teardown. Existing PF validation must still prove direct IPv4/IPv6/UDP denial, broker/root denial, child sandbox compatibility and runner HTTPS continuity; this experiment proves none of those.

A less coupled lifetime option is to retain the deny policy for every non-runner UID until GitHub destroys the disposable guest, while allowing only the verified runner UID to upload sanitized evidence. This can remove PF restoration from the successful compile path; it cannot remove actual candidate-network denial or runner-continuity validation. On uncertain teardown, keep denial, terminate candidate work by exact owned authority, upload only through the trusted runner and dispose of the guest. Never apply persistent-denial behavior to this personal Mac or any reused/self-hosted machine. Helper H1 and workflow H2 still require separate reviewed immutable admission before any native candidate execution.

No source-only change, mocked test or inert observation establishes actual macOS/iOS compile, signed installed app, real provider/passkey, physical device, or private account acceptance.

## Platform sources

Read locally on 2026-10-27: `man launchctl` (user domains, bootstrap/bootout, asuser credential distinction, print non-API warning, documented exit-status decoding) and `man launchd.plist` (system-only UserName/GroupName; AbandonProcessGroup; KeepAlive). The personal host reports macOS 27.0 arm64; those man pages are guidance and must not be represented as the hosted macos-15 result.

- GitHub runner lifecycle and nested-virtualization support: https://docs.github.com/en/actions/concepts/runners/github-hosted-runners
- GitHub PR labeled events, merge refs, conflicting PR and GITHUB_TOKEN event limits: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request
- GitHub minimal token permissions and script-injection guidance: https://docs.github.com/en/actions/reference/security/secure-use

The new root experiment itself needs independent exact-source review and explicit parent authorization. A label is an exact-head trigger within the reviewed design; it is not a way to bypass the existing native controller's admission policy or promote unreviewed feature-branch code into privilege.

## GitHub label compatibility

The exact-head trigger is `tt-life-<full forty-character SHA>`, which is 48
characters and fits GitHub's 50-character label-name maximum. The original
longer prefix was rejected with HTTP 422 before a label could be created or
applied; it did not trigger an experiment. Keep the complete SHA and the same
owner/current-head/workflow-byte guards; never shorten or truncate the SHA.
The safe checker verifies the generated label's exact contents and length.

## Hosted run 40438204623: initialization evidence and proposed repair

The single owner-authorized run [40438204623](https://github.com/lopugit/thingtime/actions/runs/40438204623)
(attempt 1) failed during identity allocation in both cases, with fixed error
`bounded-fresh-identity-range-exhausted`. Neither KeepAlive/escaped-child
assertions nor the deliberate parent-loss checkpoint ran. This is no conclusion
about whether the intended lifecycle can pass. The source did not record which
allocation predicate rejected each ID or whether allocation one or two failed.

Both cases passed exact-source validation with helper E1
`5e8da0ea14707276769fc420f2a522b8715fc0a8`, reviewed head E2
`547cf540129b9bbfbd38cc2ecff86341bfff6e32`, and actual workflow source W
`8242b2b08fd56746169e4ad6eaf3f93cd896a031`. The workflow bytes at W independently
match reviewed E2. Both artifact uploads reported `EACCES` while examining the
allowlisted `provenance.json`; the artifact inventory is empty. Cleanup status
and created identity/domain counts are unverified. The original terminal
receipt remains preserved; no relabel or workflow retry followed this result.

Source analysis identifies the report-access defect: `umask 077` filters
`mkdir(mode=0755)` to `0700`. The proposed repair explicitly applies `0755`
only to the new task report directory, preserving `0644` for its allowlisted
JSON and private modes elsewhere. A local temporary-directory regression first
reproduces the `0700` control and verifies the repaired directory/file access
modes; it also refuses to change an existing directory's permissions. This is
local mode evidence, not a successful hosted upload.

The allocator retains UID range 5500–5699, numeric search semantics, PID
inventory and accepted domain statuses. It publishes only bounded counters
inside the existing allowlisted `provenance.json`: attempt and pre-allocation
resource-entry counts, IDs scanned/excluded, user/group numeric-field search
matches, PID/domain presence and available candidates, plus fixed stage/outcome
labels. Search matches mean nonempty output from the existing numeric-field
pattern search; they do not newly claim exact numeric identity matches. User
and group counters can overlap. No directory record, account name, process
argument, environment, raw command output or domain dump is published.

A separate authorized nonprivileged read-only check on this personal host
found one unused numeric UID with empty user/group searches and no processes;
`launchctl print user/<uid>` returned status 1. This is not the hosted result
and does not explain hosted exhaustion. Status 1 remains rejected; neither
the UID range nor accepted domain statuses are broadened.

Next evidence plan: review the narrow source diff and safe checks; commit the
new helper as a new E1 and separately pin/review workflow E2 and its digest.
Only after separate exact-head authorization, trigger one bounded inert run
with the same two sequential cases. Inspect the allowlisted readable
provenance/result/fixture JSON, allocation skip counters and observed E1/E2/W.
If allocation still fails, classify its actual predicate before proposing any
behavioral change. No candidate compile, native H1/H2 admission, PF change,
existing-domain takeover or accepted-status expansion is authorized by this plan.
