# Changelog

All notable changes to the **Thingtime Remix app** are recorded here. The format
is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with
assistant and manual changes attributed so future PR archaeology is less cursed.

**Author legend** — every entry is attributed:

- **Codex (AI)** — change made by the Codex AI assistant.
- **Lopu** — change made manually by the developer.

> When you make a manual change, add a bullet under `[Unreleased]` ending with
> `— Lopu, YYYY-MM-DD`. Keep the newest entries at the top.

---

## [Unreleased]

### Added

- **`app/Providers/Chakra/emotionContext.ts`** — shared server/client context
  for Emotion SSR style chunks, so the Remix document can render critical
  Emotion styles as part of the React tree instead of string-splicing them into
  `<head>` after render. — _Codex (AI), 2026-06-22_
- **Root project `TODO.md` urgent hydrate follow-up** documenting that true
  document hydration must keep Emotion SSR styles inside the client-rendered
  document contract. — _Codex (AI), 2026-06-22_
- **Local PM2 runbook note** in root `AGENTS.md` for using the managed
  `tt-remix-9999` app via `npm run remix-pms` / PM2 instead of starting duplicate
  ad-hoc Remix dev servers. — _Codex (AI), 2026-06-22_

### Changed

- **Completed the proper Chakra/Emotion document hydration wiring.**
  `entry.client.tsx` now uses the resettable client Emotion cache pattern,
  `createEmotionCache.ts` uses the Chakra Remix `cha` cache key, and
  `root.tsx` performs Emotion's one-time sheet handoff with `withEmotionCache`.
  The handoff is intentionally not dependency-driven because resetting the cache
  repeatedly creates a React update loop. — _Codex (AI), 2026-06-22_
- **Emotion + Chakra SSR hydration now follows the Remix document tree.**
  `entry.server.tsx` renders once to collect Emotion chunks, then renders the
  final document with those chunks supplied through `ServerStyleContext`.
  `root.tsx` emits the resulting `<style data-emotion="...">` tags inside
  `<head>`, so the server HTML and the client React document agree on the
  critical CSS nodes. — _Codex (AI), 2026-06-22_
- **Client boot now uses `hydrateRoot(document, ...)` again.** `entry.client.tsx`
  reads the existing server Emotion style tags, provides them through
  `ServerStyleContext`, and hydrates the Remix document with the shared Emotion
  cache. — _Codex (AI), 2026-06-22_
- **Removed the manual Emotion style clone/restore loop.** The previous approach
  preserved styling but could briefly remove critical CSS during load, causing
  the ugly unstyled-content jump. Emotion now hydrates the SSR style tags through
  its normal cache path instead. — _Codex (AI), 2026-06-22_
- **Simplified Emotion imports** in `createEmotionCache.ts` and
  `entry.server.tsx` to direct default imports now that the build path handles
  these modules correctly. — _Codex (AI), 2026-06-22_
- **Made Vercel Analytics client-only after mount** to avoid server/client
  document differences during the initial hydrate pass. — _Codex (AI),
  2026-06-22_
- **Replaced the invalid `LoaderArgs` import** with a local loader argument type
  and typed root loader data for the env/title payload. — _Codex (AI),
  2026-06-22_

### Fixed

| # | Problem | Fix | Author | Date |
|---|---------|-----|--------|------|
| 1 | Emotion could throw `NotFoundError: Failed to execute 'insertBefore' on 'Node'` after click/navigation because the client cache could point at style nodes React had replaced. | Keep Emotion SSR styles in the React document tree and hydrate them through the shared Emotion cache instead of manually cloning/removing/restoring style tags. | Codex (AI) | 2026-06-22 |
| 2 | Some loads visibly jumped through unstyled content because critical Emotion styles were temporarily removed before being restored. | Stop deleting SSR style tags on startup; render them into `<head>` from React and let Emotion adopt them. | Codex (AI) | 2026-06-22 |
| 3 | The first proper `ClientStyleContext.reset()` attempt could recurse because the Emotion sheet handoff reran after each cache replacement. | Make the client reset context stable and run the Emotion sheet handoff once, matching Chakra's Remix contract while documenting why exhaustive-deps is intentionally disabled there. | Codex (AI) | 2026-06-22 |
| 4 | `smarts.merge(..., { clone: true })` behavior was at risk during PR cleanup. | Verified the clone path still deep-clones nested values without mutating the source object. | Codex (AI) | 2026-06-22 |
| 5 | Local dev-server restarts could accidentally spawn duplicate Remix servers or leave unclear runtime state. | Documented the PM2-managed `tt-remix-9999` workflow in root `AGENTS.md`; local app was restarted through `npm run remix-pms`. | Codex (AI) | 2026-06-22 |

### Verified

- `pnpm --dir remix exec eslint app/entry.client.tsx app/entry.server.tsx app/root.tsx app/Providers/Chakra/createEmotionCache.ts app/Providers/Chakra/emotionContext.ts`
  passed. — _Codex (AI), 2026-06-22_
- `pnpm --dir remix exec vite build` passed. Existing warnings remain around
  Remix future flags, MongoDB browser externalization, eval usage, and large
  chunks. — _Codex (AI), 2026-06-22_
- Clean headless Chrome with extensions disabled loaded the PM2-managed dev app
  without React hydration, Emotion insertion, or update-depth console failures;
  an extension-enabled Chrome profile still injected third-party attributes/DOM
  that can perturb full-document hydration checks. — _Codex (AI), 2026-06-22_
- `bash --noprofile --norc -n remix/scripts/pre-dev.sh` passed after confirming
  the `.env.auto` auto-update behavior is intentionally preserved. — _Codex (AI),
  2026-06-22_
- Browser smoke checks against the PM2-managed local Remix server confirmed the
  main heading stayed styled across early and settled load states, with seven
  Emotion style tags present. — _Codex (AI), 2026-06-22_
- `graphify update .` ran after code changes. — _Codex (AI), 2026-06-22_

---

<!--
## [1.0.0] - YYYY-MM-DD
Move entries up from [Unreleased] when cutting a tagged release.
-->
