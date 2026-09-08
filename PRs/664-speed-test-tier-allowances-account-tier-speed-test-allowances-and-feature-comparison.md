# PR #664 — Account-tier speed-test allowances

2026-09-06 · [Pull request](https://github.com/lopugit/thingtime/pull/664)

## Behaviour

- Default account budgets: Free 4 complete tests/hour, Plus 20/hour, Pro unlimited, PAYG unlimited. No new billing.
- Published tier revisions and protected account overrides are authoritative. Account budgets are shared across devices, credentials and IPs; five download requests and eleven serial upload chunks make a complete test. Partial attempts consume only their corresponding requests.
- Guest tests retain the existing 15-minute IP allowance. Invalid credentials never downgrade to guests. Authenticated latency pings bypass the guest bucket so Pro has no hidden preflight cooldown.
- Settings → Account displays the live plan comparison. Admin tier and subscription editors expose the same allowance. Existing immutable PAYG revisions lacking the field remain readable without database edits.
- Commander binds credentials to the selected origin/client/account and refuses redirects. Rejected zero-sample retries retain the last successful readings; switching account/server clears old readings.

## Evidence

- Commander: 207 tests and workspace typecheck passed; final daemon rerun: 80 tests plus daemon typecheck passed.
- Tier, limiter selection, authentication and packet-route tests: 27 passed. API manifest/network payload tests: 14 passed.
- Vite client/embedded bundle and Nitro Vercel builds passed. Built server manifest returned the six updated contracts.
- Focused ESLint passed. Web typecheck ratchet: 108 existing errors, no increase; raw web typecheck still fails at that baseline.
- Chrome verified the real four-plan comparison at desktop and 390px mobile, including top-to-bottom settings scroll and bounds checks. Local Chrome is logged out, so admin save flows were not exercised.
- Installed native app remains unchanged. Authenticated native production testing waits for compatible server rollout; no account tier, price, or billing data was changed for testing.

## Release and local validation

Deploy server before new Commander: ping/download require 1.1.0; upload requires 2.1.0. Tier and admin allowance contracts are 1.1.0. Old origins fail capability negotiation before transfers.

This PR is open, not merged. Local comparison: http://localhost:18580/settings#plan-features. PM2 has one worktree process with autorestart disabled, Vite/HMR/Nitro on 18580/18581/18582. Funnel is unverified because the local Tailscale launcher targets a missing app binary. See the PR checks/body for current Vercel preview status.
