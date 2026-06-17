# 🌈 Thingtime Mobile 📱

The React Native (Expo) mobile app for [Thingtime](https://thingtime.com) 🦄 — a
GUI for the internet. This app shares the brand palette and talks to the same
Thingtime API as the Remix web app in `../remix`.

## Stack

- [Expo](https://docs.expo.dev/) (SDK 51) + React Native 0.74
- TypeScript
- [React Navigation](https://reactnavigation.org/) (native stack)
- `axios` for the REST API and `socket.io-client` for live updates — matching
  the versions used elsewhere in the monorepo.

## Getting started

From this directory (`react-native/`):

```sh
npm install
npm start
```

Then press `i` for the iOS simulator, `a` for an Android emulator, or scan the
QR code with the [Expo Go](https://expo.dev/go) app on a physical device.

You can also run the platform scripts directly:

```sh
npm run ios
npm run android
npm run web
```

## Running on a physical iPhone

Install [Expo Go](https://apps.apple.com/app/expo-go/id982107779) from the App
Store — every dependency in this app runs inside it, so no custom dev build is
needed. Then pick a path:

1. **Local dev server (easiest).** On your computer, run `npx expo start` and
   scan the QR with the iOS Camera app (phone + computer on the same WiFi). Use
   `npx expo start --tunnel` if they're on different networks.
2. **Cloud build, no computer.** Use [EAS Build](https://docs.expo.dev/build/introduction/)
   (`eas.json` is included): `npx eas-cli build --platform ios --profile preview`.
   The build runs on Expo's servers and is distributed to registered devices.

> Note: `expo start --tunnel` relies on ngrok, which cannot establish its
> control session from network environments that perform TLS interception
> (it pins its own CA) or without an ngrok authtoken. Run the tunnel from a
> normal network, or use EAS Build, in those cases.

## Configuration

The API base URL is resolved in `src/config.ts`, in this order:

1. `EXPO_PUBLIC_API_BASE_URL` environment variable (see `.env.example`)
2. `expo.extra.apiBaseUrl` in `app.json`
3. the production default (`https://api.thingtime.com`)

To develop against the local API server (`../api`, default port `3847`), copy
`.env.example` to `.env` and set your machine's LAN IP so a physical device can
reach it:

```sh
cp .env.example .env
```

## Project layout

```
react-native/
├── App.tsx                 # Navigation container + theme
├── index.ts                # Expo entry point
├── app.json                # Expo config
├── assets/                 # App icon, adaptive icon, splash, favicon, logo
└── src/
    ├── api/                # REST client, thing endpoints, socket listener
    ├── components/         # Reusable UI (RainbowBar, ThingCard)
    ├── navigation/         # Route param types
    ├── screens/            # Home + Thing screens
    ├── theme/              # Brand colours (ported from the web Chakra theme)
    └── config.ts           # API base URL resolution
```

## Brand assets

The icon, adaptive icon, splash, favicon and in-app logo in `assets/` are
generated from the official Thingtime pink-cross mark
(`resources/favicon/favicon_io (2)/android-chrome-512x512.png`) so they match
the web app. The horizontal wordmark (`assets/thingtime-horizontal.svg`) is
included for future use.

## API

The app uses the same endpoints as the web app (`../api/src/index.js`):

- `GET /v1/thing?request=get&uuid=<uuid>` — fetch a thing
- `GET /v1/thing?thing=<serialized>` — save a thing
- Socket.io `registerListener` — subscribe to live updates for a thing
