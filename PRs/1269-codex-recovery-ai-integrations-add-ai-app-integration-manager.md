# Recovery AI app integration manager — PR #1269

Branch: `codex/recovery-ai-integrations`. Isolated managed worktree created from
fresh `origin/main` at `24386d7f504dc6aa4a183ef9dd2534b143fafbbc`; PR targets
`develop`. No remote primary branch action is authorized or performed.

## Delivered behavior

- Discover recognized macOS AI bundles, executable locations and separate Codex
  homes without executing discovered programs or reading credential stores.
- Install the canonical Thingtime MCP endpoint and skill through client-specific
  configuration adapters. Preserve unrelated settings and refuse unmanaged
  collisions, unsupported syntax, symlinks and modified managed files.
- Retain owned receipts and hashed version snapshots for pinning, rollback and
  removal. Uninstall disables automatic reinstallation for that target.
- Check for new supported apps while Recovery is open and through its signed
  hourly LaunchAgent. Download future integration payloads through canonical
  Recovery releases, requiring same-team Developer ID signing and notarization.
- Provide an isolated native development app, fixture home, bundled CLI and
  production signed installation workflow. The offline Recovery management
  surface follows the existing native app architecture.

## Verification and decisions

The initial full suite passed 55 tests. Native fixture acceptance verified the
canonical MCP URL and exact skill bytes, version pinning, uninstall confirmation,
automatic Cursor/Gemini setup, and retention of the Codex uninstall opt-out.
The UI was inspected at compact and maximized desktop sizes, including long-path
details and scrolling to the end. Compact-window clipping and inherited
accessibility labels found during acceptance were corrected.

The first signed local build is Recovery 0.2.0 build 2 from `aa970eb03`, installed
under `~/Applications/Thingtime Recovery.app`; nested and outer signatures passed
strict verification, and the running executable resolved to that installed copy.
Live discovery was compared against actual bundle/executable locations. It exposed
a false Codex profile match for a proxy support directory and missing Copilot and
VS Code Insiders adapters; corrections and regression checks are included before
final automatic setup acceptance.

Cloud ChatGPT and Claude Desktop connections remain account-managed through their
supported host interfaces. Installing local configuration is not proof of OAuth
consent or an authenticated MCP call. OpenCode requires a recognized existing
V1/V2 JSON layout; ambiguous overrides/JSONC are preserved. Remote signed-release
update acceptance depends on publication of a compatible payload; no unpublished
release is claimed available.

Private agent-dashboard reporting was attempted through the connected Thingtime
account and supported browser recovery. The connection exposes Things reads but
not Character/saved-Action execution; the independent built-in browser is signed
out. No Character/task records were invented and no credentials were transferred.

## Final local acceptance — 28 October 2026

- Full Swift suite: 63 passing tests (17 XCTest and 46 Swift Testing), including
  actual acceptance regressions for extra-home false positives, valid quoted
  TOML keys, Copilot/Insiders routing and blank JSON exact-byte restoration.
- Final runnable source: `025d800587237defc0e3af580f079955483cf125`, Recovery
  **0.2.0 build 4**. Build output is
  `~/Library/Caches/com.thingtime.desktop.recovery/bundle-stage/Thingtime Recovery.app`;
  installed copy is `~/Applications/Thingtime Recovery.app`.
- Both app copies and nested helpers passed `codesign --verify --deep --strict`.
  The Developer ID designated requirement stayed identical across signed builds.
  The running process resolved to the installed executable.
- Enabled automatic setup and verified canonical endpoint/skill bytes for
  **Claude Code, Codex, Gemini CLI, GitHub Copilot CLI, VS Code, and VS Code
  Insiders**. Insiders had an empty file, which now initializes safely. The
  pre-existing unmanaged `.codex-2` Thingtime entry was left unchanged.
- The loaded job resolves to the installed helper, uses a 3,600-second interval,
  and completed with exit code 0 with Recovery closed. Recovery was reopened
  afterward. Native UI shows the enabled schedule and up-to-date managed apps;
  expanded controls retain individual accessibility labels.
- Removed the task's development app and isolated test home after verification.
  Existing installed applications, credentials and unrelated configurations
  were retained. No authenticated call from each host or future remote-release
  update is claimed from configuration verification alone.

CI is tied to the PR head and remains distinct from this local acceptance. The
final source/documentation fingerprint is refreshed through the repository's
immutable Graphify snapshot workflow before handoff.
