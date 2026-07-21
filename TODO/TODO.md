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

4. **✅ FIXED — Add revocation-aware token introspection for external platforms.**

   Shipped on `claude/todo4-token-introspection-s3`: `POST /api/v1/auth/introspect`
   (`introspection.ts` + route) re-verifies the token then checks the backing
   Mongo session, returning `{active}` plus `sub/jti/exp/iat/purpose` — the
   online revocation half that `jwks` can't answer. App tokens report
   `purpose:'app'`+`client_id`; account sessions `purpose:'session'`+`username`;
   every invalid/expired/revoked shape returns an identical `{active:false}` so
   it's not an oracle. Anonymous like jwks but rate limited (`auth.introspect`,
   120/min/IP). Live-verified: a session token reports active, then `active:false`
   after logout. API doc + 2 apiTests added.

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

---

_Added 2026-07-08 after a full multi-agent codebase review (27 agents: 6 subsystem
readers, 3 finder tracks each adversarially verified, 3 idea lenses). Every item
below was confirmed by reading the cited code — file/line refs are load-bearing._

7. **🔒 URGENT SECURITY: lock down the unauthenticated admin/data endpoints.**

   Three live, prod-registered endpoints have **no auth, no rate limit, no env
   gate**:
   - `POST /api/v1/mongodb/raw-results`
     (`remix/app/routes/api/v1/mongodb/raw-results/_raw-results.tsx` L21–44) runs
     `things.find().toArray()` and returns **every** `things` doc — including
     `friends`/`family`/`private` posts — bypassing the `canView` /
     `visibilityQueryFor` gating in `things.ts`. Full data exfiltration by anyone.
   - `POST /api/v1/mongodb/populate` (`.../mongodb/populate/_populate.tsx` L24 →
     `scripts/mongodb/setup.ts`) lets any anonymous caller seed the DB with
     repo-known demo passwords and burn bcrypt/Mongo work per request (DoS
     amplification).
   - `POST /api/v1/auth/service-account`
     (`.../auth/service-account/_service-account.tsx` L8 →
     `serviceAccounts.ts` L48–109) mints a **non-expiring** bearer token
     (`signJwt expiresIn:null`, `createSession expiresAt:null`) with a **5 GB**
     storage allowance, with no caller check. Anyone can mass-mint permanent
     tokens. (Partial mitigation only: `getCurrentUser` L35–41 disables an
     *unverified* service token after a 7-day grace.)

   Gate all three behind an admin/service-account/session check (or dev-only env
   gate + remove from the prod dispatcher `remix/server/routes/api/[...].ts`
   L32–33), and add visibility filtering to any that stay.
   Full spec: `claude-todo/09-security-hardening.md`.

8. **🔒 SECURITY: add brute-force + abuse rate limiting to the auth endpoints.**

   `POST /api/v1/login` (`_login.tsx` → `loginUser.ts`) has zero throttling and
   the Nitro dispatcher adds no middleware, so credentials can be brute-forced at
   full speed. Same for `POST /api/v1/auth/register` and
   `POST /api/v1/auth/resend-verification` (unlimited verification-token minting),
   and `register` also has no body-size cap and stores caller-controlled `meta`
   verbatim (`registerUser.ts` L72). Reuse the existing Mongo-backed quota pattern
   (`consumeJoinQuota` in `waitlist.ts`, `consumeLopuMusingQuota` in
   `lopu/rateLimit.ts`, the `lopuMusingRateLimits` TTL collection) to 429 after N
   failures per IP/username window; cap body size; whitelist/bound `meta`.
   Full spec: `claude-todo/09-security-hardening.md`.

9. **🐛 DATA CORRUPTION: the persist reviver turns ordinary strings into Dates.**

   `ThingtimeProvider` (`remix/app/Providers/ThingtimeProvider.tsx` L30–34, used
   at L89 / L379–382) revives **any** string that passes V8's lenient
   `Date.parse` into a `Date` when rehydrating from localforage. Everyday values
   like `"Post 1"`, `"1"`, `"2024"`, `"March 2024"`, `"5 April"` become `Date`
   objects on reload; the replacer (L71–75) then rewrites them as ISO strings —
   **permanently corrupting user data after one save/reload cycle**, and Dates can
   reach React render paths. Fix: only revive a strict ISO-8601 pattern, or tag
   Dates in the replacer (mirror the existing `ttype:'function'` scheme:
   `{ttype:'date', iso}`) and revive only tagged values.

