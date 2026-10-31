# PR #945 — Mac Lopu voice input

## Cause and implementation

The installed Electron app reproduces `Microphone unavailable (network)` when
starting standard Lopu voice input. Chromium exposes a Web Speech constructor,
but the remote recognition backend is unavailable to Electron. Constructor
presence was therefore an incorrect capability check.

The Mac bridge now advertises speech version 1.0.0 and starts a fixed signed
`ThingtimeSpeech` helper from the bundled native resources. Apple Speech and
AVAudioEngine produce transient partial/final transcripts; audio is not saved.
On-device recognition is preferred when available for the selected language.
Apple's service may be used otherwise. Final text enters the existing Lopu turn
queue, selected chat/model and feedback-loop guard. Direct-provider voice and
ordinary browser recognition retain their existing paths.

Only the bundled main window may invoke the speech IPC. Captures have bounded
output and duration, a startup watchdog, session IDs and cancellation on stop,
navigation, crash and window/app exit. Late callbacks cannot affect a new capture.
The helper also exits if its parent's stdin closes. Privacy usage descriptions,
audio-input entitlements and recoverable permission messages ship with the app.
Signature validation still accepts older builds without the new audio entitlement.

## Validation — 2026-09-27

- Reproduced the original error in the installed app with the mic button.
- 101 Electron tests passed, including framing, origin/frame restrictions,
  malformed output, subprocess failure, cancellation and replacement.
- 17 voice tests passed, including native-versus-browser selection, partial/final
  adaptation, late permission failure and foreign-session fencing.
- Swift speech helper release build and complete web/Nitro/MCP build passed.
- Targeted ESLint: no errors (two warnings, one in the existing voice file).
- Full TypeScript: 91 diagnostics, none in changed files; this is not a clean
  full-project typecheck.
- The broader Swift suite aborts in DesktopChatRuntimeTests. The macOS crash
  report identifies a missing NSBluetoothAlwaysUsageDescription in the XCTest
  host, unrelated to this standalone Speech executable. Native suite completion
  remains unverified.
- Signed local packaging passed strict verification for com.thingtime.desktop,
  team 6DQQ9V7C84. The final build packages source commit adae7cd4179ff28343b7f567d10f61f696a32708;
  later commits contain validation notes and the structural graph only.
- Installed voice acceptance and final merge/install evidence are maintained in
  the live PR description as the final checks complete.
- Graphify's structural update succeeded (including the new Swift/TypeScript
  speech nodes). Semantic extraction was attempted through the local Codex
  proxy; all six chunks returned 502 codex_execution_failed. Documentation
  semantics are not claimed current; the usable structural snapshot is retained.

The user explicitly requested fixing this issue, merging into main, and
reinstalling Thingtime on this machine. Preserve the existing checkout's merge
conflicts and use the isolated codex/mac-voice-input worktree.
