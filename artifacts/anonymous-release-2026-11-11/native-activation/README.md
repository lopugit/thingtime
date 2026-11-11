# Native activation checkpoint — 11 November 2026

Base source: `830da4a56f78c01da411281db733b8259527d73d`, with main through
`4650f5af2ebeb7e32d7e9e58339b0b3a8bf851d1`. This checkpoint includes the restored
native activation work and runtime/server admission follow-up.

The source now obtains a renderer persistence checkpoint, reserves HTTP and
ChatGPT runtime admission synchronously, and retains those reservations across
an unresolved close. Ordinary user work cancels before close starts; close veto
releases the gates. Accepted close blocks replacement windows until relaunch.
Streams, disconnected-handler cleanup, websocket sessions, queued model/storage
operations and pending OAuth block reservation. No credentials cross this bridge.

Full local API mode remains pending: detached Lopu transcript/accounting and
notification jobs can outlive an HTTP response. Their admission lifecycle must
be integrated before claiming that mode is safe for automatic activation.

## Verification

- Raw TypeScript and zero-error ratchet pass; full lint has 0 errors / 370 warnings.
- Canonical Electron `build:web` passes, including real web/Nitro bundle inventory
  and desktop MCP build. The development app was prepared from final source.
- Focused renderer persistence/safety checks: 13 passed. Runtime checks: 22 passed.
  Embedded HTTP admission checks: 23 passed.
- The first full Electron suite exposed five stale source-extraction harnesses
  after the main-process refactor (518 passed, 5 failed, 5 skipped). Their repair
  retained and strengthened the original quit/relaunch/password assertions. The
  final full suite passes **523 tests, 0 failures, 5 explicit skips**; see
  `verification.json`.
- [Actual installed startup/rollback](startup/verification.json): passed with
  real Nitro/React acknowledgment, React error refusal, fresh-process recovery,
  stable profile origin and verified cleanup. Synthetic signing is confined to
  the separate development app; stable Thingtime and production trust unchanged.
- [Plan browser checks](plan/verification.json): desktop1440, phone390 and320;
  full scroll, layout, counts, filters and navigation; browser/server cleaned up.

## Acceptance still required

The installed startup fixture intentionally runs managed local mode. It does
**not** prove positive live automatic activation. Add a separate remote-mode
fixture on the same isolated development lane, configure its runtime through
supported controls, and deliver a signed synthetic release through the actual
API downloader after startup. Show that dirty input keeps process/release
unchanged; saving and backgrounding the app permits a fresh process with the
same origin and durable data. Do not stage files into a running profile or call
manual restart and label it automatic.

External frozen-process recovery, real signing/publication, deployed bundle
catalogue/download acceptance and iOS runtime/storage/device integration remain
independent. The canonical connected Thingtime tool catalogue still exposes no
render/export artifact tool in this chat. No primary merge or production
activation occurred in this checkpoint.
