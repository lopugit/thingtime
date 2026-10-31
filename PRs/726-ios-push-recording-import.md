# PR 726 — Import older Lopu recordings and restore iPhone push

Older local CAF recordings are claimed once for the signed-in account and
selected origin, then uploaded through the existing private attachment outbox.
Completed receipts remain local. Build 29’s retained M4A metadata is reconciled
against paginated owned Things before a new upload; imports without an encoded
file enqueue immediately, so a large library does not need to finish conversion
before the first upload starts. Local source files remain intact. Automatic
import is enabled by default and can be paused in Voice settings.

Native APNs registration now works independently of notification-history
decoding. The app negotiates an explicit capability requirement map, checks the
current account, retries registration after permission changes, and shows status
and reconnect controls under Settings → Notifications. API diagnostics expose
only account-owned counts and sanitized delivery outcomes. Single and bulk push
work is attached to Vercel request lifetime. Bulk social events now invoke APNs;
muted/history-only events still suppress delivery.

The bell uses Chakra’s toggle trigger, listens for notification events and
checks every 15 seconds while visible. Cached rows survive reopening. Tests no
longer silently ignore a click during background refresh or immediately erase
its delivery result.

## Validation

- 59 notification unit/route tests, 26 legacy capability tests and 111 Lopu UI
  tests pass; typecheck remains at the repository baseline of 108 errors.
- GitHub build/unit and headless API checks pass on the first implementation.
- iOS build-for-testing compiles. Simulator execution and build 30 release
  acceptance are tracked separately from compiler success.
- Browser checks at 390×844 and desktop: bell open/close, long popup scrolling,
  and the enabled-by-default import switch (off/on) render correctly. Local API
  latency under extreme host load limits live push diagnosis until deployment.
- The local semantic graph service is unavailable; code graph refresh and
  portable outputs use the structural fallback. Changed documentation is not
  newly semantically indexed.

The TestFlight workflow now runs the native XCTest suite on its clean Mac
runner before any signing or upload and preserves its result bundle. This
keeps release validation independent of local simulator/process overload.

Physical iPhone notification presentation must be checked after Apple accepts
a test. A provider 200 response does not prove a banner appeared. Older files
without account metadata are assigned to the account used for their first
import; subsequent retries and receipts retain that account/origin binding.
