#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

const configPath = '.vercel/output/config.json';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const routes = Array.isArray(config.routes) ? config.routes : [];

const filesystemRoute = routes.find((route) => route.handle === 'filesystem');
const apiRootDataRoute = routes.find((route) => route.src === '/api/root-data');
const apiCatchAllRoute = routes.find((route) => route.src === '/api/(?:.*)');
const serverFallbackRoute = routes.find((route) => route.dest === '/__server');

config.routes = [
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
