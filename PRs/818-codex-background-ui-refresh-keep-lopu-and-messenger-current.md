# PR #818: Keep Lopu and Messenger current

Quiet shared polling refreshes mounted Lopu conversations, messages, tasks, credits, Messenger and root session data. Focus, visibility, reconnect and restored-page events catch up without clearing existing content. Hidden tabs use slower timers; browsers may suspend timers, so return-to-tab refresh is the freshness boundary.

Account generations and local-write guards reject stale responses. Deleted or inaccessible conversations clear their cached timeline. A real browser deletion test exposed missing HTTP status propagation in Messenger; the shared JSON reader now preserves status and has a regression test.

Validation: 159 Lopu, 58 Messenger, 55 hooks and 23 root-data tests passed after integrating Messenger filtering. Production build and Vercel output checks passed. Exact-commit Web CI passed on f19b5acb4; subsequent main integration must pass required checks before merge. Existing standalone TypeScript diagnostics remain outside the changed files; CI uses the repository ratchet.

Chrome desktop/mobile checks verified new messages and conversations appearing without reload, returning-tab catch-up, preserved selection, opened conversation drawer, Messenger rendering and deletion cleanup. Disposable conversation fixtures were removed. Live model inference was not needed for these synchronization checks.

Local: http://localhost:17110/lopu (HMR 17111, Nitro 17112). Tailscale/Funnel is unavailable because its installed launcher targets a missing Tailscale app. Preview: https://pr-818.previews.dev.thingtime.com/lopu.
