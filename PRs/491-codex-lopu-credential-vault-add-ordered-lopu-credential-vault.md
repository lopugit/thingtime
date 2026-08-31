# PR #491 — Add an ordered Lopu credential vault

Branch: `codex/lopu-credential-vault`

## Scope

- Store up to eight named Claude Code OAuth credentials in the encrypted Thingtime admin vault.
- Let admins add, rotate, enable, disable, delete, and reorder the Lopu usage waterfall without exposing credential values back to the browser.
- Serve the enabled ordered bundle only to HMAC-authenticated, replay-protected Lopu controller runs from allowlisted workflow refs.
- Bootstrap the empty vault once from the two transitional GitHub OAuth secrets, allowing those account-specific secret names to be removed after live verification.

## Security boundaries

- Encrypt every credential independently with AES-256-GCM and vault-specific authenticated data under `THINGTIME_ADMIN_VAULT_KEY`.
- Keep one stable GitHub secret, `THINGTIME_CI_ROUTER_SECRET`, as the machine authentication boundary.
- Reject stale timestamps, duplicate nonces, malformed run identity, unexpected repositories, refs, workflow files, credential types, and oversized values.
- Return metadata only from the admin API; plaintext is available only inside the authenticated controller response and is immediately masked and cached with mode `0600` in the runner temporary directory.

## Validation log

- 2026-08-31: 24 CI Control tests passed, including signed-request parsing, workflow allowlisting, order validation, and bootstrap validation.
- 2026-08-31: MongoDB collection and schema tests passed, including the new `lopuCredentials_v1` collection and unique index.
- 2026-08-31: capability registry, route coverage, targeted ESLint, TypeScript ratchet, production build, and Vercel output verification passed.
- 2026-08-31: the local admin route returned HTTP 200. Authenticated desktop/mobile interaction QA and the live one-secret migration proof remain deployment gates.
