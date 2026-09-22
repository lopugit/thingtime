import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';

const WRAPPER = '@anthropic-ai/claude-code';
const LIMIT = 250 * 1024 * 1024;
const vercelArchitecture = (arch) => arch === 'x64' ? 'x86_64' : arch;
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const inside = (root, path) => {
	const rel = relative(root, path);
	return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
const confined = async (root, path) => {
	const actual = await realpath(path);
	if (!inside(root, actual)) throw new Error(`Claude runtime asset escapes function root: ${relative(root, path)}`);
	return actual;
};

// Nitro aliases share __server.func; Workflow emits independent nested roots.
// Discover those roots without traversing aliases, packages or symlink cycles.
export async function claudeRuntimeFunctions(functionsRoot = '.vercel/output/functions') {
	const root = await realpath(functionsRoot);
	const server = await confined(root, join(root, '__server.func'));
	const roots = new Set([server]);
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.name.endsWith('.func') && (entry.isDirectory() || entry.isSymbolicLink())) roots.add(await confined(root, path));
			else if (entry.isDirectory() && entry.name !== 'node_modules') await visit(path);
		}
	}
	async function referencesRuntime(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory() && entry.name !== 'node_modules' && await referencesRuntime(path)) return true;
			if (entry.isFile() && /\.(?:c|m)?js$/.test(entry.name) && (await readFile(path, 'utf8')).includes(`${WRAPPER}/package.json`)) return true;
		}
		return false;
	}
	await visit(root);
	const selected = [];
	for (const path of roots) {
		if (path !== server && !await referencesRuntime(path)) continue;
		const config = await readJson(join(path, '.vc-config.json'));
		if (!/^nodejs\d+\.x$/.test(config.runtime) || !config.handler) throw new Error('Claude runtime requires a Node function with a handler.');
		await confined(path, resolve(path, config.handler));
		selected.push({ path, name: relative(root, path), config });
	}
	return selected;
}

async function directoryBytes(root) {
	const seen = new Set();
	async function visit(path) {
		const actual = await confined(root, path);
		if (seen.has(actual)) return 0;
		seen.add(actual);
		const info = await lstat(actual);
		if (!info.isDirectory()) return info.size;
		let bytes = 0;
		for (const name of await readdir(actual)) bytes += await visit(join(actual, name));
		return bytes;
	}
	return visit(root);
}

