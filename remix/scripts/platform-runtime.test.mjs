import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { platformRuntimeCsp, prodCsp, devCsp } from './csp.mjs';
import { builtPlatformScriptHash, platformInlineSource, platformRuntimeDocument, platformScriptHash } from './platform-runtime.mjs';
import { platformRuntimePlugin } from './platform-runtime-plugin.mjs';

const html = '<!doctype html><html><head></head><body><div id="surface"></div><script src="/platform/runtime.js?v=abcd"></script></body></html>';
const directives = (policy) =>
	Object.fromEntries(
		policy.split(';').map((part) => {
			const [key, ...values] = part.trim().split(/\s+/);
			return [key, values];
		})
	);
test('self-contained renderer preserves code and pins its only inline script by exact hash', () => {
	const code = 'globalThis.value = "</ScRiPt><script>blocked</script>";';
	const document = platformRuntimeDocument({ code, html }, platformRuntimeCsp);
	const scripts = [...document.matchAll(/<script>([\s\S]*?)<\/script>/g)];
	assert.equal(scripts.length, 1);
	assert.equal(scripts[0][1], platformInlineSource(code));
	const context = {};
	runInNewContext(scripts[0][1], context);
	assert.equal(context.value, '</ScRiPt><script>blocked</script>');
	const hash = `'sha256-${createHash('sha256').update(scripts[0][1]).digest('base64')}'`;
	assert.equal(platformScriptHash(code), hash);
	assert.notEqual(platformScriptHash(code + ' '), hash);
	const policy = directives(document.match(/Content-Security-Policy" content="([^"]+)"/)[1]);
	assert.deepEqual(policy['script-src'], [hash]);
	for (const key of ['connect-src', 'worker-src', 'style-src', 'img-src', 'media-src', 'font-src', 'base-uri', 'form-action'])
		assert.deepEqual(policy[key], directives(platformRuntimeCsp)[key], key);
	assert.equal(policy.sandbox, undefined, 'sandbox is enforced by the iframe attribute; CSP meta cannot set it');
	assert.ok(document.indexOf('Content-Security-Policy') < document.indexOf('<script>'));
	assert.ok(!document.includes('src="/platform/'));
});
test('malformed build templates fail closed and external/inert bundles retain standalone behavior', () => {
	for (const template of [
		'',
		html.replace('<head>', ''),
		html.replace('/platform/runtime.js', '/caller/script.js'),
		html.replace('</body>', '<script src="/platform/runtime.js"></script></body>')
	])
		assert.throws(() => platformRuntimeDocument({ code: 'void 0;', html: template }, platformRuntimeCsp), /Unexpected/);
	const plugin = platformRuntimePlugin({ external: true });
	const id = plugin.resolveId('virtual:thingtime-platform-document');
	assert.equal(plugin.load(id), 'export default null;');
	assert.equal(plugin.resolveId('arbitrary'), undefined);
	assert.equal(plugin.generateBundle(), undefined);
});
test('production permits only the exact shipped runtime hash, without widening script schemes or eval', () => {
	const production = directives(prodCsp)['script-src'];
	for (const source of ["'unsafe-inline'", "'unsafe-eval'", 'blob:', 'data:', '*']) assert.ok(!production.includes(source));
	const hash = builtPlatformScriptHash();
	assert.deepEqual(
		production.filter((source) => source.startsWith("'sha256-")),
		hash ? [hash] : []
	);
	assert.ok(directives(devCsp)['script-src'].includes("'unsafe-inline'"), 'existing HMR preamble still works');
	assert.equal(
		directives(devCsp)['script-src'].some((source) => source.startsWith("'sha256-")),
		false,
		'a hash would disable the dev inline preamble'
	);
});

test('build output survives main dist cleanup and runtime rebuilds invalidate the dev document', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'thingtime-platform-'));
	const server = new EventEmitter();
	try {
		await mkdir(join(directory, 'scripts'));
		await mkdir(join(directory, 'dist/platform'), { recursive: true });
		for (const file of ['platform-runtime-plugin.mjs', 'platform-runtime.mjs', 'csp.mjs'])
			await cp(new URL(file, import.meta.url), join(directory, 'scripts', file));
		const { platformRuntimePlugin: createPlugin } = await import(pathToFileURL(join(directory, 'scripts/platform-runtime-plugin.mjs')).href);
		const plugin = createPlugin();
		const id = plugin.resolveId('virtual:thingtime-platform-document');
		assert.throws(() => plugin.load(id), /Run npm run build:platform/);
		const code = 'globalThis.rendererRevision = 1;';
		await writeFile(join(directory, 'dist/platform/runtime.js'), code);
		await writeFile(join(directory, 'dist/platform/runtime.html'), html);
		assert.ok(plugin.load(id).includes(code));
		const emitted = [];
		plugin.generateBundle.call({ emitFile: (asset) => emitted.push(asset) });
		assert.deepEqual(
			emitted.map(({ fileName, source }) => [fileName, source]),
			[
				['platform/runtime.js', code],
				['platform/runtime.html', html]
			]
		);
		const module = {};
		let invalidated = false;
		const changed = new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Runtime watcher did not reload the document')), 5000);
			server.once('close', () => clearTimeout(timeout));
			plugin.configureServer({
				httpServer: server,
				moduleGraph: {
					getModuleById: (key) => (key === id ? module : undefined),
					invalidateModule: (value) => {
						assert.equal(value, module);
						invalidated = true;
					}
				},
				ws: {
					send: (message) => {
						clearTimeout(timeout);
						resolve(message);
					}
				}
			});
		});
		const next = 'globalThis.rendererRevision = 222;';
		await writeFile(join(directory, 'dist/platform/runtime.js'), next);
		assert.deepEqual(await changed, { type: 'full-reload' });
		assert.equal(invalidated, true);
		assert.ok(plugin.load(id).includes(next));
		assert.ok(!plugin.load(id).includes(code));
	} finally {
		server.emit('close');
		await rm(directory, { recursive: true, force: true });
	}
});
