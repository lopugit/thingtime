# Isolated Linux acceptance environment

The broad native acceptance suite used client/server package SHA-256
`c41befc0600c979d80f4912e1cdb01cb22218c834531d80088922e9d7f1d319e`.
The three `final-*-build.json` manifests independently hash the same 2,033 files
(242,614,199 bytes). Each running fixture uses its own read-only copy, fresh Mongo
replica, generated credentials and network/PID/mount namespaces. Separate fixtures
preserve the real signup rate limit while allowing independent acceptance suites.

- `final-core`: posting, algorithm History, audience/composer/feed and batch import.
- `final-theme`: theme History, organization and import.
- `final-remote`: MCP/native draft render, editor download and normal app importer.

Native theme checks then identified a custom-plane Home API scope mismatch and
a clipped mobile History drawer. The repaired package is
`edd245b3026f971e114d84082440fc47e7ec7c234c974f19af904caa49a22a69`
(2,033 files; 242,615,309 bytes), recorded in `theme-repair-build.json`.
`theme-repair-canonical-build.log` records the complete rebuild. Its fresh
`theme-repair` and `audience-repair` fixtures cover affected theme/UI acceptance
with independent signup budgets; earlier scope remains pinned to its own package
hash. `theme-repair-draft-comparison.json` proves all
five draft-preview files are byte-identical to the accepted package, including
both workers and the runner, policy and HTML.

Visual review then found that the collapsed composer also needed the existing
launcher-clearance marker. That package is
`e7427480e802ad274df4f1167443702e7e9534f2f05bc340a79691b513e9970c`
(2,033 files; 242,615,421 bytes), recorded in `composer-repair-build.json`.
Its complete build log and isolation proof use the `composer-repair` prefix.
The composer change also changes the draft runner; the comparison JSON records
that difference explicitly, so final draft artifacts require a fresh native run.

The integrated matrix package is
`2f0710ac20e67675e56271dd5607a7a32c2e038853e40ebd62dbf40c9e310e59`
(2,035 files; 231,147,871 bytes). Its three independent immutable fixtures are
`integrated-remote`, `integrated-links` and `integrated-core`. The canonical build
completed with all 2,975 recorded production/configuration files unchanged;
`integrated-source-comparison.json` pins source aggregate
`5a2658430098927c4c81311ad33e8a62ef3022fcf27a700ad7760056fb581967`.
The before/after manifests and exact build/capture scripts accompany its build
log. The linked/file-copy fixture opts into an API-created synthetic admin;
its private credential file is excluded from evidence and removed at cleanup.
`integrated-draft-comparison.json` records the changed runner and the four
unchanged companion files. Native results remain scoped to each suite's package
manifest; older passing artifacts do not establish acceptance of these new bytes.

Native account file-copy acceptance then exposed a MIME identity mismatch:
upload completion correctly normalized the served MIME, but metadata placement
still compared that value with the original client MIME. The repair uses the
verified upload receipt as the MIME baseline while retaining the other identity
and later-change checks. The repaired package is
`15e93be01ba2478f19fbdd20201bb18d72ab6c87f794e5a7c4800854b4ab85a7`
(2,035 files; 231,149,415 bytes), with fresh `copy-repair` admin fixture.
`copy-repair-vs-integrated-source.json` proves the only changed production file
was `accountFileMetadata.ts`. All 2,975 repair inputs stayed unchanged through
the complete build, source aggregate
`8a95b2df38f68bc247d1492c74eec5689bcc526c59888fc1cf4acdfb9db17476`.
The corresponding build, comparison and source manifests retain the earlier
integrated evidence separately. Its draft runner changed to `a6571e78…`; the
four companion files stayed identical. The repaired native file-copy test passed
in 60.04 seconds. The full MCP suite passed with zero skips in 41.14 seconds,
followed by the web renderer (7.19 seconds), editable Builder (22.91 seconds) and
normal importer with verified cleanup. These final renderer artifacts use the
repaired runner, while earlier unchanged-flow results keep their own scope.

`canonical-build.log` records the complete client/offline build, Nitro template
sync and node-server build with root/Remix dotenv files masked in a private mount
namespace. No deployment or installed Mac app acceptance is implied.

Each `final-*-verification.json` records real browser/backend direct IPv4, mapped
IPv6, native IPv6, hostname and redirect refusal; Chromium's sandbox remains
enabled. The checks also verify isolated process identity and absence of host
profiles, project configuration, Git credentials and inherited secrets. The exact
read-only cgroup memory diagnostics cover the entire managed workspace, including
concurrent jobs. They do not measure an individual fixture's memory.

`negative-controls.json` additionally records synthetic inherited-credential
omission and refusal to enter a forged fixture owner. `preflight-tests.log`
verifies rejection of incomplete packages that serve SPA HTML for required
renderer JavaScript. `harness-lint.log` records the focused harness lint check.

The `*-acceptance-complete.*` files preserve the previous package identity and
verification separately from final acceptance. Its cleanup record proves the old
namespace stopped and its private browser/database state was removed. Final
cleanup records are copied after each corresponding suite completes.

MongoDB 8.0.15 came from the official Ubuntu 24.04 archive; the downloaded archive
was checked against SHA-256
`847953b176f30c185eb0aea1ac6576ef35c105deee10596dff94032459f96850`.
Runtime/session metadata, generated signing material, browser profiles and Mongo
databases are deliberately excluded from this evidence directory.

Final cleanup is complete. `copy-repair-source-final-comparison.json` verifies
all 2,975 recorded production/configuration files still match the repaired build
after every native run and the final static plan check. `copy-repair-cleanup.json`
and `final-cleanup-summary.json` prove all task namespaces stopped and private
home/database/admin credentials/runtime metadata were removed, with artifacts
retained. `final-resource-checkpoint.json` records zero OOM and OOM-kill events
for the whole managed workspace; its memory value includes caches and other jobs.