async function verifyFunctionRuntime(fn, { platform, arch, maxFunctionBytes }) {
	// Resolve from the actual emitted entry, then reject fallback into the
	// checkout's node_modules. A healthy development install cannot hide a hole.
	const require = createRequire(join(fn.path, fn.config.handler));
	const wrapperPath = await confined(fn.path, require.resolve(`${WRAPPER}/package.json`));
	const wrapper = await readJson(wrapperPath);
	const nativeName = `${WRAPPER}-${platform}-${arch}`;
	const nativePath = await confined(fn.path, createRequire(wrapperPath).resolve(`${nativeName}/package.json`));
	const native = await readJson(nativePath);
	if (wrapper.name !== WRAPPER || native.name !== nativeName || native.version !== wrapper.version) throw new Error('Claude runtime version or platform mismatch.');
	if (fn.config.architecture !== vercelArchitecture(arch)) throw new Error(`Claude runtime architecture mismatch in ${fn.name}.`);
	const nativeRoot = dirname(nativePath);
	const manifest = await readJson(await confined(fn.path, join(nativeRoot, 'runtime.json')));
	if (!Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0 || manifest.bytes > LIMIT || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('Invalid Claude runtime manifest.');
	const compressed = await confined(fn.path, join(nativeRoot, 'claude.gz'));
	const hash = createHash('sha256');
	let expandedBytes = 0;
	await pipeline(createReadStream(compressed), createGunzip(), new Writable({
		write(chunk, _encoding, callback) {
			expandedBytes += chunk.length;
			if (expandedBytes > manifest.bytes) return callback(new Error('Claude runtime exceeds declared size.'));
			hash.update(chunk);
			callback();
		}
	}));
	if (expandedBytes !== manifest.bytes || hash.digest('hex') !== manifest.sha256) throw new Error('Claude runtime integrity check failed.');
	const bytes = await directoryBytes(fn.path);
	if (bytes > maxFunctionBytes) throw new Error(`Claude function ${fn.name} exceeds the Vercel uncompressed size limit.`);
	return { function: fn.name, nativeName, version: native.version, bytes };
}

export async function verifyClaudeOAuthArtifacts({ functionsRoot = '.vercel/output/functions', platform = process.platform, arch = process.arch, maxFunctionBytes = LIMIT } = {}) {
	const functions = await claudeRuntimeFunctions(functionsRoot);
	const result = [];
	for (const fn of functions) result.push(await verifyFunctionRuntime(fn, { platform, arch, maxFunctionBytes }));
	return result;
}

export async function packageClaudeOAuthArtifacts({ functionsRoot = '.vercel/output/functions', resolveFrom = import.meta.url, platform = process.platform, arch = process.arch, maxFunctionBytes = LIMIT } = {}) {
	if (!['linux', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Unsupported Claude runtime build platform.');
	const functions = await claudeRuntimeFunctions(functionsRoot);
	const wrapperPath = createRequire(resolveFrom).resolve(`${WRAPPER}/package.json`);
	const wrapper = await readJson(wrapperPath);
	const nativeName = `${WRAPPER}-${platform}-${arch}`;
	const nativePath = createRequire(wrapperPath).resolve(`${nativeName}/package.json`);
	const native = await readJson(nativePath);
	if (wrapper.name !== WRAPPER || native.name !== nativeName || native.version !== wrapper.version) throw new Error('Claude runtime version or platform mismatch.');
	const stage = await mkdtemp(join(tmpdir(), 'thingtime-claude-package-'));
	try {
		let bytes = 0;
		const hash = createHash('sha256');
		await pipeline(createReadStream(join(dirname(nativePath), 'claude')), new Transform({
			transform(chunk, _encoding, callback) {
				bytes += chunk.length;
				if (bytes > LIMIT) return callback(new Error('Claude runtime exceeds the size limit.'));
				hash.update(chunk);
				callback(null, chunk);
			}
		}), createGzip({ level: 9 }), createWriteStream(join(stage, 'claude.gz')));
		await writeFile(join(stage, 'runtime.json'), JSON.stringify({ bytes, sha256: hash.digest('hex') }));
		for (const fn of functions) {
			const packages = join(fn.path, 'node_modules', '@anthropic-ai');
			// Check each ancestor before creating beneath it; never follow a
			// generated node_modules symlink back into the builder's install.
			for (const parent of [join(fn.path, 'node_modules'), packages]) {
				try { await confined(fn.path, parent); }
				catch (error) { if (error.code !== 'ENOENT') throw error; await mkdir(parent); }
			}
			const wrapperRoot = join(packages, 'claude-code');
			const nativeRoot = join(packages, nativeName.split('/')[1]);
			// Replace only owned runtime directories, removing stale raw binaries
			// and symlink entries without copying any developer configuration.
			for (const path of [wrapperRoot, nativeRoot]) {
				await rm(path, { recursive: true, force: true });
				await mkdir(path);
			}
			await cp(wrapperPath, join(wrapperRoot, 'package.json'));
			await cp(nativePath, join(nativeRoot, 'package.json'));
			for (const name of ['runtime.json', 'claude.gz']) await cp(join(stage, name), join(nativeRoot, name));
			// The executable is selected for the build machine. Workflow may
			// default to another CPU; pin its function to the packaged CPU too.
			fn.config.architecture = vercelArchitecture(arch);
			await writeFile(join(fn.path, '.vc-config.json'), JSON.stringify(fn.config, null, 2));
		}
	} finally {
		await rm(stage, { recursive: true, force: true });
	}
	return verifyClaudeOAuthArtifacts({ functionsRoot, platform, arch, maxFunctionBytes });
}
