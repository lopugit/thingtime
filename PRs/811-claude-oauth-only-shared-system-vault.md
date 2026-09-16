# PR 811 — Shared System vault and OAuth-only Claude

https://github.com/lopugit/thingtime/pull/811

## Problem and behavior
Lopu used the server Anthropic API key instead of the Claude OAuth credentials already stored in CI Control, then silently switched a selected Claude chat to GPT-4o mini when the key failed.

Claude now uses the existing shared OAuth vault through the pinned, isolated Claude Code runtime. Explicit chat selections keep their model, effort and speed; failure remains visible without switching providers. Existing credential IDs and order are preserved, and CI reads the same store.

Admin → System now manages platform credentials, integration secrets and the configured Thingtime Vercel environment. Lists contain metadata only. Showing a value requires fresh password/passkey verification; Vercel sensitive values stay write-only. CI Control links to System for management.

## Validation
- Targeted AI, chat/musing streaming, moderation, recording, credential, reveal, environment and capability tests pass.
- Production build and built-server capability manifest smoke pass; packaged runtime starts successfully (2.1.272). Local function package: 131 MiB.
- Real Opus 5 high and tool-call checks passed using the local Claude OAuth login. The exact existing CI-vault tokens still require a deployed production check.
- Desktop and narrow mobile UI checked with synthetic metadata, including long keys, replacement forms, dropdowns and failed password verification. No live credentials were changed by UI tests.
- Owned-file ESLint: no errors. Full TypeScript check still has existing baseline errors; no errors remain in the new OAuth/System-vault modules or changed chat lines.

## Rollout
Production is unchanged. Merge/deployment and an exact stored-vault OAuth reply check remain pending. After that proof, remove the retired ANTHROPIC_API_KEY deployment variable. README includes fork-safe setup and environment scope.

## Local verification environment

Worktree: `thingtime-claude-oauth-only`. Web: http://localhost:15080, Nitro: 15082, HMR: 15081. The existing Tailscale launcher points to a missing application, so no Funnel URL could be verified. The local PM2 entry has zero restarts and autorestart disabled.

The source-owned UI fixture was removed before publishing. Test metadata never changed server roles, production vault entries or deployment variables.
