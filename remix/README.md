# Remix

## Thingtime embed bundle

Build the one-file script-tag SDK with:

```sh
corepack pnpm run build:embed
```

The verified output is `dist/embed/thingtime.min.js`; the interactive local
fixture is `/embed/demo.html`. Full usage, persistence, popup-auth, and security
documentation lives in [`../docs/THINGTIME_EMBED.md`](../docs/THINGTIME_EMBED.md).

The 2026-07-10 validation checkout maps Vite port `18280` to both
`http://localhost:18280/embed/demo.html` and
`https://lopus-macbook-pro-2.tail9606f9.ts.net:18280/embed/demo.html` through
Tailscale Funnel. The matching `server.allowedHosts` entry is
`lopus-macbook-pro-2.tail9606f9.ts.net`; other worktrees should run
`npm run web-ports` and register their derived port.

This directory is a brief example of a [Remix](https://remix.run/docs) site that can be deployed to Vercel with zero configuration.

## Deploy Your Own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/vercel/vercel/tree/main/examples/remix&template=remix)

_Live Example: https://remix-run-template.vercel.app_

You can also deploy using the [Vercel CLI](https://vercel.com/cli):

```sh
npm i -g vercel
vercel
```

## Development

To run your Remix app locally, make sure your project's local dependencies are installed:

```sh
npm install
```

Afterwards, start the Remix development server like so:

```sh
npm run dev
```

Open up [http://localhost:3000](http://localhost:3000) and you should be ready to go!
