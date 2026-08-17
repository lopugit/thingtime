#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

const configPath = '.vercel/output/config.json';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const routes = Array.isArray(config.routes) ? config.routes : [];

const filesystemRoute = routes.find((route) => route.handle === 'filesystem');
const apiRootDataRoute = routes.find((route) => route.src === '/api/root-data');
const apiCatchAllRoute = routes.find((route) => route.src === '/api/(?:.*)');
const serverFallbackRoute = routes.find((route) => route.dest === '/__server');
const appShellHeaders = {
  'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0'
};

config.routes = [
  // The /authorize consent popup must never render inside a frame (UI-redress
  // hardening; token delivery already requires window.opener + a validated
  // origin). Headers-only route: stamp and continue matching, so the page is
  // still served by the SPA fallback below.
  {
    src: '^/authorize/?$',
    headers: {
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "frame-ancestors 'none'"
    },
    continue: true
  },
  { src: '^/$', headers: appShellHeaders, dest: '/index.html' },
  { src: '^/index\\.html$', headers: appShellHeaders, dest: '/index.html' },
  filesystemRoute ?? { handle: 'filesystem' },
  apiRootDataRoute ?? { src: '/api/root-data', dest: '/api/root-data' },
  apiCatchAllRoute ?? { src: '/api/(?:.*)', dest: '/api/[...]' },
  { src: '/(?:.*)', headers: appShellHeaders, dest: '/index.html' }
];

if (serverFallbackRoute) {
  config.routes.push(serverFallbackRoute);
}

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log('[vercel] Routed non-API app paths to the Vite index.html shell.');
