#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const indexHtml = readFileSync('.vercel/output/static/index.html', 'utf8');
const config = readJson('.vercel/output/config.json');

if (!indexHtml.includes('<div id="root"></div>')) {
  throw new Error('Vercel output is missing the Vite root shell.');
}

const previewFreshnessIndex = indexHtml.indexOf('data-thingtime-preview-freshness');
const appEntryTag = [...indexHtml.matchAll(/<script\b[^>]*>/gi)].find(
  (match) => /\btype=["']module["']/i.test(match[0]) && /\bsrc=["'][^"']*\/assets\/index-[^"']+\.js/i.test(match[0])
);
const appEntryIndex = appEntryTag?.index ?? -1;
if (previewFreshnessIndex === -1 || appEntryIndex === -1 || previewFreshnessIndex > appEntryIndex) {
  throw new Error('Vercel output does not load preview recovery before the application entry.');
}

const hasFilesystemRoute = config.routes?.some((route) => route.handle === 'filesystem');
if (!hasFilesystemRoute) {
  throw new Error('Vercel output config does not check filesystem routes before server fallback.');
}

const routes = config.routes ?? [];
const filesystemIndex = routes.findIndex((route) => route.handle === 'filesystem');
const apiIndex = routes.findIndex((route) => route.src === '/api/(?:.*)');
const rootIndex = routes.findIndex((route) => route.src === '^/$' && route.dest === '/index.html');
const directIndex = routes.findIndex((route) => route.src === '^/index\\.html$' && route.dest === '/index.html');
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

if (directIndex === -1) {
  throw new Error('Vercel output config does not route /index.html to the static shell.');
}

const expectedAppShellCacheControl = 'private, no-store, max-age=0, must-revalidate';
for (const [name, index] of [
  ['root', rootIndex],
  ['direct index', directIndex],
  ['SPA fallback', spaIndex]
]) {
  const headers = routes[index]?.headers;
  if (headers?.['Cache-Control'] !== expectedAppShellCacheControl || headers?.Pragma !== 'no-cache' || headers?.Expires !== '0') {
    throw new Error(`Vercel output ${name} route does not disable browser caching for the HTML shell.`);
  }
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
    route.headers?.['Content-Security-Policy'] === "frame-ancestors 'none'"
);
if (authorizeHeadersIndex === -1) {
  throw new Error('Vercel output config does not frame-deny the /authorize consent page.');
}
if (authorizeHeadersIndex > spaIndex) {
  throw new Error('Vercel output stamps /authorize frame-deny headers after the SPA fallback.');
}

console.log(
  '[verify] Vercel output includes the pre-app preview guard, no-store HTML shell, filesystem route, SPA fallback, and /authorize frame-deny.'
);
