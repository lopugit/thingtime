#!/usr/bin/env node

import { readFileSync } from 'node:fs';

import { authorizeCsp, prodCsp } from './csp.mjs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const indexHtml = readFileSync('.vercel/output/static/index.html', 'utf8');
const config = readJson('.vercel/output/config.json');

if (!indexHtml.includes('<div id="root"></div>')) {
  throw new Error('Vercel output is missing the Vite root shell.');
}

const hasFilesystemRoute = config.routes?.some((route) => route.handle === 'filesystem');
if (!hasFilesystemRoute) {
  throw new Error('Vercel output config does not check filesystem routes before server fallback.');
}

const routes = config.routes ?? [];
const filesystemIndex = routes.findIndex((route) => route.handle === 'filesystem');
const apiIndex = routes.findIndex((route) => route.src === '/api/(?:.*)');
const rootIndex = routes.findIndex((route) => route.src === '^/$' && route.dest === '/index.html');
const spaIndex = routes.findIndex(
  (route) => route.src === '/(?:.*)' && route.dest === '/index.html'
);
const serverFallbackIndex = routes.findIndex((route) => route.dest === '/__server');

if (spaIndex === -1) {
  throw new Error('Vercel output config does not route non-API app paths to /index.html.');
}

if (rootIndex === -1) {
  throw new Error('Vercel output config does not route / to /index.html.');
}

if (rootIndex > filesystemIndex) {
  throw new Error('Vercel output checks filesystem routes before the / static shell rewrite.');
}

if (filesystemIndex > spaIndex) {
  throw new Error('Vercel output checks the SPA fallback before static filesystem assets.');
}

if (apiIndex > spaIndex) {
  throw new Error('Vercel output checks the SPA fallback before API routes.');
}

if (rootIndex > spaIndex) {
  throw new Error('Vercel output checks the catch-all SPA fallback before the / route.');
}

if (serverFallbackIndex !== -1 && serverFallbackIndex < spaIndex) {
  throw new Error('Vercel output checks the Nitro server fallback before the SPA shell.');
}

const authorizeHeadersIndex = routes.findIndex(
  (route) =>
    route.continue === true &&
    typeof route.src === 'string' &&
    route.src.includes('/authorize') &&
    route.headers?.['X-Frame-Options'] === 'DENY' &&
    route.headers?.['Content-Security-Policy'] === authorizeCsp
);
if (authorizeHeadersIndex === -1) {
  throw new Error('Vercel output config does not frame-deny the /authorize consent page.');
}
if (authorizeHeadersIndex > spaIndex) {
  throw new Error('Vercel output stamps /authorize frame-deny headers after the SPA fallback.');
}

const cspHeadersIndex = routes.findIndex(
  (route) =>
    route.continue === true &&
    route.src === '/(?:.*)' &&
    route.headers?.['Content-Security-Policy'] === prodCsp
);
if (cspHeadersIndex === -1) {
  throw new Error('Vercel output config does not stamp the global Content-Security-Policy.');
}
if (cspHeadersIndex > spaIndex) {
  throw new Error('Vercel output stamps the global CSP after the SPA fallback.');
}
if (cspHeadersIndex > authorizeHeadersIndex) {
  throw new Error('Vercel output stamps the global CSP after the /authorize override, so /authorize would lose frame-ancestors.');
}
for (const route of routes) {
  const csp = route.headers?.['Content-Security-Policy'];
  if (typeof csp === 'string' && csp.includes('unsafe-eval')) {
    throw new Error(`Vercel output CSP re-introduces 'unsafe-eval' (route ${route.src}).`);
  }
}
if (!authorizeCsp.includes("frame-ancestors 'none'")) {
  throw new Error("/authorize CSP lost frame-ancestors 'none'.");
}

console.log('[verify] Vercel output includes the Vite shell, filesystem route, SPA fallback, global CSP (no unsafe-eval), and /authorize frame-deny.');
