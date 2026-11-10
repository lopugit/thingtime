# PR #610 — Generated marketing suite (`claude/marketing-suite`)

Rescued from the stranded Claude worktree `session-ffdf75`. The original
session built the suite with a 10-agent workflow on 2026-09-02/03 and died on
a usage limit before committing anything: 27 new files and 6 edits sat
uncommitted, and the agent assigned to `MockScreens.tsx` never ran, so every
`/marketing` page failed to build (`WalkthroughPlayer` imported a module that
did not exist).

## What this PR carries

- The suite exactly as authored (see `remix/CHANGELOG.md` 2026-09-03 entry and
  `docs/marketing-suite.md`): `/marketing` hub + 1,635 generated pages,
  `/marketing/social-media` image suite, lazy routes, drawer hub, SEO hook.
- `MockScreens.tsx` (new in the rescue): the ten mock product screens the
  walkthrough player animates over, plain elements styled from `--mk-*`; each
  renders its `SCREEN_TARGETS` exactly once as `data-wt`, shows typed text in
  input-like targets and rings the active target. `MockScreens.test.ts` pins
  the two-way agreement with `SCREEN_TARGETS` and every walkthrough step.
- `useCaseHeadline` → `headlineForUseCase` (hooks lint rule).
- A merge of `develop` (only `remix/CHANGELOG.md` conflicted; both entries kept).

## Verification (2026-09-05, worktree stack on 13100)

- `npm run test:marketing` 51/51; `lint:files` clean on every changed file.
- Browser (DOM-probed; the pane was hidden for part of the run so several checks are element measurements rather than screenshots):
  - `/marketing` hub renders (207 internal links, no console errors after the fix).
  - `/marketing/landing/things-tree` renders hero + walkthrough player; mock screen `things` measures 1140×540 desktop / 335×320 at 375px, all 13 targets have size, cursor SVG present, no horizontal page overflow at either width (the sub-nav chip row scrolls inside its own container).
  - `/marketing/social-media` renders 164 controls incl. 23 download/copy buttons, 12 SVG previews, no overflow.
- CI on the PR: CodeQL, GitGuardian, Build + typecheck ratchet + unit tests, API suite — all green at the time of writing.

## Notes

- graphify snapshots were left untouched (source-only commits) so GitHub can diff the PR.
