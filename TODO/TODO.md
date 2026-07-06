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

5. **Replace Vercel status polling with Vercel webhooks.**

   The footer status can poll while a deployment is actively building, but
   ready deployments should not keep spending Vercel API calls just to detect
   a future build. Add a Vercel webhook endpoint for deployment created/ready/
   failed events, persist the latest project status server-side, and have the
   footer/dashboard read the cached status instead of polling Vercel directly.

6. **Add cross-tab sync for persisted thingtime state.**

   `ThingtimeProvider` (`remix/app/Providers/ThingtimeProvider.tsx`, persist
   effect around lines 420–450) persists the ENTIRE thingtime object to
   localforage on every state change, and loads it only once on mount. With
   two tabs open on the same origin, each tab's writes clobber the other's
   (last-writer-wins), and neither tab sees the other's changes until reload —
   observed live: a second dev tab reverted drawer settings
   (`thingtime.settings.drawer.*`) written by the first. Design and implement
   cross-tab sync, e.g. a `BroadcastChannel('thingtime')` that publishes
   changed paths and applies them in other tabs via the existing `setThingtime`
   queue with `ignoreUndoRedo`, or storage-event-driven reload of changed
   subtrees. Follow `FUNDAMENTALS.md` and keep the single persist path in
   `ThingtimeProvider`. Full spec: `claude-todo/07-cross-tab-thingtime-sync.md`.
