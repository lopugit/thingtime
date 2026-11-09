# Anonymous importer and nested Builder acceptance

Both isolated Chrome tests passed against the retained compiled application at
`e67c4e475fa0aff7b838310dfdcd864063a9f05c`. The in-container server and shell
hashes match the [source and fixture record](source-proof.json). These results
cover this build. The later main reconciliation adds current-page Builder
integration and requires its own built acceptance.

- [Normal Things importer](import/verification.json) accepted the exact
  exported JSON through **Import… → Import private copies** while the
  loopback HTTP transport was interrupted. A new document on the same browser
  retained the page and its complete one-Component closure while the outage
  remained active. Both saved crystals match the export after substituting the
  new local Component ID in the page reference. The resulting page rendered
  the exact multiline text at 1440×1000, 390×844 and 320×844. An independent
  browser context could not see the content, and the unauthenticated public
  resolver returned HTTP 404. The workspace contained zero non-anonymous
  records. [Test log](import/test.log)
- [Global and site Builder](site/verification.json) created a column with
  separately selectable text, button, icon and input blocks in each document.
  It edited text, button and icon independently, then read back exact
  child IDs, ordering, types and values after two offline document reloads
  per scope. The composed `/ode` page passed keyboard focus, button-to-input
  Tab order, unobscured hit targets, live input and full scroll checks at all
  three widths. The Inspector also passed focus and horizontal overflow
  checks. [Test log](site/test.log) · [Saved pages](site/saved-pages.json)
- [Combined evidence](verification-summary.json) records zero authenticated
  requests and zero HTTP mutations across 52 audited server requests. Page
  request capture also found zero mutations, and the Builder check found
  zero selected protected reads or page errors. Each Chromium context was
  fresh and sandboxed in a network-none, non-root, read-only task container
  with no published ports or host mounts. [Boundary](boundary.json) ·
  [Replica and capabilities](health.json) · [Cleanup](cleanup.json)

The earlier offline `/things` navigation failure remains unresolved.
[CDP emulation](attempt-3/import/failure.json) and
[one transport outage](attempt-5/import/failure.json) returned
`net::ERR_FAILED` despite the verified service-worker controller and complete
shell cache before the import. The final transport-outage test passed without
reconnection or a navigation fallback. There is no post-failure service-worker
trace or established root cause. The Builder fixture now uses the empty-list
insertion control for its first child and the sibling insertion control for
subsequent children. It scopes the composed DOM assertions to each document's
rendered sibling group because separate documents can generate the same IDs.

The acceptance image used the current bundle's Linux ARM64 bcrypt 6.0.0
prebuild on an immutable layer and verified a hash/compare. The existing
canonical runtime image pinned 5.1.1 and rejected 6.0.0 under its same-version
guard. The subsequent canonical manifest and lock pin were checked as 6.0.0.
The acceptance run did not rebuild the installed app or canonical runtime
image. The temporary derivative image, task container, browser contexts,
private replica, control lease and host state were removed.

These tests cover authored controls and saved document state. They do not
exercise Action execution or persistence of values typed into the live input.
