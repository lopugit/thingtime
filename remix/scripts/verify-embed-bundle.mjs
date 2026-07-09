#!/usr/bin/env node

import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const outputDir = 'dist/embed';
const outputPath = join(outputDir, 'thingtime.min.js');
const files = readdirSync(outputDir, { withFileTypes: true })
	.filter((entry) => entry.isFile())
	.map((entry) => entry.name);
const generatedAssets = files.filter((file) => /\.(?:js|css|map)$/i.test(file));

if (generatedAssets.length !== 1 || generatedAssets[0] !== 'thingtime.min.js') {
	throw new Error(`Embed build must contain exactly one generated asset; found: ${generatedAssets.join(', ') || 'none'}`);
}

const source = readFileSync(outputPath, 'utf8');
if (!source.includes('Thingtime') || source.length < 1_000) {
	throw new Error('Embed bundle is missing or unexpectedly empty.');
}
if (/sourceMappingURL=/.test(source)) {
	throw new Error('Embed bundle must not reference a separate source map.');
}
const syntaxCheck = spawnSync(process.execPath, ['--check', outputPath], { encoding: 'utf8' });
if (syntaxCheck.status !== 0) {
	throw new Error(`Embed bundle is not valid classic JavaScript:\n${syntaxCheck.stderr || syntaxCheck.stdout}`);
}

const bytes = statSync(outputPath).size;
const gzipBytes = gzipSync(source).byteLength;
console.log(`[verify] Single-file embed ready: ${outputPath} (${bytes.toLocaleString()} bytes, ${gzipBytes.toLocaleString()} gzip).`);
