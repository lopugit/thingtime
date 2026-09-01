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

2. **🟡 MOSTLY FIXED — Tighten verification-link origin trust.**

   Shipped (verified on main 2026-07-21, re-verified 2026-08-29):
   `remix/app/api/utils/auth/appOrigin.ts` `resolveTrustedOrigin` prefers the
   server-configured `APP_URL`.

   **Still open — this is not just an ops checkbox.** When `APP_URL` is unset
   the helper falls back to `new URL(request.url).origin`, i.e. the
   caller-controlled `Host`, so the spoofing vector this item describes is still
   live in exactly the deployments that lack `APP_URL`. Closing it takes both
   the ops step (set `APP_URL` in production/preview) **and** the code-level
   fallback hardening owned by PR #105
   (`claude/todo2-verification-link-origin-s3`), which resolves the origin from
   platform-injected values and a narrow Host allowlist instead of the caller.
   Do not mark this item done on the `APP_URL` preference alone.

3. **Remove legacy HS256 JWT fallback after ES256 migration.**

   Keep `JWT_SECRET` only long enough to verify browser cookies minted before
   ES256 signing shipped. After the 30-day auth cookie window, remove the
   fallback verifier and the legacy secret from deployment environments.

4. **Add revocation-aware token introspection for external platforms.**

   `/api/v1/auth/jwks` lets third parties verify token signature, issuer, and
   expiry offline. If an external integration needs live session revocation
   status, add a server-side introspection endpoint that checks Mongo sessions.

5. **Replace Vercel status polling with Vercel webhooks.**

   ✅ **Code shipped 2026-07-21** (`claude/vercel-webhook-status`): signed
   webhook receiver at `POST /api/v1/vercel/webhook` (HMAC sha1 over the raw
   body, 404 when `VERCEL_WEBHOOK_SECRET` unset), latest status persisted per
   git branch in the `settings` collection (`vercelWebhookStatus`, capped at 30
   branches), and `getVercelDeploymentStatus` serves ready/error/canceled from
   the persisted doc with zero Vercel API spend — mid-build states still live
   poll for phase/progress. Remaining one-time setup (owner): create the
   webhook in the Vercel dashboard for deployment created/succeeded/error/
   canceled events pointing at `/api/v1/vercel/webhook`, and set
   `VERCEL_WEBHOOK_SECRET` in the Vercel env. See `VERCEL_DEPLOYMENTS.md`.

   Original report: the footer status can poll while a deployment is actively building, but
   ready deployments should not keep spending Vercel API calls just to detect
   a future build. Add a Vercel webhook endpoint for deployment created/ready/
   failed events, persist the latest project status server-side, and have the
   footer/dashboard read the cached status instead of polling Vercel directly.

6. **✅ Done (reconciled 2026-08-18): cross-tab sync for persisted thingtime state.**

   `BroadcastChannel('thingtime')`
   (`remix/app/Providers/thingtimeSyncChannel.ts`) publishes each successfully
   applied local `setThingtime` write. Payloads go through the active safe
   `thingtimeSerialization.ts` codec, so tagged Dates and cycles survive while
   persisted/runtime function source never crosses tabs. Other tabs apply the
   write through the existing mutation queue with `{ ignoreUndoRedo: true,
   fromRemote: true }`, preventing echo loops and keeping undo per-tab. The
   internal root `timemachine` path is excluded from channel traffic, while
   ordinary paths restored by undo/redo still converge across tabs. The
   debounced latest-revision autosave in `ThingtimeProvider` remains the one
   persist path. Unit and live two-tab verification are recorded in
   `claude-todo/07-cross-tab-thingtime-sync.md`; optional cold-tab revision
   reconciliation remains future hardening.

---

_Added 2026-07-08 after a full multi-agent codebase review (27 agents: 6 subsystem
readers, 3 finder tracks each adversarially verified, 3 idea lenses). Every item
below was confirmed by reading the cited code — file/line refs are load-bearing._

7. **🟡 PARTIALLY FIXED — 🔒 SECURITY: lock down the unauthenticated admin/data endpoints.**

   > **Status — verified on main 2026-07-21, re-verified 2026-08-29.** A1 and A2
   > are closed. A3 is throttled but not yet bounded. Do not re-claim A1/A2 or
   > A3's throttle. Full spec and original finding:
   > `claude-todo/09-security-hardening.md` §A.

   - ✅ **A1 — `POST /api/v1/mongodb/raw-results`**
     (`remix/app/routes/api/v1/mongodb/raw-results/_raw-results.tsx`): loader and
     action both gate on `requireAdmin`, then a fail-closed `mongodb.query`
     `enforceRateLimit`, and only run bounded read-only queries through
     `runMongoQuery`. The `things.find().toArray()` full-collection dump that
     bypassed the `canView` / `visibilityQueryFor` gating in `things.ts` is gone.
   - ✅ **A2 — `POST /api/v1/mongodb/populate`**
     (`.../mongodb/populate/_populate.tsx`): `requireAdmin` plus a fail-closed
     `mongodb.populate` limiter, so an anonymous caller can no longer seed
     repo-known demo passwords or burn bcrypt/Mongo work per request.
   - 🟡 **A3 — `POST /api/v1/auth/service-account`**
     (`.../auth/service-account/_service-account.tsx` → `serviceAccounts.ts`):
     public by design. PR #100 (merged 2026-08-12) added the fail-closed per-IP
     `auth.serviceAccount` limiter, a 16 KiB body cap, and an explicit field
     whitelist, so unauthenticated mass-minting is throttled. **Still open:** the
     minted token is non-expiring (`signJwt expiresIn:null`,
     `createSession expiresAt:null`) and carries the 5 GiB
     `storageAllowanceBytes` default. Bound the token lifetime before closing
     this item. (`getCurrentUser` only disables an *unverified* service token
     after a 7-day grace, so it does not bound a verified one.) PR #103 was
     closed unmerged and covered signup/item 8, not A3.

   All three are still registered in the prod dispatcher
   (`remix/server/routes/api/[...].ts`) — the gating above is what makes them
   safe, so keep it in place if these routes ever move.

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

14. **✅ FIXED IN PR #115 — 🧹 Remove render-time debug leaks in the hot path.**

    The severe part — the unbounded `window.useThingtimeScope` per-render array
    in `useThingtime.tsx` — was already gone before this pass (the hook is now a
    plain context read). Remaining render-time `console.log`s were cleared on
    `claude/render-log-leaks-s7` (2026-07-21): removed all four render-time logs
    in `ThingtimeURL.tsx` (the `location`, path/thing `useMemo` bodies, and the
    per-render return log), the per-render `commanderActive` log and the
    per-keypress `e?.code` log in `CommanderV2.tsx`, the per-render `debug`
    object + log in the `command` `useMemo` and the per-keypress `e?.code` log
    in `CommanderV1Deprecated.tsx` (folded in from PR #110), and gated the three
    `addNewChild` debug logs in `Thingtime.tsx` behind the file's existing
    `TT_DEBUG` flag. Verified live: `/` and `/things` render cleanly with no
    console errors and none of the removed logs. (Discrete event-handler logs in
    `CommanderV2` — on select/close/error — were left as-is; they are not
    render-time hot-path leaks. The two remaining render-body `console.debug`
    calls in `LogoOld2.tsx`/`LogoOld3.tsx` are unreachable — neither component
    is imported anywhere — so they are not hot-path leaks either.)

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
