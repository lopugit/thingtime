# Measure closed native sync request phases

The installed backup now executes priority-one paths, but practical small-file
throughput remains poor. One authorized 20-second helper sample exposed active
background polling/index writes and brief identity/code validation; it did not
establish async per-file wall time. Existing native logs time HTTP only after
admission and omit fast first-attempt 200 checks; existing desktop diagnostics
recorded failures only. This adds bounded timing observations without another
source/auth/upload optimization.

Electron emits at most one closed timing row per admitted work request, with
monotonic queue/account/capability/native/reply/total durations and repeated-call
counts. Account time overlaps reply validation; native waits include bridge and
service work. They are not additive wall-time attribution. Native identity logs
retain their prefix/HTTP fields, append measured admissionMs and surface slow
admission even for fast 200 responses. They remain a suppressed, partial sample.

The existing 128 KiB rotated desktop log now uses a 128-row asynchronous FIFO;
transfers never await disk IO. Closed own data scalars only, bounded times/counts,
no paths/URLs/request or account IDs/raw errors. Overflow, rotation, failed writes
and shutdown can lose rows. No endpoint, UI, native payload, authorization,
source fence, retry, receipt or transfer result changes.

## Verification

- Electron host/upload/log tests: 55/55, including real part guard sequence,
  repeated account/native timing, independent waiter/FIFO admission, one-flush
  cancellation/failure, bad clocks/sinks, numeric bounds, redaction and rotation.
- Native API-client/admission tests: 33/33, including actual queued admission
  versus HTTP duration, fast-success suppression and malformed clock safety.
- Existing native folder/source/authority/recovery suite: 42/42.
- CJS syntax and owned whitespace checks passed. No frontend changed; no extra
  browser or signed build/install is part of source verification.
- Structural graph refreshed; Markdown semantic freshness remains unverified.

Installed acceptance requires one bounded natural window, phase distributions
with captured counts and explicit missing-data limits. No bottleneck or speed
restoration claim is justified by synthetic delay tests alone.
