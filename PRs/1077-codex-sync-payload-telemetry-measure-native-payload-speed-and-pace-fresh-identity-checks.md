# PR 1077: Measure native payload speed and pace fresh identity checks

The current native upload adapter omits accepted PUT byte measurements, leaving
speed unavailable. Native indexing, transfer and monitor callers also spend the
same device credential's identity limit independently; one bounded live
10-minute window recorded eight identity HTTP 429 events. This is not total
traffic and does not establish the complete throughput bottleneck.

Mac `fileUploadVersion` 1.1.0 adds `uploadedPart.payloadBytes` only after a
successful PUT and existing final source/authority checks. The trusted adapter
requires this exact positive part length; old, missing or malformed telemetry
stays unknown. Whole-file/background requirements remain 1.2/1.3. Known coverage
starts before the current part, lost replies mark it unknown, server-ready
uploads add zero and canonical receipt replays add no payload. Multipart
completion offsets are never counted as network traffic. Repeated actual PUTs
can produce new accepted payload samples; unobserved lost-reply bytes are not
reconstructed. Unknown intervals recover independently per direction without
resetting logical entry counters, the other direction or saved units/windows.
The UI identifies completed-part acknowledgment samples and actual shorter
coverage. This is not continuous in-flight or wire-byte measurement.

Native identity admission is scheduling only: origin/device-credential scoped,
bounded FIFO, fresh HTTP with at least 334 ms completion spacing and shared
bounded Retry-After cooldown. Every sent request still reloads credentials and
performs the existing fresh owner/device/origin checks. Cancellation, rotation,
timeout, capacity and stale/failed wake timers are covered. No HTTP request
contract, rate limit or authorization requirement changes; no response cache.

## Verification

- Shared file-sync: 534/534 plus one structural transport contract passed.
- Electron folder upload/sync: 48/48 passed.
- Native focused admission/API-client suite: 73/73 passed.
- Focused telemetry: 67/67 passed, including IDB close/reopen after a lost PUT
  reply, original IDs, multipart lengths, no retained-offset inflation,
  unsupported adapters and malformed metrics, sub-second coverage recovery,
  opposite-direction/inode preservation and pause/resume without a spike.
- OS-isolated Chromium: desktop 1440/mobile 390 full scroll, no horizontal
  overflow, nested Builder editing and saved/reopened units/windows passed.
  A requested 10-second window displays upload 1 second/download 10 seconds
  measured after the unknown upload interval.
- Focused ESLint passed. Canonical typecheck ratchet passes with 92 pre-existing
  diagnostics versus baseline 89; no diagnostics in owned telemetry files.
- Structural graph refreshed; Markdown semantic freshness remains unverified.

No signed build/install is part of this publication. Installed numeric accuracy,
continued same-job payloads and practical throughput remain acceptance gates.
Preserve the existing Home run, receipts, source files and grants.
