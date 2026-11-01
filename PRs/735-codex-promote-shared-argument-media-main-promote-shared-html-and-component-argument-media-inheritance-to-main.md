# PR #735 — shared HTML and argument media promotion

## Scope and integration

- Base main: `2a37acbd1e8a731e25cc1e6d7a4abe413c1331d9`.
- Source: #734 `b682809656d2d145751ba156fad5474d6c5c50ce`, including #730
  authored HTML/contained media and #733 stored component arguments.
- Merge conflicts were overlapping prior sharing promotions. Preserve main's
  #719/#728 release records and combine the checklists/changelog. Application
  files under Remix match #734 exactly, apart from the changelog.
- Same-author, stored containment delegates read access from the freshly
  authorized root without modifying child ACLs. Foreign/private unrelated
  objects and managed attachment purposes retain independent authorization.
- Link visitors can interact, not write. Shared writer changes are checked
  against before/after resolved media; page arguments cannot expose guessed
  private uploads. Manifest versions and client requirements advance together.

## Validation, 2026-09-10

- Frozen-lockfile installation repaired missing `parse5` in the older local
  worktree; subsequent webpage tests passed 86 with one optional integration
  skip. API capability tests passed 26. Client/embed builds passed.
- The identical source passed the real local API plus built-client Chrome
  fixture at 1440/390 widths, including argument media, unauthorized write
  rejection, private document copies and revocation. Top/bottom screenshots
  were inspected. Stubbed media bytes do not prove independent S3 copies.
- Source #734 Web CI build/typecheck-ratchet/unit and API jobs succeeded.
  CodeQL reported no results/errors for merge `f2028e214e6ec2aa922be2667f3dee554cb3e9e1`,
  whose parents were then-current develop `087e1d1` and source `b682809`.
- Exact #734 preview rendered the original shared Tarot signed out in Safari,
  changed Devil reversed to World upright on Draw, and displayed Copy with no
  edit controls. Copy showed the private-copy sign-in explanation and reached
  the working login form. Desktop top/bottom layouts were inspected.
- An already-merged #733 preview returned 404 after its preview was removed.
  Safari had retained the old app until the next auth request. The same
  signed-out auth endpoint returned 200 with a null user on dev and production;
  this was not a missing login route or proof of the original blank-screen cause.
- The live dev frontend was separately observed at `087e1d1`, with the full
  signed-out app and ready frontend/Nitro/Vercel/MongoDB statuses.
- Graphify was refreshed using the local semantic proxy. Its existing framework
  node-ID collisions mean parts of that unrelated graph remain incomplete.

## Release gates and remaining goal work

This promotion needs its own exact-head CI, preview and production receipt.
Record those in the PR discussion after deployment; do not treat source-preview
proof as main deployment proof. The dev content link does not resolve on the
production origin; do not copy or change live data to manufacture a smoke pass.

Independent protected-upload copies, full conditional/runtime media coverage,
broader Thing containment and bounded-performance auditing remain unfinished.
Network/capability failures also still need a distinct retryable page-resolution
state rather than being reported as not-found. No stored bearer in a copy may
be used as a substitute for independent authorization.
