# No-login native draft render and export — 9 November 2026

The final application build rendered the supplied affirmation fixture through the real
Thingtime renderer in sandboxed Chromium. The opt-in test drove the isolated
launcher through MCP SDK stdio, with no account or API token. It passed in
40.25 seconds with launcher umask `077`.

- [Canonical editable JSON](thingtime-draft.json)
- [Desktop PNG, 1440 × 1000](viewport-1440x1000.png)
- [Mobile PNG, 390 × 844](viewport-390x844.png)
- [Narrow mobile PNG, 320 × 844](viewport-320x844.png)
- [Card PNG, 400 × 560](card.png)

[Render result](verification.json) records exact text, geometry, no overflow, and
the duplicate-viewport refusal with zero artifacts. The render-only connection
also refused an archive-tool call. [Canonical verification](canonical-verification.json)
confirms the output round-trips byte for byte, includes the editable page and
its component, and uses only portable fields. The current schema adds
`builder-thing` to both entries. Each PNG's bytes and dimensions were checked,
and all four views were visually inspected against the same images from the
earlier baseline. The final captures match those inspected bytes.

[Source and build verification](source-verification.json) records the application
tree, launcher and test blobs, pinned image, Chromium version and asset hashes.
[Cleanup verification](cleanup-verification.json) records the live network-none
container configuration and exact container and volume removal. Three older
volumes remained untouched.

The original launcher failed under `077` because the non-root container could
not traverse its staged entry point. The launcher now grants read and traversal
access to the private snapshot copy while retaining the host temp directory's
private permissions. The renderer keeps its non-root user, read-only mounts,
custom seccomp and Chromium sandbox. Launcher unit tests passed 5/5 and native
draft validation tests passed 6/6. Two earlier attempts observed a 15-second
Chromium navigation timeout on the 42 MB bundle; those attempts do not prove
input validation. The final positive capture passed with the existing
deadlines, and malformed JSON and missing dependencies passed their dedicated
native validator tests.

[Local discovery](local-discovery.json) confirms the canonical local CLI lists
the render schema and existing archive tools. The positive capture verifies the
isolated SDK path. It does not establish hosted MCP availability, installed
Codex desktop tool delivery, or a production deployment.
