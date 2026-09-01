# TODO

## Priority 1 — Fundamental product behavior

- **Preserve and revisit any meaningful app, search, or generated-feed state.**

  Thingtime should automatically retain timestamped, versioned experience
  snapshots so a user can return to a remembered moment instead of losing a
  useful search, feed generation, recommendation set, navigation context, or
  scroll position when they leave the app. Restoring history must be
  non-destructive, privacy-aware, and able to distinguish an exact historical
  replay from a fresh rerun of the same query or algorithm.
  Full spec and Bambu Studio reference screenshot:
  `claude-todo/20-versioned-experience-history.md`.

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

---

_Added 2026-07-08 after a full multi-agent codebase review (27 agents: 6 subsystem
readers, 3 finder tracks each adversarially verified, 3 idea lenses). Every item
below was confirmed by reading the cited code — file/line refs are load-bearing._

7. **🔒 URGENT SECURITY: lock down the unauthenticated admin/data endpoints.**
   _✅ Done 2026-07-21: raw-results and populate became admin-only + rate-limited
   fail-closed in earlier PRs; service-account provisioning (public by design)
   is now rate-limited fail-closed per IP, body-capped, and field-whitelisted —
   see `claude-todo/09-security-hardening.md` §A._

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

8. **✅ FIXED — 🔒 SECURITY: brute-force + abuse rate limiting on auth endpoints.**

   Login and resend-verification use the shared, admin-tunable IP limiter and
   size-capped body reader. PR #167 added the canonical `auth.register` rule at
   10 attempts per 15 minutes per IP; PR #99 leaves that rule unchanged and adds
   the remaining 16 KiB streaming registration body cap. Public registration
   continues to whitelist accepted fields rather than forwarding caller `meta`.
   Full rationale and the earlier §A closure: `claude-todo/09-security-hardening.md`.

9. **✅ FIXED IN PR #99 — 🐛 persisted strings no longer corrupt into Dates.**

   The active persistence serializer tags real Dates and never infers a Date
   from an untagged string. Ambiguous legacy ISO values remain text rather than
   risking user-data corruption; known date fields can migrate schema-aware.
   This keeps Dates and identical-looking user text distinct across new repeated
   save/reload cycles. Malformed tag-looking user objects are preserved,
   functions are dropped, and the real flatted codec is covered by focused
   regression tests.

10. **✅ FIXED IN PR #99 — 🔒 persisted-state code execution removed; strict CSP added.**

    Persisted functions are no longer serialized, legacy `ttype:'function'`
    payloads are dropped without execution, and the application policy omits
    both inline script execution and `unsafe-eval`. Pre-paint boot code now comes
    from same-origin `/tt-boot.js`; only repository-controlled design bundles get
    a path-scoped runtime-compiler exception inside an opaque-origin sandbox.
    Commander assignments now parse data literals without `eval`. Unused
    smarts dynamic-code modes remain blocked by CSP; any future executable
    command design must use an explicit safe registry or isolated sandbox rather
    than weakening the whole application policy.
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

15. **🟡 MOSTLY DONE — 🛠️ DX ratchet: add typecheck, a headless test runner, and CI.**

    Shipped on `claude/dx-test-runner-ci` (PR #121, consolidating the parallel
    PRs #119/#123/#126): a headless CLI runner
    (`remix/scripts/run-api-tests.mts`, `npm run test:api`) that reuses the
    canonical `apiTests.ts` + `apiTestRunner.ts` the interactive `/tests` page
    uses; a `test:unit` aggregate whose `node --test` suites load through tsx
    (fixing the previously-broken `~/`-alias suites and covering the
    scriptless `collectionNames.test.ts`); `typecheck` plus a
    `typecheck:ratchet` that fails only when the tsc error count grows past
    `scripts/typecheck-baseline.json`; and `.github/workflows/web-ci.yml`
    (build + ratchet + unit tests, and the full API suite against a real
    Vite + Nitro + Mongo stack). **Still open:** progressively enabling tsc
    strictness to burn the baseline down (start with `noImplicitAny`, fixing
    the untyped `args` in `useApi.tsx`), and finishing the Commander V1→V2
    migration (blocked on PR #130; `ThingtimeTypes` was unified in PR #153).

    Original report: `remix/package.json` has no `typecheck`/`test` script; `tsconfig` disables
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

17. **🔗 Unique account invite links with optional profile prefill.**

    Let a signed-in user generate a unique, revocable URL for another person to
    create a Thingtime account. The inviter may optionally suggest a username,
    profile name, description, profile image, and banner image; the recipient
    reviews and can change every suggestion before registering through the one
    canonical account-creation path. Keep the URL opaque, single-use, expiring,
    non-enumerable, and unable to grant privileges.
    Full spec: `claude-todo/18-account-invite-links.md`.

18. **🕶️ Anonymous participants in group chats.**

    Extend the existing Messenger group flow so the creator can add friends or
    any eligible users and toggle anonymity per participant, including
    themselves. Invitees still see the real username of the person who invited
    them, but anonymous members' messages and all in-chat identity surfaces use
    privacy-safe, chat-local representations with no global account ids or
    profile links. Preserve server-side moderation and state the honest limits
    of anonymity.
    Full spec: `claude-todo/19-anonymous-group-chats.md`.

19. **⚡ Run actions from the component tester.**

    _✅ Approved 2026-08-25 by the repo owner: the tester should fire._

    A component's `ttAction` control is inert on `/components/:key`, because
    the catalog renders the resolved template directly through the sanitising
    renderers and never mounts the click wrapper; `/things` PreviewModal is the
    only firing surface today. Make the live preview and the args tester run
    the bound action as the viewer, with the tester's current arguments
    reaching the action inputs, behind a confirmation that names what will run.
    The browse grid must stay inert — one preview component renders the feed,
    grid, and columns views, so arming it arms an infinite scroller — and the
    confirmation, never the author-controlled button label, is the source of
    truth about what executes. Since the 2026-08-25 security review the
    delegated run path is owner-pinned, so foreign markup can only ever name
    one of the viewer's *own* actions — with author-chosen inputs, and a bare
    key is exactly the case the dialog cannot resolve client-side. Ownership
    therefore sets confirmation strength rather than acting as an on/off
    switch: a component the viewer did not author always confirms, with no
    skip.
    Full spec: `claude-todo/20-tester-runs-actions.md`.

20. **📁 Composed app surface for Data + Component + Action programs.**

    Give a folder of Things a runtime view: open it as a composed page that
    renders its component things live against their saved arguments, with
    `ttAction` controls firing, so the folder reads as a working mini-app
    rather than a list of parts. Every element stays traceable to its Thing and
    `/things` stays the editor. The `app` kind and the root `appId` scalar are
    already taken by the third-party OAuth client namespace, so express
    app-ness as a view over an existing folder rather than overloading the
    client-identity control plane.
    Full spec: `claude-todo/21-app-composition-surface.md`.

21. **🌱 Define and prove a trustworthy adoption loop.**

    Thingtime has many useful creation, search, history, sharing, component,
    action, invite, and composed-app ideas, but no shared definition of healthy
    adoption. Approve one first-value journey, useful-return metric, privacy-safe
    learning contract, consentful sharing gate, accessibility/reliability
    guardrails, and aligned sustainability path before optimizing acquisition.
    Raw signups, page views, time-on-site, and content volume are not north-star
    outcomes. Start with the evidence note and phased roadmap, then execute the
    bounded epic in `claude-todo/22-trustworthy-adoption-loop.md`.
