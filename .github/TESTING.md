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

## Missing-build wildcard fallback

- Run `node --test .github/scripts/preview-fallback.test.mjs`. Verify root
  soft-404/nested 404 and no-store routing, marked HTML, hashed CSP, exact-host PR links,
  no automatic polling, target scoping and accepted-but-lost write recovery.
- Stage before assigning: check both `/` and a nested route on the immutable
  URL. A Vercel directory listing or app shell is a failure, even if the API
  calls say READY. Root HTTP 200 requires the missing-build header, no-store and
  the exact marked page; nested paths remain HTTP 404.
- In a live browser, check desktop/mobile layout, scroll to the bottom, activate
  Try again and Open pull request, and check the page/URL afterwards. No reload
  loop, overflow, clipped controls, CSP errors or unexpected redirects.
- Only the two verified preview wildcards may change. Production deployment
  targets, foreign marker/content metadata and unexpected domain bindings fail
  before mutation. Keep exact PR aliases and main/develop root domains intact.
- After rollout enable the protected mode variable, test unused hostnames in
  both environments (including nested/API paths), and verify exact existing
  preview aliases still serve their recorded SHA. Missing pages and arbitrary
  HTTP 404 responses must never count as a successful preview publication.

## Preview labels and missed-build recovery

- Run `node --test .github/scripts/preview-*.test.mjs` and both preview
  publisher self-tests. Test DST/midnight, multi-environment labels, stale heads,
  shared/foreign label ownership, accepted-but-lost writes, and failed phases.
- A repeated READY receipt must preserve the actual Vercel completion timestamp
  and the same comment ID. Building/failed/removed status keeps the last success;
  cleanup must not put labels on an unrelated PR that never had a preview.
- The scheduled open-PR inventory must include eligible PRs with no Vercel
  objects. Existing READY exact-head deployments repair status without a build.
  Active native queues/builds, forks, drafts and controller-only heads do not
  dispatch. Bad metadata fails closed and does not block other PRs' inspection.
- Recovery receipts must precede dispatch, survive an uncertain response, impose
  a cooldown and stop after three attempts per commit. Recovery provenance must
  bind the fixed scheduled default-branch workflow and Actions bot sender.
- After merging to `github-actions`, rerun an eligible preview and inspect the
  exact head, immutable/persistent URLs, actual READY time, same comment ID and
  sidebar labels. Run the scheduled sweep and record its outcome; report any
  unverified environment or exhausted build instead of claiming universal health.

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
