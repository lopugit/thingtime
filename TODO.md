# TODO

1. **URGENT HIGH PRIORITY: Make true `hydrateRoot(document, ...)` merge-ready.**

   Rollback checkpoint before deeper hydrate experiments: `61c234a` (`Fix Remix Emotion hydration styling`).

   The current PR fix keeps Emotion SSR styles in the React document tree and removes the visible unstyled-content jump. Remaining work: make local Vite dev-mode `hydrateRoot(document, ...)` pass without React document mismatch warnings/errors, then verify the same flow in production build/serve.

2. **Tighten verification-link origin trust.**

   Email verification links are still built from the request origin. Move them
   to a canonical `APP_URL` or explicit host allowlist before relying on real
   email delivery, so unexpected or spoofed hosts cannot generate verification
   URLs on the wrong origin.
