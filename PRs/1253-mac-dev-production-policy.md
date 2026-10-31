# PR 1253: Mac development policy and desktop zoom

## Outcome and delivery boundary

Keep Thingtime Mac feature testing and ongoing development usage in a separately built app with its own identity, process, profile and data. The stable app stays on Production (`https://thingtime.com`) unless explicitly changed by the user. Stable replacement requires a newer version containing a Mac feature merged into verified `main`; version 0.1.1 is prepared, but the main merge and stable build/install acceptance remain pending.

The native View menu and focused-window Command/Control plus, minus and Actual Size commands share one zoom implementation. Shift-produced plus, minus and zero characters are supported. Chromium owns the native zoom range and origin behavior.

## Verification recorded 2026-10-27

- Electron full suite: 331 tests passed. The original process-group cleanup `EPERM` was not reproduced by its focused rerun or final full rerun.
- Real Electron fixture: keyboard input and menu callback regression passed using a fresh profile, separate process, local synthetic document, Chromium sandbox and normal networking. No outer network denial applies under the user's latest policy.
- Packaged web resources: `build:web` and `verify:web` passed.
- Remix typecheck and typecheck ratchet: zero errors; full lint: zero errors, 386 warnings.
- Separate full development app: Command/Control plus, minus and reset, and actual native View menu smoke checks passed. Enlarged landing page was inspected top to bottom; drawer and Settings reflow above 200% zoom passed. Input content remained intact without submitting. No sign-in or account writes occurred.
- Stable installed app's Production selection was verified separately before development acceptance.
- Graphify hooks and merge driver verified. Structural snapshots refreshed; the local semantic proxy on port 4768 was offline, so changed Markdown was not semantically reindexed.

## Remaining acceptance

Native window resizing was not verified; narrow CSS reflow was exercised through increased zoom. Stable signed installation and its installed-app smoke check remain pending until the authorized main merge and eligible stable build. Development evidence does not establish stable release acceptance.
