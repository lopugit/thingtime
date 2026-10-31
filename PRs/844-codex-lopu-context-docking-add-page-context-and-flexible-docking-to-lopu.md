# PR #844 — Add page context and flexible docking to Lopu

2026-09-17 · `codex/lopu-context-docking` → `main`

Lopu shows the current page title and URL with a default-on toggle. Pages opens a searchable account-local list combining recent normal navigation with navigator selections. Up to ten bounded page references travel as untrusted context and remain in saved user messages. Turning off current-page context also omits the active builder draft and selected block; explicitly chosen pages remain. References exclude credential routes, fragments and non-navigation query keys and grant no extra permissions. Reply capability 1.12.0 is required for pages; ordinary continuation retains its 1.11.0 minimum.

Minimise collapses entirely to the floating bubble and persists across navigation and reload. All four edges and corners resize the desktop window. Top/left/bottom/right docks offer overlay or split, with the page actually shrinking in split mode and compact navigation responding to its remaining width. Mobile keeps the responsive sheet and supports minimise and page attachments.

## Validation

- 187 Lopu UI, 65 API capability, 59 Messenger and 16 navigation tests pass. The actual reply-route test uses a synthetic provider/persistence to verify pre-write rejection, sanitization, saved references and opt-out.
- Client/embed and full Vercel builds pass, including output/CSP verification. Changed TS/TSX lint has no errors. The existing ESLint parser and Graphify detector do not cover .mts; the new route test passes through Node. Full typecheck reports 116 existing errors, none in changed files.
- Chrome desktop and 390x844/390x500: eight resize grips, all split directions, overlay stacking, divider resizing down to 320px of page width, top-to-bottom page/picker scrolling, minimise/navigation/reload, recent-page selection, opt-out and dedicated Lopu page checked. The local QA account is unverified; browser controls and synthetic server transport were verified separately, with no production provider message.
- Graphify refresh includes new TS/TSX modules and changed Markdown, with portable HTML regenerated. Generated merge conflicts are resolved as a whole snapshot and regenerated.

## Delivery

Local UI: http://localhost:11570 (HMR 11571, Nitro 11572), using the worktree PM2 entry. Tailscale/Funnel could not be verified because the installed wrapper points at a missing Tailscale app executable.

PR: https://github.com/lopugit/thingtime/pull/844
Preview: https://pr-844.previews.dev.thingtime.com
Preview, required checks and production release are verified separately; this note does not imply a pending deployment is live.
