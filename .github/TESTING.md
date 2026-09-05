# Control-plane regression checklist

This branch contains no application. Its rollout target is `github-actions`;
do not merge it into the permanently separate product branches to test it.

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
