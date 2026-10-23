# PR 42 — Add Electron desktop app shell

Branch: `codex/electron-remix-app`
PR: https://github.com/lopugit/thingtime/pull/42

## Summary

- Adds a root `electron/` package that rebuilds the existing `remix/` Vite/Nitro app and packages it as a macOS Electron app.
- Starts the bundled Nitro server on loopback at runtime and loads it through a hardened Electron window with `contextIsolation`, no `nodeIntegration`, a small preload bridge, and origin-checked navigation.
- Adds the desktop URL switcher at `thingtime.settings.electron.${sessionHash}URL`, with bundled/prod menu fallbacks.
- Adds Electron settings for update checks and release bundle downloads. The app checks recent GitHub releases for `Electron App Release`, picks the best matching macOS bundle asset, and downloads it to `~/Downloads`.
- Adds the main-branch `Electron App Release` workflow. On pushes to `main` that change `electron/**`, GitHub Actions builds the desktop bundle, tags the main commit as `electron-v<base>+build.<run-number>`, generates release notes, and uploads the macOS bundle assets without committing a source version bump.
- Adds `pnpm --dir electron install:local` and root `npm run install-electron`, which copy the built app to `~/Applications/Thingtime.app`, register it with LaunchServices, and ask Spotlight to index it.
- Adds Codex-style macOS titlebar integration: Electron hides the native titlebar, exposes titlebar metrics to the renderer, and the web nav/drawer reserve the traffic-light area while making the top strip draggable.

## Release Asset Convention

For update downloads, attach a macOS artifact to a GitHub release named or described with `Electron App Release`. Preferred asset naming includes `Electron App Release`, `Thingtime`, `Electron`, and one of `.dmg`, `.zip`, or `.pkg`.

The CI release workflow follows that convention automatically. It reads the
base version from `electron/package.json`, appends SemVer build metadata from
the GitHub Actions run number (for example `0.1.0+build.10423`), and creates a
tag prefixed with `electron-v` on the merged `main` commit. The source
`version` stays unchanged unless Lopu explicitly requests a real base-version
bump.

The current app downloads the bundle and reveals it in Finder. It does not silently replace the running app; install-in-place automation should wait until signed release artifacts and a clear replace/relaunch flow exist.

## Validation

- `git diff --check`
- `node --check electron/main.cjs`
- `node --check electron/preload.cjs`
- `node --check electron/scripts/install-local-app.mjs`
- `corepack pnpm --dir electron build`
- `corepack pnpm --dir electron install:local`
- `mdls ~/Applications/Thingtime.app` reported `kMDItemContentType = "com.apple.application-bundle"` and `kMDItemDisplayName = "Thingtime"`.
- `mdfind 'kMDItemFSName == "Thingtime.app"'` found `/Users/lopu/Applications/Thingtime.app`.
- `open -Ra Thingtime` resolved successfully.
- Installed-app CDP smoke test confirmed `window.thingtimeDesktop.getInfo`, `checkForUpdates`, and `downloadUpdateBundle` are exposed. Since the repo has no published latest Electron release yet, `checkForUpdates` returns `status: "unavailable"` with a clear message.
- Installed-app CDP titlebar smoke test confirmed `html.thingtime-electron-desktop`, a 52px titlebar reserve, Codex-aligned titlebar CSS variables (`leftInset=88px`, `navStart=132px`), drawer trigger bounds at `x=96, y=8`, top nav bounds at `y=0`, and real controls marked `no-drag`.
- Installed-app macOS window verification confirmed the Codex-style Electron titlebar cluster (drawer at `x=96`, unicorn/home, compact search icon) is vertically aligned, stays stationary when the drawer opens, no inactive commander input appears in the titlebar accessibility tree, the drawer panel begins directly with menu rows (`Home`, `Things`, `Account`, ...), search opens as a focused popup, and computed Electron drag regions remain on `.thingtimeTopNav`, `.thingtimeTopNavInner`, `#commander`, `.nav-left-section`, and `.nav-right-section` while buttons/inputs remain `no-drag`.
- A normal macOS `screencapture` attempt from the Codex environment failed with `could not create image from display`, so native-control visual proof is covered by live Electron window bounds plus renderer screenshot.

## Known Follow-Ups

- Publish a GitHub release with an Electron macOS bundle asset matching the naming convention above.
- Add signed/notarized distribution artifacts before enabling unattended install/replacement.
- Existing Remix build warnings remain: direct `eval` warnings in older Commander/Thingtime code and a large client chunk warning.
