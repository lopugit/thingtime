# PR #782 — Clear Feature Stack progress and Ask Lopu

2026-09-12. Product PR: https://github.com/lopugit/thingtime/pull/782

A Feature Stack can currently sit at 99% while a target PR conflicts and another worker has failed. CI Control now shows a separate target card for current work, waiting, conflicts, failures and confirmed merges, with the next step and source link. Only merged targets count toward progress; the moving finish estimate is removed. Fresh repair work remains distinct from a waiting merge gate, including legacy heartbeats, and the stack editor heading now wraps on mobile.

Adds an expandable **Ask Lopu about this run** conversation. Questions reach an optional status responder inside the matching GitHub Actions run, with queued/answering/answered/failed and offline/ended states. This is status Q&A alongside the workers; it cannot change their merge plan or inject into their private reasoning session.

The two private routes have explicit origin-scoped 1.0.0 capability contracts, admin-only reads/writes, per-admin rate limits, signed exact-run worker delivery, monotonic attempt fencing, expiring leases, stable retry IDs and protected relational records retained for 90 days. No credentials or delivery leases are returned to the browser.

Validation:
- 74 CI Control tests (69 core/UI models + 5 route/store delivery tests), 40 capability tests and 191 schema tests pass.
- Production build and Vercel output verification pass; the built server's origin-scoped manifest advertises both new chat contracts.
- Focused lint passes. Typecheck stays at the existing 108-error baseline.
- Chrome at 1440px and 390px: full-page scroll and overflow checks; expanded chat, replies, offline/legacy states and accepted-but-lost Send retry using an isolated in-memory run fixture. Actual local admin route retained its access gate. No real stack was dispatched or changed by these tests.
- Documentation and content-addressed Graphify outputs refreshed.

Controller companion: https://github.com/lopugit/thingtime/pull/781 (target `github-actions`). Deploy this product change and roll out that controller, then start a new stack run. Existing running actions cannot acquire chat retroactively. A live model response through the deployed mailbox remains a post-rollout acceptance check.

Local dev: http://localhost:17160/admin/ci-control. Tailscale/Funnel could not be verified: the installed CLI launcher points to a missing Tailscale.app. Preview not yet published; follow https://github.com/lopugit/thingtime/pull/782/checks.

Local worktree mapping: Vite 17160, HMR 17161, Nitro 17162. The PM2 process uses the stable base tt-wt-stack-progress-chat-17160 with autorestart disabled. Tailscale/Funnel is unavailable because the CLI launcher targets a missing /Applications/Tailscale.app bundle.
