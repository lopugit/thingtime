# PR #494 — Promote the ordered Lopu credential vault to main

Branch: `codex/lopu-credential-vault-main`

## Scope

- Promote only the encrypted credential-vault API, admin UI, capability contract, schema/index registration, tests, and setup documentation from merged PR #491.
- Keep the production change independent of unrelated `develop` history.
- Preserve the one-time controller bootstrap boundary; deletion of the two account-specific GitHub secrets remains gated on two live no-model verification runs.

## Validation log

- 2026-08-31: 24 CI Control, 16 collection, 63 schema, 2 capability, and 3 TypeScript-ratchet tests passed on the current `main` baseline.
- 2026-08-31: targeted ESLint passed for every changed TypeScript/TSX file.
- 2026-08-31: the full production build and Vercel output verifier passed.
- 2026-08-31: semantic Graphify extraction used the local Codex proxy and refreshed the immutable main-branch snapshot.

## Live migration gate

1. Merge and wait for the production deployment containing both new API routes.
2. Merge PR #492 into `github-actions` and dispatch `verify-credential-vault` once with the transitional OAuth secrets present.
3. Verify the admin metadata API reports the expected two named ordered credentials without returning values.
4. Delete `CLAUDE_CODE_OAUTH_TOKEN_THINGTIME` and `CLAUDE_CODE_OAUTH_TOKEN` from GitHub.
5. Dispatch the same no-model verification again and require success using only `THINGTIME_CI_ROUTER_SECRET`.
