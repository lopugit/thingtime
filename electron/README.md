# Thingtime Electron

This directory packages the existing `remix/` web app as a desktop Electron app.
It does not duplicate the web source. The Electron build script rebuilds the
Vite client and Nitro server from `../remix`, stages the Node Nitro output under
`electron/dist/web`, and packages that output as an Electron resource.

## Commands

From the repository root:

```sh
pnpm --dir electron install
npm run build-electron
```

Useful direct commands:

```sh
pnpm --dir electron build:web
pnpm --dir electron verify:web
pnpm --dir electron dev
pnpm --dir electron dist
```

`build:web` runs the Remix/Nitro build with `NITRO_PRESET=node_server`, then
copies `remix/.output` into `electron/dist/web/.output`. `build` creates an
unsigned unpacked Electron app through `electron-builder --dir`; `dist` creates
packaged artifacts and can use the host machine's signing/notarization setup.

## Runtime

The Electron main process starts the bundled Nitro server on a free
`127.0.0.1` port and opens the desktop window to that local origin. External
links are opened with the OS browser. The renderer keeps `nodeIntegration`
disabled and uses a small preload bridge for desktop metadata only.

In local development, the Electron shell loads `remix/.env`, `remix/.env.local`,
and `remix/.env.auto` before starting Nitro so the desktop app sees the same
server-side env as the web dev stack. Do not commit secret-bearing env files.
