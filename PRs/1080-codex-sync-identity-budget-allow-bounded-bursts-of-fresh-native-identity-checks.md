# Allow bounded bursts of fresh native identity checks

Installed closed timings locate substantial time inside native requests:
upload-part median 6040 ms total/5211 ms native (11 rows), context 1670/1541
(45), inspect 1773/1623 (21), read 1852/1724 (31). Median host queue/capability
time was zero. Suppressed native identity records showed ordinary HTTP
46–531 ms versus admission 1046–1680 ms and one 11950 ms admission. These are
partial, overlapping, non-job-correlated observations rather than a census.

The actor replaces its fixed 334 ms post-completion gap with a 12-token burst,
three-token/second refill AND a hard 180 charged attempts per rolling 60 seconds.
One active permit and FIFO lanes remain. Completion after willSend charges both
token and retained timestamp, conservatively covering a delayed actual HTTP
start. Before-willSend cancellation is free; after-willSend cancellation remains
charged even in the pre-URLSession gap. No API-client source/auth fence changes.

Eviction cannot forget any live rolling history, token debt or server cooldown,
even when another request is currently eligible. Bounds remain 180 timestamps
per scope/64 scopes/128 waiters; full/depleted guards remain blocked if floating
deadline arithmetic rounds to now. Shared canonical Retry-After/custom lower
limits remain authoritative. The documented server default is 240/minute; the
actual deployment limit was not read. No server rate-limit, response cache,
singleflight, native payload, credential or signature-policy changes.

## Verification

- Initial-burst regression failed against the old scheduler (12 zero-duration
  attempts imposed 3.674 seconds); new initial burst is immediate and the 13th
  waits for refill. At least 240 attempts verify every rolling window and token
  burst bound, including floating-point boundaries.
- Focused admission/API-client suite: 39/39. Covers delayed send/completion,
  both cancellation boundaries, shared lanes/public clients, live budget-safe
  eviction, timer debt/cooldown recovery and unchanged fresh identity rejection.
- Full native package: 220 tests, zero failures, two explicitly gated hardware
  checks skipped (brightness mutation and live menu-bar inventory).
- Actual old/new fake-clock 26×100 ms HTTP fixture: 10.95 s→4.866668 s. Proof
  artifact /tmp/sync-identity-budget-schedule-proof.json is local verification,
  not a prediction or installed throughput claim.
- Structural graph refreshed; Markdown semantic freshness remains unverified.

One natural installed window must still compare phase distributions, observed
identity cooldowns and confirmed file/payload deltas on the preserved job. No
app build/install or user-data mutation occurs during source verification.
