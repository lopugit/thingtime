#!/usr/bin/env node

import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { findSourceMapAnnotation } from './embed-bundle-source-map.mjs';

const outputDir = 'dist/embed';
const publicDir = 'public/embed';
const outputPath = join(outputDir, 'thingtime.min.js');

const fileNames = (dir) =>
	readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name);

// dist/embed holds two unrelated things: what `vite build --config
// vite.embed.config.ts` generated, and the verbatim copies of public/embed/
// that the preceding client build dropped there. Only the generated half has to
// be a single file. The demo page's hand-written scripts are external (the
// deployed CSP refuses inline ones) and are not extra chunks, so subtract the
// copied names before asserting — otherwise adding one fails the whole build.
const copiedAssets = new Set(fileNames(publicDir));
const generatedAssets = fileNames(outputDir).filter((file) => /\.(?:js|css|map)$/i.test(file) && !copiedAssets.has(file));

if (generatedAssets.length !== 1 || generatedAssets[0] !== 'thingtime.min.js') {
	throw new Error(`Embed build must generate exactly one asset; found: ${generatedAssets.join(', ') || 'none'}`);
}

const source = readFileSync(outputPath, 'utf8');
if (!source.includes('Thingtime') || source.length < 1_000) {
	throw new Error('Embed bundle is missing or unexpectedly empty.');
}
const sourceMapAnnotation = findSourceMapAnnotation(source);
if (sourceMapAnnotation) {
	throw new Error(`Embed bundle must not reference a separate source map; found "${sourceMapAnnotation}".`);
}
const syntaxCheck = spawnSync(process.execPath, ['--check', outputPath], { encoding: 'utf8' });
if (syntaxCheck.status !== 0) {
	throw new Error(`Embed bundle is not valid classic JavaScript:\n${syntaxCheck.stderr || syntaxCheck.stdout}`);
}

const bytes = statSync(outputPath).size;
const gzipBytes = gzipSync(source).byteLength;
console.log(`[verify] Single-file embed ready: ${outputPath} (${bytes.toLocaleString()} bytes, ${gzipBytes.toLocaleString()} gzip).`);