10. **🔒 SECURITY: persisted-state `eval` = arbitrary code execution on load; add a CSP.**

    Same provider revives `{ttype:'function'}` values by `eval(value.code)`
    (L39) plus a scoped `eval` (L53); the replacer serialises every function this
    way (L71–87) and the whole tree persists to IndexedDB every change (L435–438),
    revived on every load. With no CSP anywhere in the repo (`unsafe-eval`
    effectively allowed), anything that can write same-origin storage (an XSS, an
    extension, another tab) plants a payload that runs on every subsequent load.
    Stop `eval`-based function revival (drop function persistence or use a
    sandboxed/signed representation) **and** add a CSP without `unsafe-eval`.
    Full spec: `claude-todo/09-security-hardening.md`.

11. **🐛 Feed shows duplicate posts in ranked mode.**

    `Feed.tsx` `load()` (L79) appends pages with no id dedupe. Ranked pagination
    re-scores a moving 400-candidate window by numeric offset
    (`things.ts` L426–453), and the training flush every 8 s mutates weights
    (`algorithms.ts` L283–291), so ordering shifts between pages and the same
    `post.id` reappears on a later page. `PostList.tsx` L75 keys rows by
    `post.id`, so duplicates produce duplicate React keys + glitched rows. Dedupe
    appended pages against a `Set` of existing ids (and/or exclude served ids
    server-side for ranked pagination).

12. **⚡ `React.memo` on `PostCard` is defeated → every card repaints on scroll.**

    `PostList.tsx` L78 passes a fresh inline closure
    `onChanged={(next) => onPostChanged(post.id, next)}` per render, so the
    `React.memo` at `PostCard.tsx` L250 (default shallow compare) never bails.
    Every engagement event bumps `sessionEventCount`
    (`useFeedEngagement.ts` L73) → re-renders `FeedPage` → repaints **all** cards
    mid-scroll. Change `PostCard`'s prop contract to `onChanged(id, next)` (it
    already has `post`) or memoise a per-card wrapper. Apply to other `PostList`
    consumers (`ProfilePage`).

13. **🐛 Global Cmd/Ctrl+Z listener hijacks native text undo everywhere.**

    `useThingtimeMachine.tsx` `keyListener` (L93–140, mounted app-wide via
    `ThingtimeProvider` L149) `preventDefault()`s undo/redo window-wide with no
    guard for editable targets. Native undo is broken inside the post composer,
    comment boxes, and login form (a thingtime undo fires instead, mutating
    unrelated state). Bail when `e.target` is INPUT/TEXTAREA/SELECT/contentEditable
    or `e.isComposing`; also normalise `e.key.toLowerCase() === 'z'` (Shift+Z
    reports `'Z'`, making the redo branch at L101 unreachable in most browsers).

14. **🧹 Remove render-time debug leaks in the hot path.**

    `useThingtime.tsx` (L33–39, L46–57) pushes `{uuid, value, timestamp}` into an
    unbounded per-instance array on `window.useThingtimeScope` on **every render**
    of **every** consumer — a module-level object that leaks across SSR requests
    and grows for the life of the tab; nothing ever trims it and it ships in prod
    bundles. `ThingtimeURL.tsx` (L23–55) and `CommanderV2` (L337, per-keypress)
    also log on every render. Dev-gate or remove.

15. **🛠️ DX ratchet: add typecheck, a headless test runner, and CI.**

    `remix/package.json` has no `typecheck`/`test` script; `tsconfig` disables
    `strict`/`noImplicitAny`/`strictNullChecks`; no CI (`.github/` absent). The
    58+ API tests in `remix/app/tests/api/apiTests.ts` run only via the
    interactive `/tests` page, though `apiTestRunner.ts` is plain fetch and
    Node-portable. Add `"typecheck": "tsc --noEmit"`, a CLI runner
    (`remix/scripts/run-api-tests.mjs`) + `"test"` script, a CI workflow, then
    progressively enable strictness (start with `noImplicitAny`, fixing the
    untyped `args` in `useApi.tsx` L36/L47/L59). Also unify the two drifted
    `ThingtimeTypes` interfaces (`useThingtime.tsx` L9–19 vs
    `ThingtimeProvider.tsx` L11–20) and finish the Commander V1→V2 migration
    (`Thingtime.tsx` L6/L979–986 still renders `CommanderV1Deprecated`).

16. **🌈 Delight & growth ideas (features / design / easter eggs).**

    A curated catalogue of shippable delight — post/theme/algorithm sharing loops,
    a public theme gallery, the "raise your feed brain" algorithm-growth design, a
    live API playground on `/docs/api`, `Cmd+K` for the Commander, and a set of
    hidden easter eggs — all grounded in existing files/utilities.
    Full spec: `claude-todo/10-delight-and-growth-ideas.md`.
    (Several eggs from this list are **already shipped** in this branch — see the
    spec's "Shipped" markers.)
