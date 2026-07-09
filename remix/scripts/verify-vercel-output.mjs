#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const indexHtml = readFileSync('.vercel/output/static/index.html', 'utf8');
const embedBundle = readFileSync('.vercel/output/static/embed/thingtime.min.js', 'utf8');
const embedBridge = readFileSync('.vercel/output/static/embed/bridge.html', 'utf8');
const config = readJson('.vercel/output/config.json');

if (!indexHtml.includes('<div id="root"></div>')) {
  throw new Error('Vercel output is missing the Vite root shell.');
}

if (!embedBundle.includes('Thingtime') || embedBundle.includes('sourceMappingURL=')) {
  throw new Error('Vercel output is missing the standalone minified Thingtime embed bundle.');
}

if (!embedBridge.includes('/embed/thingtime.min.js')) {
  throw new Error('Vercel output is missing the secure Thingtime popup bridge.');
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

console.log('[verify] Vercel output includes the Vite shell, Thingtime embed, filesystem route, and SPA fallback.');
