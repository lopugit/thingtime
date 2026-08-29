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

// Weight is a product constraint here, not a build detail: every third-party
// host page downloads this whole file just to render a JSON tree. The one IIFE
// also carries the first-party popup editor (React, Chakra, Emotion, the legacy
// smarts module) because bridge.html loads the same asset, which is why the
// ceiling is this high — see docs/THINGTIME_EMBED.md. Without a budget that
// cost grows silently on someone else's homepage; the asset-count check above
// only catches an extra *file*, never a bigger one. Raise these deliberately,
// in a commit that says why.
const MAX_GZIP_BYTES = 700 * 1024;
const MAX_BYTES = 2_500 * 1024;

for (const [label, actual, budget] of [
	['gzip', gzipBytes, MAX_GZIP_BYTES],
	['raw', bytes, MAX_BYTES]
]) {
	if (actual > budget) {
		throw new Error(
			`Embed bundle ${label} size is ${actual.toLocaleString()} bytes, over its ${budget.toLocaleString()} byte budget. ` +
				'Trim what the host page downloads, or raise the budget in scripts/verify-embed-bundle.mjs on purpose.'
		);
	}
}

console.log(
	`[verify] Single-file embed ready: ${outputPath} (${bytes.toLocaleString()} bytes, ${gzipBytes.toLocaleString()} gzip; ` +
		`budget ${MAX_BYTES.toLocaleString()} / ${MAX_GZIP_BYTES.toLocaleString()} gzip).`
);
