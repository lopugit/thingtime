# Control-plane regression checklist

This branch contains no application. Its rollout target is `github-actions`;
do not merge it into the permanently separate product branches to test it.

## Cooperative review handover

- Run `node --test .github/scripts/lopu-cooperative-review.test.mjs`.
- Verify a real pending fleet member signals only the active reviewer, after
  five minutes; API errors, malformed inventories and unrelated jobs do not.
- Verify parallel hook calls serialize, requests latch, and polling is bounded.
- Verify Claude hook delivery in a harmless local fixture; preserve settings on
  exact-session continuation and the same protocol in the Codex prompt.
- Finish at least one PR before yielding. Completed reports permit the existing
  publisher; dirty/unreported work and active Git operations block handover.
- Only completed records feed publication, comments, and CodeQL dispositions.
  Untouched PRs must not receive a successful-review comment.
- Preserve only PR-number metadata in the artifact, and queue the remainder
  after successful publication. Resume against fresh eligibility and heads.
- Never cancel an active worker or publish an incomplete PR to test handover.
- Preview recovery: an initial comment-write 403 must be retried through the
  corrected protected controller, not by editing product code or loosening the
  secretless build boundary. Verify the final exact-SHA comment and both URLs.

## Event feedback and CI cancellation

- Run `node --test .github/scripts/control-plane-events.test.mjs .github/scripts/preview-comments.test.mjs`.
- Verify owner-PAT and bot status comments stop before provider routing or model
  work; human questions, quote replies, and fenced examples still pass.
- Verify standalone trailing markers, marker removal, no-op edits, deleted
  queued comments, wrong-PR comment IDs, and metadata failures cannot start a
  model. Other PR, push, schedule, and failed-check signals must retain routing
  when the conversation job is skipped.
- Verify every rebase comment-producing step has an unconditional marker.
- Verify both preview writers preserve human comments, update the same owned
  ID, skip identical bodies, paginate, and refuse incomplete/failed scans.
- Run `node .github/scripts/deploy-develop-pr-preview.mjs --self-test` and
  `node .github/scripts/deploy-admin-pr-previews.mjs --self-test`; controller-only
  heads must skip builds, while non-404 contents failures remain visible.
- Run both `resolve-pr-conflicts-routing-contract.mjs --self-test` and
  `workflow-control-plane-contract.mjs --self-test`, plus every check in the
  control-plane CI required `verify` lane. Parse YAML and check script syntax.
- After publishing, inspect checks on the exact pushed head. After rollout,
  inspect naturally arriving preview/comment runs: marked automation should
  skip conversation admission and routing with no Lopu worker. Inspect an
  unrelated simultaneous CI run to confirm it retains its own concurrency key.
- Record observed run IDs and conclusions. A replay or local test is not live
  proof; a cancelled run is not proof of a code failure. Do not rerun or repair
  unrelated work just to turn historic checks green.
