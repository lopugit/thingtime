# PR #710 — Verified vault credentials

2026-09-09 · `codex/vault-verified-reveal` → `main`

## Scope and security contract

The owner requested Show controls across the CI credential waterfall, admin external-integration vault and personal Secure Vault, with fresh password/passkey verification. Ordinary reads remain redacted; this is not a bulk export or a reusable authentication grant.

`POST /api/v1/vault/reveal` exposes capability `api.vault-reveal` 1.0.0. The closed request selects one vault and entry. Current full-account authentication, same-origin JSON, fixed fail-closed attempt limits and fresh current-password or required-user-verification passkey proof precede decryption. Admin roles are rechecked for CI/admin entries; personal lookups are owner-bound. Passkey tickets are two-minute, single-use and bound to the account, session, origin, relying party and item. Existing challenge indexes/TTL are reused; no database migration is required.

All responses, including errors, are private/no-store. UI values are transient, bypass application data caches/logging and clear after 30 seconds, closing, navigation, account change or leaving the tab. Local and secretless preview fallback must not forward verification material to another origin: both Vite and Nitro enforce this rule.

## Validation performed

- Sensitive-reveal 18 tests, passkeys 17, capabilities 23, fallback 3, plus existing admin-integration, CI-control and Lopu suites passed.
- Full Vercel build/output verification and touched-code ESLint passed against main `54498f166e12ac78a6ef94590343ac7b8bfdfb1f`.
- Typecheck ratchet remains at the existing 108-error baseline; this does not claim a clean full typecheck.
- Shared modal rendered with synthetic-only credentials at desktop 1280×900 and mobile 390×844. Verified wrapping/bounds, wrong-password and unavailable-passkey denial, Hide, delayed response after close, account switching and observed 30-second expiry. Temporary fixture files were removed before committing.
- Real local fallback request returns private HTTP 503 and does not consume or forward verification material.

Production password/passkey acceptance is a user-assisted release check, not proven by synthetic tests. Copying the two production Claude OAuth entries into dev is a separate operational action and was not completed by these code changes. Keep values out of logs, screenshots, git and chat; use the verified UI or an existing authenticated server-to-server path. Never copy ciphertext across distinct environment encryption keys.

Local validation URL: http://localhost:17340/admin/ci-control. Tailscale/Funnel is unavailable because the installed launcher targets a missing Tailscale app executable; no public mapping was changed. Fork-safe key setup is documented in the root README.
