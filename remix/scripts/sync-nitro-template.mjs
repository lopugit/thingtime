#!/usr/bin/env node

import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('server/assets', { recursive: true });
copyFileSync('dist/index.html', 'server/assets/index.html');
console.log('[nitro] Synced dist/index.html to server/assets/index.html.');
