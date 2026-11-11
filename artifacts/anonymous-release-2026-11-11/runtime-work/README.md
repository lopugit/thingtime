# Runtime shutdown foundation checkpoint — 11 November 2026

Latest fetched main `991a3d9d6` is already merged by pushed `b5b70e0c8`.
This follow-up adds a synchronous in-process shutdown reservation over the
existing request/background-work tracker. Reservations wait for pool drains,
refuse new work while held, and release safely. The compiled Nitro plugin and
retryable HTTP refusal/recovery are exercised by the production-format handler.

Four formerly detached paths now retain their real completion: Messenger recent
reactions, deployment-login revocation, underlying error-log persistence after
its response timeout, and background-task heartbeats before terminal save.
Full local-mode automatic activation remains disabled. Notification/email,
moderation, backups and streamed/timeout cleanup still need complete coverage,
then host integration and actual installed acceptance.

Validation: 18 gateway/lifecycle plus 38 detached-work regressions pass, with no
skips. TypeScript and zero-error ratchet pass. Full lint has 0 errors / 371
warnings (the new source-extraction test adds one Function-constructor warning).
Production-format build, 27 compiled API contracts and compiled lifecycle
reservation/refusal/recovery pass. The database is intentionally unreachable;
this is not a persistence acceptance run. The progress plan passes isolated
Chromium at 1440, 390 and 320px with full scroll/filter/search/navigation checks.

The native verifier's final attempt stopped before app launch on a temporary
concurrent source syntax error, subsequently repaired. Its corrected AX-timeout
observation remains unexercised. No automatic restart or retained-data readback
is claimed. See [native attempt](../native-auto-activation/README.md).

[Checks and source hashes](verification.json) · [Plan verification](plan/verification.json).
CI and preview for the parent merge are separate from this follow-up. No main
merge, production activation, stable-app replacement or public posting occurs
in this checkpoint. Graphify is refreshed structurally; new semantic indexing
remains unavailable after the earlier bounded backend failure.
