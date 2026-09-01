# 10 — Delight & growth ideas (features · design · easter eggs)

**Status:** 🌱 Idea bank · seeded 2026-07-08 · a few eggs **shipped** in this
branch (marked ✅).

A grounded catalogue from the 2026-07-08 review. Every idea names where it hooks
in, and each reuses machinery that already exists — the whole app already speaks
rainbow/unicorn/Lopu, so most of these are "wire up what's there", not new
systems. Reusable whimsy exports (from the review):

- `burstConfetti(x, y, count=60)`, `burstAtEvent(event, count)` —
  `~/components/Landing/confetti` (dispatches the `tt:confetti` CustomEvent that
  `ConfettiCanvas` renders). **Note:** `ConfettiCanvas` was Landing-only; this
  branch mounts it app-wide in `root.tsx` so confetti works everywhere.
- `useLopu()` / `useLopuStream()` — `~/components/Lopu/useLopu` (the only
  sanctioned notification path — FUNDAMENTALS §7).
- `RAINBOW`, `RAINBOW_TEXT`, `RAINBOW_PALETTE`, `RAINBOW_VARS` — `~/theme/rainbow`.
- `FALLBACK_MUSINGS` — `~/api/utils/lopu/fallbacks` (~150 time-rotated, RNG-free
  musings — deterministic, matches the owner's test==live value).
- Motion gate: `general.motion` in the theme; honour `prefers-reduced-motion`.

---

## 🥚 Easter eggs

> Design rules for every egg: hidden but discoverable, never annoying, always
> degrade gracefully when motion is off (toast-only, no animation), and route all
> messages through Lopu.

- ✅ **Konami code → party mode.** `↑↑↓↓←→←→ B A` anywhere fires a confetti
  burst + a brief rainbow flash + a Lopu toast. The classic egg command-palette
  and keyboard people hunt for; none existed before. *(app-wide keydown listener;
  reuses `burstConfetti` + `useLopu`.)*
- ✅ **Unicorn logo gallop.** A rapid 7-click streak on the nav 🦄 logo makes it
  gallop across the nav (CSS keyframe), trailed by confetti + a Lopu toast. The
  most-touched pixel in the app; streak resets after 1.5 s so accidental
  double-clicks never trigger it. *(`Nav.tsx` logo + mobile twin.)*
- ✅ **Secret Commander words.** Type a magic word into the "Imagine.." Commander
  and Enter: `unicorn` → confetti + a random Lopu musing, `rainbow` → toggles the
  input's rainbow-glow, `ode` → navigates to the hidden poem, `konami` → party
  mode. Rides the existing `executeCommand` branch. *(`CommanderV2.tsx`.)*
- ✅ **`window.lopu` console API + rainbow banner.** On boot, print a `%c`
  rainbow-gradient console banner inviting `lopu.help()`, and expose a small
  scripting surface over the one data tree: `lopu.get/set/paths/toast/confetti`.
  (The app already owns `window.tt` — it reassigns it to the live tree on every
  state change — so the egg lives on the free `window.lopu` namespace.) Devs who
  open the console get a grin and a real tool. *(`EasterEggs.tsx` boot effect +
  `eggs/consoleEgg.ts`; `RAINBOW_PALETTE`.)*
- ✅ **The footer wizard casts spells.** The 🌈🦄🧙 footer row is decorative
  today. Make 🧙 clickable: each click casts a spell — confetti at the cursor +
  a Lopu toast with a rotating incantation ("✨ Levio-thing-sa"). *(`Footer.tsx`
  icon row.)*
- 🔮 **Lopu's 11:11 make-a-wish musing.** The musing endpoint already computes the
  visitor's local time (`formatLocalTime`, `_musing.tsx` L8) with no RNG. At 11:11
  and midnight, swap in a special "make a wish 🌠" musing slot. Zero UI work,
  test==live because it keys off the same tz param. *(`_musing.tsx` +
  `fallbacks.ts`.)*
- 🔮 **Ultra-rare Icon rolls + secret names.** `Icon.tsx` already coin-flips
  🌳/🌀 for `thingtime`. Add a 1-in-100 🦄 roll, secret names (`lopu`→🦄,
  `wish`→🌠) before the 🤷‍♂️ fallback, and date-aware seasonals (`thingtime` on
  Dec 25 → 🎄, deterministic-by-date). *(`Icon.tsx`.)*
- 🔮 **API personality: `/api/v1/teapot` + a Lopu 404.** Replace the dispatcher's
  bare `Not found` with `{ok:false, error:'Lopu looked everywhere 🤷‍♂️'}` and
  register a hidden `teapot` key answering **418** with a brew-time haiku (+ a real
  `-docs` twin). Rewards devs exploring the self-describing API. *(`[...].ts` 404;
  `apiDocs.ts` registration.)*

## ✨ Features (growth / stickiness)

- ✅ **Post permalinks + copy-link share** *(M — shipped via PR #141)*. Posts
  have URLs: `/post/:id` renders any post or comment through the existing
  `PostCard` (`remix/app/routes/post.tsx`), and `Copy link 🔗` lives in
  PostCard's share popover with a clipboard-unavailable fallback. Guests get
  the existing "Log in to react 🗝️" funnel.
- **Shareable algorithms — "try my feed brain 🧠"** *(M)*. Algorithms are already
  named, emoji'd, branchable docs with a `branchFrom` API. Add "Share algorithm" →
  `/feed?algorithm=<shareId>`; a visitor gets a Lopu prompt to branch a copy and
  start training it. Trained taste becomes a social object (like themes'
  `?apply=<id>` deep links already are). *(`AlgorithmMenu`, `AlgorithmManager`,
  `algorithms/*`, `Feed.tsx` `?algorithm` param.)*
- **Public theme gallery** *(M)*. `themes/shared` + `?apply=<shareId>` already
  work and `ThemeStudio` already renders mini preset previews — but public themes
  are invisible without a link. Build `/themes/gallery`: a browsable grid with
  Apply + Copy-link, reusing the preset-card preview. Thingtime's most demoable
  feature, made a page. *(`ThemeStudio` preview extract, `themes/shared` list mode,
  new route.)*
- **"Wear my theme" on profiles** *(S)*. `user.activeThemeId` already syncs and
  `applyThemeDoc` already applies shared themes. Show the profile owner's active
  public theme as a rainbow chip on `ProfilePage`; one click previews Thingtime
  through their eyes, with a Lopu keep/revert toast. Profiles become theme
  storefronts. *(`ProfilePage`, `users/profile`, `useTtTheme`.)*
- **Clickable tags → public tag feeds** *(M)*. Tag chips are inert; the composer
  already collects them and `feedRanking.ts` already has tag weights. Link each
  chip to `/feed?tag=<tag>`, add a tag filter (copy `FeedFilters`' type/circle/date
  pattern). Shareable, guest-visible topic hubs. *(`PostCard`, `FeedFilters`,
  `Feed.tsx`, `things.ts` feed filter.)*
- **Circles become real** *(L)*. Posts target `friends`/`family` circles and
  `FeedFilters` exposes them, but no UI/API adds anyone — non-public circles are
  decorative. Add "Add to circle 💞" on `ProfilePage`, a `users/circles` API (Fail
  union), and honour membership in the visibility query. This is the missing social
  graph. *(`ProfilePage`, `feedTypes` `CIRCLE_META`, new `users/circles`,
  `things.ts` visibility.)*
- **Waitlist welcome fortune** *(S)*. Joining already fires confetti but the API
  replies a bare `{ok:true}`. Return a fortune from `FALLBACK_MUSINGS`
  (time-rotated, deterministic) and surface it in the Lopu toast — first contact
  becomes a gift. Optional: also return the joiner's position + a `?via=<code>`
  referral loop ("You're #412 — every friend moves you up 🌈"). *(`_waitlist.tsx`,
  `Landing.tsx`, `fallbacks.ts`.)*

## 🎨 Design

- **Algorithms grow up: 🥚 → 🐣 → 🐥 → 🧠** *(M)*. The pulsing "Learning as you
  scroll 🧠" dot never changes. Let the algorithm visibly mature as trained
  signals cross thresholds (`sessionEventCount` / weight magnitude): tooltip and
  `AlgorithmManager` label evolve `still an egg 🥚 → hatching 🐣 → finding its
  wings 🐥 → thinking 🧠`, with one Lopu toast per milestone ("Your algorithm just
  hatched!"). Teaches the doomscroll-training mechanic with zero docs and gives
  people a reason to come back and raise their feed. *(`AlgorithmMenu.tsx` dot
  title ~L341, `AlgorithmManager.tsx` label ~L248, `useFeedEngagement.ts`
  thresholds.)* **See the mockup in `docs/design/thingtime-algorithm-growth/`.**

## ⌨️ Power user / dev

- ✅ **`Cmd+K` opens the Commander anywhere** *(S — shipped via PR #130)*. A window
  keydown on the global (nav) Commander only, so multiple mounted instances don't
  fight; the existing open/focus plumbing (the `commanderActive` effect) does the
  rest. One surface outranks it: Editor.js binds `CMD+K` to its core link tool, so
  the palette yields inside a `.codex-editor` block. *(`commanderShortcut.ts`,
  `CommanderV2.tsx`.)*
- ✅ **Commander `>` command registry** *(M — shipped via PR #130)*. A `>` prefix
  flips the dropdown into command mode and Enter runs the command instead of the
  setter/navigate fallthrough: `>help` · `>theme <name>` · `>undo`/`>redo` ·
  `>search` · `>docs [section]` · `>feed` · `>things` · `>themes` · `>settings` ·
  `>profile` · `>schemas`, each confirming via Lopu. The registry is DOM-free (side
  effects injected), so it unit-tests in plain Node.
  *(`commanderCommands.ts`, `CommanderV2.tsx` `executeCommand`.)*
  - `>editor` from the original sketch was deliberately **not** shipped: there is no
    `/editor` route, so it fell through to the `*` catch-all tree viewer while
    toasting success. Add the one registry line the day an editor page lands —
    `commanderCommands.test.ts` pins every navigation target to a declared route.
- **"Run it ▶" live API playground on `/docs/api`** *(M)*. Every endpoint already
  self-describes via its `-docs` twin with generated curl/JS/Python. Add a per-
  endpoint run button: editable JSON body, fetch with the real session cookie,
  pretty response + status + timing. Test==live made tangible; no Postman.
  *(`apiDocs.ts`, `/docs/api` component, `[...].ts` `-docs` payloads.)*
- **DevKit request log + copy-as-curl** *(M)*. DevKit is already a draggable panel
  wired to `useApi` + Lopu. Add a ring buffer of the last ~20 calls
  (method/path/status/ms); tap a row to copy a ready curl (cookie included) from
  the same generator `apiDocs.ts` uses. *(`DevKit.tsx`, `useApi.tsx`.)*
- **Shake-to-open DevKit in the iOS app** *(M)*. `DevKit` already detects the
  native shell (`isNativeWebView`) and `NativeBridgeHost` lives in `root.tsx`. Send
  a shake-gesture message from the iOS webview that dispatches a window event DevKit
  toggles on, with a "You shook it! 🛠️" Lopu toast. *(`DevKit.tsx`,
  `NativeBridgeHost`, `iOS/` webview container.)*

---

## Done when

Each idea graduates to its own `claude-todo/NN-*.md` when picked up. This file is
the menu, not the commitment. Cross-feature sequencing, privacy-safe outcome
measurement, accessibility/reliability gates, and sustainable adoption belong
to [22 — Trustworthy adoption loop](./22-trustworthy-adoption-loop.md) and its
[phased roadmap](../../PLAN/trustworthy-adoption-roadmap.md).
