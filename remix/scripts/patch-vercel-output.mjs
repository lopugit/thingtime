#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

import { authorizeCsp, designBundlesCsp, mcpLabCsp, prodCsp } from './csp.mjs';

const configPath = '.vercel/output/config.json';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const routes = Array.isArray(config.routes) ? config.routes : [];

const filesystemRoute = routes.find((route) => route.handle === 'filesystem');
const apiRootDataRoute = routes.find((route) => route.src === '/api/root-data');
const apiCatchAllRoute = routes.find((route) => route.src === '/api/(?:.*)');
const serverFallbackRoute = routes.find((route) => route.dest === '/__server');
const wellKnownDiscoveryRoute = {
  src: '^/\\.well-known/(?:apple-app-site-association|oauth-protected-resource|oauth-authorization-server|thingtime-chatgpt-capabilities\\.json|thingtime-capabilities\\.json)$',
  dest: '/__server'
};
const appShellHeaders = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0'
};

config.routes = [
  // Global Content-Security-Policy (no 'unsafe-eval' — see scripts/csp.mjs).
  // Headers-only route: stamp and continue matching. Later continue-routes may
  // overwrite the CSP for specific paths.
  {
    src: '/(?:.*)',
    headers: {
      'Content-Security-Policy': prodCsp
    },
    continue: true
  },
  // Self-contained static prototype pages use inline scripts; same policy with
  // inline scripts allowed.
  {
    src: '^/docs/design-bundles(?:/.*)?$',
    headers: {
      'Content-Security-Policy': designBundlesCsp,
      'Access-Control-Allow-Origin': '*'
    },
    continue: true
  },
  // The sandboxed MCP review srcdoc inherits its parent CSP. Permit only the
  // shipped review app's exact inline module hash on the Lab route.
  {
    src: '^/docs/mcp/?$',
    headers: {
      'Content-Security-Policy': mcpLabCsp
    },
    continue: true
  },
  // The /authorize consent popup must never render inside a frame (UI-redress
  // hardening; token delivery already requires window.opener + a validated
  // origin). Headers-only route: stamp and continue matching, so the page is
  // still served by the SPA fallback below.
  {
    src: '^/authorize/?$',
    headers: {
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': authorizeCsp
    },
    continue: true
  },
  { src: '^/$', headers: appShellHeaders, dest: '/index.html' },
  { src: '^/index\\.html$', headers: appShellHeaders, dest: '/index.html' },
  // Content-hashed build output can be cached forever. Vite gives every file
  // under /assets/ an 8-char content hash, so a changed file is a changed URL
  // and a cached entry can never go stale — which is exactly what `immutable`
  // asserts (don't revalidate, not even on reload).
  //
  // Without this the filesystem handler below served these with no
  // Cache-Control at all, so index.html's ~80 eagerly-referenced chunks each
  // cost a conditional GET on every repeat visit and every reload. Multiplexed
  // over HTTP/2 that is ~1 RTT of added blocking latency rather than 80 serial
  // trips, but it removes the zero-network disk-cache path entirely: back /
  // forward and reload can never restore instantly, and the app cannot paint
  // without the network even though every byte is already on disk.
  //
  // Scoped to /assets/ deliberately. Files in public/ (tt-boot.js, icons, the
  // manifest) keep their normal revalidating behaviour because their names are
  // stable — caching those for a year would strand users on a stale boot
  // script. Headers-only + continue, so the filesystem handler still serves
  // the bytes.
  {
    src: '^/assets/(?:.*)$',
    headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    continue: true
  },
  // OAuth and capability discovery are non-API paths. They must reach Nitro
  // before the static SPA fallback, otherwise ChatGPT receives index.html.
  wellKnownDiscoveryRoute,
  filesystemRoute ?? { handle: 'filesystem' },
  apiRootDataRoute ?? { src: '/api/root-data', dest: '/api/root-data' },
  apiCatchAllRoute ?? { src: '/api/(?:.*)', dest: '/api/[...]' },
  // Social permalinks go through the Nitro shell handler (server/routes/[...].ts)
  // so crawlers receive per-post/per-profile Open Graph tags; every other page
  // keeps the plain static shell below.
  ...(serverFallbackRoute
    ? [
        { src: '^/post/[^/]+/?$', headers: appShellHeaders, dest: serverFallbackRoute.dest },
        { src: '^/profile/[^/]+/?$', headers: appShellHeaders, dest: serverFallbackRoute.dest }
      ]
    : []),
  { src: '/(?:.*)', headers: appShellHeaders, dest: '/index.html' }
];

if (serverFallbackRoute) {
  config.routes.push(serverFallbackRoute);
}

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log('[vercel] Routed non-API app paths to the Vite index.html shell.');
