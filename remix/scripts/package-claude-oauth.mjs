#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, stat, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Nitro cannot statically trace a platform-selected executable. Ship only the
// pinned native runtime for this builder, never developer configuration.
const require = createRequire(import.meta.url);
const wrapperPath = require.resolve('@anthropic-ai/claude-code/package.json');
const wrapper = JSON.parse(await readFile(wrapperPath, 'utf8'));
const nativeName = `@anthropic-ai/claude-code-${process.platform}-${process.arch}`;
const nativePath = createRequire(wrapperPath).resolve(`${nativeName}/package.json`);
const native = JSON.parse(await readFile(nativePath, 'utf8'));
if (native.version !== wrapper.version) throw new Error('Claude runtime version mismatch');
const functionRoot = '.vercel/output/functions/__server.func';
const packageRoot = join(functionRoot, 'node_modules/@anthropic-ai');
await mkdir(join(packageRoot, 'claude-code'), { recursive: true });
await writeFile(join(packageRoot, 'claude-code/package.json'), JSON.stringify(wrapper));
const nativeRoot = join(packageRoot, nativeName.split('/')[1]);
await mkdir(nativeRoot, { recursive: true });
await cp(nativePath, join(nativeRoot, 'package.json'));
const binaryPath = join(dirname(nativePath), 'claude');
const binaryBytes = await readFile(binaryPath);
await writeFile(
	join(nativeRoot, 'runtime.json'),
	JSON.stringify({ bytes: binaryBytes.length, sha256: createHash('sha256').update(binaryBytes).digest('hex') })
);
await pipeline(createReadStream(binaryPath), createGzip({ level: 9 }), createWriteStream(join(nativeRoot, 'claude.gz')));
await rm(join(nativeRoot, 'claude'), { force: true });
const directoryBytes = async (root) => {
	let bytes = 0;
	for (const item of await readdir(root, { withFileTypes: true })) {
		const path = join(root, item.name);
		bytes += item.isDirectory() ? await directoryBytes(path) : (await stat(path)).size;
	}
	return bytes;
};
const bytes = await directoryBytes(functionRoot);
if (bytes > 250 * 1024 * 1024) throw new Error('Claude server function exceeds the Vercel uncompressed size limit');
console.log(`[claude-oauth] Packaged ${nativeName}@${native.version}; server function ${(bytes / 1024 / 1024).toFixed(1)} MiB`);
