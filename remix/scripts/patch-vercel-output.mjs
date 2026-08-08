#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

import { authorizeCsp, designBundlesCsp, prodCsp } from './csp.mjs';

const configPath = '.vercel/output/config.json';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const routes = Array.isArray(config.routes) ? config.routes : [];

const filesystemRoute = routes.find((route) => route.handle === 'filesystem');
const apiRootDataRoute = routes.find((route) => route.src === '/api/root-data');
const apiCatchAllRoute = routes.find((route) => route.src === '/api/(?:.*)');
const serverFallbackRoute = routes.find((route) => route.dest === '/__server');

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
  { src: '^/$', dest: '/index.html' },
  filesystemRoute ?? { handle: 'filesystem' },
  apiRootDataRoute ?? { src: '/api/root-data', dest: '/api/root-data' },
  apiCatchAllRoute ?? { src: '/api/(?:.*)', dest: '/api/[...]' },
  { src: '/(?:.*)', dest: '/index.html' }
];

if (serverFallbackRoute) {
  config.routes.push(serverFallbackRoute);
}

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log('[vercel] Routed non-API app paths to the Vite index.html shell.');
