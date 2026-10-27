# PR 1258 — Native passkey recovery and Thingtime provider naming

[Pull request](https://github.com/lopugit/thingtime/pull/1258)

The native macOS provider now shows closed progress/error categories instead of
an indistinct busy screen and generic failure. The provider/host display Thingtime;
bundle identifiers, Keychain group and packaging paths remain stable. No confirmed
server mismatch or underlying cause of the historical installed failure is claimed.

Retry retains one registration key, credential, record and write identity. Request
fences reject queued clicks and stale completions. A changed session requires
Cancel/start again from the relying party; it cannot reuse the existing ceremony.
Catalog traversal has no arbitrary entry cap and refuses repeated cursors. Isolated
native build overrides must specify the complete distinct identity/output set.

Validation on 2026-10-27: root reported 19 Swift tests, two explicit opt-in skips,
zero failures; after final session-change recovery, five focused feedback tests
and an unsigned native host/extension build passed. Ordinary and isolated-identity
unsigned builds passed compilation/strict ad-hoc signature verification. Actual
ProviderView busy and confirming/indexing error states were inspected at compact
and wide sizes with Cancel reachable and no clipping. Build-script syntax and
diff checks passed. These are compilation and synthetic UI checks.

The existing installed app reported Connected after the normal reconnect action.
Signed updated active-provider registration on an independent relying party and
subsequent sign-in remain pending; no installed ceremony acceptance is claimed.
The stable installed app was not replaced during this branch work.

Graphify structural output was refreshed. Semantic extraction through the local
proxy exceeded a bounded 120-second deadline after partial chunk processing; its
task-owned process group was stopped, and changed Markdown semantic coverage is
not claimed. Structural fallback still regenerated portable report/graph/HTML.
