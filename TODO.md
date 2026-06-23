# TODO

1. **URGENT HIGH PRIORITY: Make true `hydrateRoot(document, ...)` merge-ready.**

   Rollback checkpoint before deeper hydrate experiments: `61c234a` (`Fix Remix Emotion hydration styling`).

   The current PR fix keeps Emotion SSR styles in the React document tree and removes the visible unstyled-content jump. Remaining work: make local Vite dev-mode `hydrateRoot(document, ...)` pass without React document mismatch warnings/errors, then verify the same flow in production build/serve.

2. **Tighten verification-link origin trust.**

   Email verification links are still built from the request origin. Move them
   to a canonical `APP_URL` or explicit host allowlist before relying on real
   email delivery, so unexpected or spoofed hosts cannot generate verification
   URLs on the wrong origin.

3. **Remove legacy HS256 JWT fallback after ES256 migration.**

   Keep `JWT_SECRET` only long enough to verify browser cookies minted before
   ES256 signing shipped. After the 30-day auth cookie window, remove the
   fallback verifier and the legacy secret from deployment environments.

4. **Add revocation-aware token introspection for external platforms.**

   `/api/v1/auth/jwks` lets third parties verify token signature, issuer, and
   expiry offline. If an external integration needs live session revocation
   status, add a server-side introspection endpoint that checks Mongo sessions.
