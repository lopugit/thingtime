# PR #637: Safe cooperative handover for Lopu reviews

## Scope and evidence

The live fleet queue has one mutation owner and multiple pending review,
conflict, stack-rebase and all-branch workers. This is the repository safety
lock, not proof of general GitHub runner starvation. Preview workers are
separate: PR #611's recovered preview completed while the Lopu queue remained.

Earlier fixes #624, #625, #626, #632 and #634 handle automated-comment feedback,
controller-only preview eligibility, per-PR CI isolation and native-queue
coalescing. This follow-up preserves those fixes and the serial mutation lock.

## Protocol

After five minutes of useful model time, a real pending fleet member requests
one latched wrap-up. Metadata polling happens at most once a minute and only
the current review owner acts. Claude receives trusted tool-completion hooks;
Codex receives the same explicit checkpoint command in its prompt.

The reviewer finishes and validates its current PR and writes its completed
report. Untouched PRs remain without reports. Unreported edits, active Git
operations and zero-progress continuation loops block handover. Completed
records alone reach the unchanged exact-head publisher, review comments and
CodeQL disposition validator.

Remaining PR numbers are preserved in a seven-day artifact and dispatched
behind waiting work, or left to an already-queued full-scope review. Fresh
eligibility and head SHAs are read on continuation. Distinct continuation run
titles prevent a partial inventory from suppressing a new full-scope signal.
Unknown queue state never creates duplicate work; failed dispatch remains a
visible error with its remainder receipt intact.

No process is killed and no active workflow is cancelled. This is cooperative,
not a five-minute completion deadline. Atomic conflict repairs, stack merges
and deployments retain their current safe boundaries. Already-running old
workflows cannot acquire new hooks retroactively.

## Validation

- 105 Node tests passed, including 14 cooperative scheduling cases.
- Actual Claude 2.1.208 delivered the hook in a harmless local fixture and
  returned COOPERATIVE_HANDOVER_RECEIVED. This is delivery proof, not a
  completed production fleet handover.
- Develop preview self-test: 141/141. Admin preview self-test passed.
- Routing and control-plane contracts passed; changed YAML parses.
- Graphify incremental semantic/code snapshot and portable HTML refreshed.
- Rollout target is only github-actions; no product branch merge or preview
  is appropriate for this bare control-plane branch.

## PR #611 recovery

The original September 4 preview failed on its initial comment POST with
HTTP 403 (integration-permission), before building. The corrected protected
controller was already available, but that unchanged head had not retried.

Dispatched the normal preview listener for head
e81d6aa7ce45593f24c43d41b4b6cc6b9923f0e8. Run
[33952929854](https://github.com/lopugit/thingtime/actions/runs/33952929854)
completed authorization, secretless build and protected publication. Its
exact-SHA comment is now present, and both the
[persistent alias](https://pr-611.previews.dev.thingtime.com) and
[snapshot](https://thingtime-mzdchylnm-lopugits-projects.vercel.app)
return HTTP 200. No product code or preview trust boundary was changed.
