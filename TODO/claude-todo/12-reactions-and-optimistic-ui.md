# 12 — Multi-emoji reactions, custom emoji picker, optimistic UI 🟢

**Status:** Built, live-tested locally (multi-react, custom/typed multi-emoji
tokens, picker categories + search + paginated recents, optimistic switcher +
reactions, DoS caps, concurrency reconcile).

## Goal
Richer post reactions — react with several emoji at once, pick from the full
native emoji keyboard, or type/paste a multi-emoji group as one reaction — plus
an app-wide "optimistic rendering" rule so UI never flashes a loading screen
when it has cached state.

## ✅ Decisions (locked)
- **Reactions are open-vocabulary + multi.** `doc.reactions` stays
  `Record<token, userId[]>` but a token is any single emoji OR a multi-emoji
  group typed as one unit (`🤣🤣🙌💀💦`) — one Mongo `reactions.<token>` key.
  `toggleReaction` toggles each token independently (a user holds several);
  `viewerReaction` → `viewerReactions: string[]`.
- **One validation source of truth:** `~/utils/reactionTokens.ts`
  `sanitizeReactionToken` (emoji-only via Unicode property escapes, ≤12
  graphemes / ≤80 codepoints, rejects `.`/`$`/whitespace for Mongo-key safety),
  shared by server + picker.
- **Relational appended data (supersedes the embedded model):** reactions and
  comments are their own atomic `things` (`kind:'reaction'`/`'comment'`) linked
  by `parentId`, aggregated on read — NOT embedded in the post doc. This
  root-fixes the unbounded-doc DoS structurally (no single field grows) and made
  the concurrency clobber tractable. The caps (`MAX_REACTIONS_PER_USER_PER_POST
  = 20`, `MAX_REACTION_KEYS_PER_POST = 100`, `MAX_COMMENTS_PER_POST = 500`)
  remain as SOFT product limits, no longer structural safety rails. Canonical
  data-model rule: `FUNDAMENTALS.md` §3 ("Appended/child data is relational").
  Legacy embedded data folds in on read + migrates to things on first write.
  (Rate-limiting the react endpoint is still a follow-up — 09-security-hardening.)
- **Recents follow the user:** `users.meta.recentReactions` MRU (capped 500),
  fetched lazily via `GET /api/v1/things/reactions-recent` (not projected on the
  public user, to keep it lean); picker pages 20 at a time.
- **Native emoji rendering:** the ~1900-emoji dataset (`unicode-emoji-json`) is
  dynamic-imported into its own lazy chunk; we render the unicode characters
  directly (no image sprites/CDN), so each platform draws its own emoji.
- **Optimistic rendering is a house rule** (canonical in `CLAUDE.md`, pointer in
  `AGENTS.md`): never flash a loading state when cached state exists. Sync
  first-paint tier is `~/hooks/localCache.ts` (localStorage, `tt-<domain>`
  keys). Reaction toggles paint before the API returns and reconcile per-token
  (functional `onChanged` updater) so concurrent toggles never clobber; the
  account switcher paints its last-known roster instead of "Checking accounts…".

## Built this round
- Server: `things.ts` (multi-toggle + caps + recents), `reactionTokens.ts`,
  `users.ts` (`pushUserRecentReaction`/`getUserRecentReactions`),
  `GET /api/v1/things/reactions-recent`, react route returns
  `{ viewerReactions, recentReactions }`; registered + documented.
- Client: `components/Emoji/{emojiData,EmojiPicker,useRecentReactions}`,
  `hooks/localCache.ts`, PostCard reaction bar (chips with counts + truncation,
  grouped React-button preview, custom-emoji `＋`), optimistic
  `useAccountSwitcher`, `PostChange` functional updater through Feed/Profile/List.

## Still TODO
- Rate-limit `POST /api/v1/things/react` (shared gap with auth endpoints).
- "Continue as" roster list on `/login` (carried over from 11).
