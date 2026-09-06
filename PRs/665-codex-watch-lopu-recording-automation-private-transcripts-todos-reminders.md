# PR #665 — private Watch recording automation

Updated 2026-09-06. [Pull request](https://github.com/lopugit/thingtime/pull/665).
Branch: `codex/watch-lopu-recording-automation`.

## Implemented

- Explicit account opt-in for NEW private Apple Watch audio uploads, with a
  manual queue for an existing private recording post.
- Authorized, bounded audio download and OpenAI transcription; relational
  transcript comments on the private source post. Lopu organizes grounded
  private notes and todos without executing any extracted instructions.
- Quota-billed content and transactional job checkpoints, privacy/consent
  fences, bounded retries, resumable stages, and no raw provider errors in
  account-visible state.
- Daily local-calendar reminders for unfinished private todos, with durable
  per-day notification identity and completion/opt-out checks inside emission.
- Account-specific settings, current username, refresh, job status/retry, todo
  completion and reminder pause controls at `/lopu/recordings`.
- Origin-scoped versioned capabilities and canonical route/docs registration;
  five-minute scheduler; fork-safe configuration in README.

## Verification receipt

- `test:lopu`: 24 passing core, capability, worker and reminder tests. Includes
  transaction-time opt-out, completed/public/deleted todos, same-day retry,
  checkpoint recovery and Unicode transcript splitting. Collaborators are
  in-memory mocks, not direct database seeding.
- Notification tests: 18 passed; capability/index-budget tests: 18 passed;
  model-routing contract passed; real anonymous/cross-origin HTTP checks: 4/4.
- Vite/Nitro Vercel build and built-server manifest smoke passed. Typecheck
  ratchet remained at the existing 108-error baseline, not a clean typecheck.
- Real browser checks at 1280x900 and 390x844: settings persisted, status
  refresh worked, full-page scrolling and inputs had no horizontal overflow,
  and there were no page errors. Synthetic disposable QA accounts only.
- PM2 uses one deterministic worktree instance with automatic restart disabled.
  Local URL: http://127.0.0.1:17460/lopu/recordings (HMR 17461, Nitro 17462).
  Tailscale/Funnel is unavailable: its CLI shim points to a missing app binary.

## Delivery gates still open

The PR is regular OPEN and labelled `ai-merge-paused` intentionally while these
checks remain. Do not remove that hold merely because CI or a preview is green.

1. Integrate the separately authorized Watch/Lopu/Builder/rich-text foundation
   into main and into this branch. The saved Feature Stack targets main only;
   source order is #596, #291, #578, #612, #592, #635.
2. Wire the Watch foundation's shared APNs sender into the durable reminder
   emitter, including a safe reminder title and recording-page navigation.
   Current code persists the bell entry but does not yet send native push.
3. On a real preview with deployment-held provider credentials, verify a
   synthetic recording creates private transcript comments and grounded bike
   tube/toothpaste todos. Verify daily reminders and completion end to end.
   Local configured=false is expected; no provider key was copied locally.
4. Re-run focused checks on the integrated exact SHA and verify its deployment
   before merging this feature to main. Production behavior is not yet proven.

Preview discovery is maintained by the trusted controller in the PR body at
https://pr-665.previews.dev.thingtime.com. A URL or build alone is not runtime
acceptance. The initial preview attempt rejected an older source SHA after the
documentation snapshot commit; the subsequent exact-SHA attempt was publishing
when this receipt was written.

## Foundation merge coordination

The first merge run failed safely because #635 changed during resolution.
The second run, [34005577365](https://github.com/lopugit/thingtime/actions/runs/34005577365),
also became stale when Lopu review updated #612 to `b169d31ed844747d383405c4366b2b301e14c64a`.
Restart was requested on the SAME saved stack, but Chrome's confirmation
handler stalled. Run 34005577365 was then cancelled directly in GitHub and
verified terminal/cancelled. No replacement stack run has been dispatched.
All six selected PRs temporarily carry `no-lopu-review` to prevent concurrent
automated review edits; remove this temporary label after their verified merge.
The already-existing review hold `ai-merge-paused` on #665 remains separate.

An isolated `codex/watch-main-release` worktree now starts from main
`2c77f08c0081518e19a0924f954e427aff6972d0` to deliver the Watch foundation
through a focused PR without the blocked browser. A read-only merge-tree test
found no product-code conflicts, only changelog and generated snapshot renames.
Do not duplicate active runs or touch the original checkout's unrelated merge.

CI found that the three protected recording schemas needed explicit empty
entries in the pinned builtin-schema projection test. Those fixtures were added;
the privacy/schema gate itself was not weakened.
