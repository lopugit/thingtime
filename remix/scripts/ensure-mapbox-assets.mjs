#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { version } = require('mapbox-gl/package.json');
if (version !== '3.30.0') throw new Error('Update the saved map SDK URL version before changing mapbox-gl.');

const destination = fileURLToPath(new URL(`../public/vendor/mapbox-gl/v${version}/`, import.meta.url));
mkdirSync(destination, { recursive: true });
for (const file of ['mapbox-gl.js', 'mapbox-gl.css']) {
	const source = require.resolve(`mapbox-gl/dist/${file}`);
	const target = join(destination, file);
	const digest = (path) => { try { return createHash('sha256').update(readFileSync(path)).digest('hex'); } catch { return ''; } };
	if (digest(source) !== digest(target)) copyFileSync(source, target);
}
