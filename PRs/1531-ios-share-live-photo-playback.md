# PR 1531 — iOS media sharing and Live Photo playback

Branch: `codex/ios-share-live-photo-playback`
Base: `origin/main` at `d369fa49207e771da1eff83babcc1ec2f05001a6`
PR: https://github.com/lopugit/thingtime/pull/1531

## Result

Photos providers that cannot supply both Live Photo resources no longer abort
readable media in a mixed share. The importer preserves available originals,
reports a still-only or skipped-item warning, and never invents a playable pair.
HEIC originals stay unchanged; a bounded JPEG display copy can pair with the
original motion video. Local write failures and cancellation remain errors.

Explicit pair metadata survives normal uploads, authorized projections and
private copies. Only complete, unique siblings form a Live Photo tile. Hold
plays motion; release, scrolling, blur, visibility change and closing the
lightbox stop it. Moderation protects either part and downloads retain both.
Old attachments without pairing metadata remain separate; filenames are never
used to guess a pair.

The native extension waits for the current navigation to commit and render
before hiding its status, preserves drafts on failures and shows retry. Video
posters are bounded images with an explicit MIME type. Web thumbnails paint a
paused frame; images recover stalled variants through original-file fallback
and an explicit retry state.

## Verification — 2026-11-15

- 40 native ShareInbox tests pass and final native source compiles.
- 363 attachment tests pass, including grouping and incoming-share metadata;
  focused capability and metadata coverage also passed.
- Real isolated API/browser acceptance covers Post, Message, Save, folders,
  exact HEIC/JPEG/MP4 original bytes and lost native receipt recovery.
- Actual gallery and lightbox acceptance passes desktop and mobile viewport
  checks in Chromium and WebKit: decoded held playback, release/scroll/close,
  keyboard, moderation, ordinary video, motion download, still retry and layout.
  Trusted long-touch dispatch is Chromium-specific; WebKit checks touch tap,
  held pointer playback and the mobile layout.
- Actual Photos Live Photo sharing into a rendered Thingtime composer passes
  on an isolated iOS 26.5 simulator. Imported JPEG (25,814 bytes) and MOV
  (5,116 bytes) independently match their originals by SHA-256. The fixture
  checks an existing Photos grant before requesting authorization again.
- Remix typecheck and the zero-error ratchet pass. Full lint passes with zero
  errors and 456 existing warnings.

Run `pnpm --dir remix run test:attachments`,
`pnpm --dir remix run test:share-media-previews:browser`, and
`pnpm --dir remix run test:live-photo-playback:browser`. Set
`TT_PLAYWRIGHT_BROWSER=webkit` for the latter WebKit run and
`TT_PLAYWRIGHT_MODULE` when Playwright is supplied by the host runtime.
Native checks use the documented iOS share acceptance scripts and disposable
simulator Photos fixtures; no personal Photos library was read or changed.

## Remaining delivery boundary

Physical iPhone and iCloud-backed sharing acceptance remain separate from the
simulator evidence. Apple currently refuses the canonical TestFlight status
operation because a required agreement is missing or expired:
https://github.com/lopugit/thingtime/actions/runs/43665691432
The account holder must review and accept that agreement before upload can
complete. No legal acceptance or protected-device action is automated here.

The PR remains responsible for normal protected integration and deployment.
Graphify refresh covers source and scoped current docs; semantic indexing of
the large historical TESTING.md and CHANGELOG.md files is not claimed.
