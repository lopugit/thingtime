# PR 42 — Add Electron desktop app shell

Branch: `codex/electron-remix-app`
PR: https://github.com/lopugit/thingtime/pull/42

## Summary

- Adds a root `electron/` package that rebuilds the existing `remix/` Vite/Nitro app and packages it as a macOS Electron app.
- Starts the bundled Nitro server on loopback at runtime and loads it through a hardened Electron window with `contextIsolation`, no `nodeIntegration`, a small preload bridge, and origin-checked navigation.
- Adds the desktop URL switcher at `thingtime.settings.electron.${sessionHash}URL`, with bundled/prod menu fallbacks.
- Adds Electron settings for update checks and release bundle downloads. The app checks recent GitHub releases for `Electron App Release`, picks the best matching macOS bundle asset, and downloads it to `~/Downloads`.
- Adds `pnpm --dir electron install:local` and root `npm run install-electron`, which copy the built app to `~/Applications/Thingtime.app`, register it with LaunchServices, and ask Spotlight to index it.
- Adds Codex-style macOS titlebar integration: Electron hides the native titlebar, exposes titlebar metrics to the renderer, and the web nav/drawer reserve the traffic-light area while making the top strip draggable.

## Release Asset Convention

For update downloads, attach a macOS artifact to a GitHub release named or described with `Electron App Release`. Preferred asset naming includes `Electron App Release`, `Thingtime`, `Electron`, and one of `.dmg`, `.zip`, or `.pkg`.

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
- Installed-app CDP titlebar smoke test confirmed `html.thingtime-electron-desktop`, a 52px titlebar reserve, widened titlebar CSS variables (`leftInset=140px`, `navStart=196px`), drawer trigger bounds at `x=148, y=8`, home/unicorn link bounds at `x=214`, top nav bounds at `y=0` with `-webkit-app-region: drag`, and the real command input marked `no-drag`.
- A normal macOS `screencapture` attempt from the Codex environment failed with `could not create image from display`, so native-control visual proof is covered by live Electron window bounds plus renderer screenshot.

## Known Follow-Ups

- Publish a GitHub release with an Electron macOS bundle asset matching the naming convention above.
- Add signed/notarized distribution artifacts before enabling unattended install/replacement.
- Existing Remix build warnings remain: direct `eval` warnings in older Commander/Thingtime code and a large client chunk warning.
