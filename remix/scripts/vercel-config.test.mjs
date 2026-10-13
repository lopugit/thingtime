import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { prodCsp, devCsp } from './csp.mjs';
import { platformRuntimeCsp } from './csp.mjs';
import { execFileSync } from 'node:child_process';
import { claudeRuntimeFunctions, packageClaudeOAuthArtifacts, verifyClaudeOAuthArtifacts } from './claude-oauth-artifacts.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const vercelConfig = JSON.parse(readFileSync(resolve(repositoryRoot, 'vercel.json'), 'utf8'));

test('live form event context stays opaque and cannot navigate or reach the account network', () => {
	const directives = Object.fromEntries(platformRuntimeCsp.split(';').map(part => {
		const [name, ...values] = part.trim().split(/\s+/); return [name, values];
	}));
	assert.deepEqual(directives.sandbox, ['allow-scripts', 'allow-forms']);
	assert.deepEqual(directives['form-action'], ["'none'"]);
	assert.deepEqual(directives['connect-src'], ['data:', 'blob:']);
	assert.deepEqual(directives['base-uri'], ["'none'"]);
});

test('emitted Web Platform routes prevent stale compiler reuse and keep document CSP scoped', async (t) => {
	const root = await fs.mkdtemp(join(tmpdir(), 'thingtime-platform-routes-'));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const output = join(root, '.vercel/output');
	await fs.mkdir(join(output, 'functions/__server.func'), { recursive: true });
	await fs.writeFile(join(output, 'config.json'), JSON.stringify({ routes: [{ handle: 'filesystem' }, { src: '/(?:.*)', dest: '/__server' }] }));
	await fs.writeFile(join(output, 'functions/__server.func/.vc-config.json'), '{}');
	execFileSync(process.execPath, [join(repositoryRoot, 'remix/scripts/patch-vercel-output.mjs')], { cwd: root, stdio: 'pipe' });
	const { routes } = JSON.parse(await fs.readFile(join(output, 'config.json'), 'utf8'));
	for (const extension of ['html', 'js']) {
		const matches = routes.filter(route => route.src === `^/platform/runtime\\.${extension}$`);
		assert.equal(matches.length, 1);
		assert.equal(matches[0].headers['Cache-Control'], 'no-store');
		assert.equal(matches[0].continue, true);
		assert.ok(routes.indexOf(matches[0]) < routes.findIndex(route => route.handle === 'filesystem'));
		assert.equal(matches[0].headers['Content-Security-Policy'], extension === 'html' ? platformRuntimeCsp : undefined);
	}
});

test('Vercel cron path and schedule pairs are unique', () => {
	const crons = vercelConfig.crons ?? [];
	const cronKeys = crons.map(({ path, schedule }) => `${path}\u0000${schedule}`);

	assert.equal(new Set(cronKeys).size, cronKeys.length, 'vercel.json must not register the same cron path and schedule twice');
});

test('recording processing, attachment cleanup, moderation sweep, peer sync, and notification digest schedules are registered once', () => {
	assert.deepEqual(vercelConfig.crons, [
		{ path: '/api/v1/auth/invites/expire', schedule: '11 * * * *' },
		{
			path: '/api/v1/lopu/recordings/run',
			schedule: '*/5 * * * *'
		},
		{
			path: '/api/v1/attachments/cleanup',
			schedule: '17 * * * *'
		},
		{
			path: '/api/v1/moderation/sweep',
			schedule: '29 * * * *'
		},
		{
			path: '/api/v1/peers/sync',
			schedule: '*/5 * * * *'
		},
		{
			path: '/api/v1/notifications/email/weekly-summary',
			schedule: '37 21 * * 0'
		}
	]);
});

const cspSources = (csp, name) =>
	csp
		.split(';')
		.map((s) => s.trim())
		.find((s) => s.startsWith(name + ' '))
		.split(/\s+/)
		.slice(1);
test('native Maps can load under the deployed policy without broad script or eval exceptions', () => {
	const scripts = cspSources(prodCsp, 'script-src');
	assert.deepEqual(scripts, [
		"'self'",
		'https://cdn.jsdelivr.net',
		'https://va.vercel-scripts.com',
		'https://maps.googleapis.com',
		'https://maps.gstatic.com'
	]);
	for (const policy of [prodCsp, devCsp]) {
		assert(!cspSources(policy, 'script-src').includes("'unsafe-eval'"));
		for (const host of [
			'https://maps.googleapis.com',
			'https://mapsresources-pa.googleapis.com',
			'https://maps.gstatic.com',
			'https://csi.gstatic.com'
		])
			assert(cspSources(policy, 'connect-src').includes(host));
	}
});

// Exercise the emitted function boundary, not just the packaging source text.

const runtimeReference = 'const runtime = "@anthropic-ai/claude-code/package.json";';
async function runtimeFixture(t, { arch = 'x64', includeStep = true } = {}) {
	const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'thingtime-claude-artifacts-test-')));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const builder = join(root, 'builder');
	const functionsRoot = join(builder, '.vercel/output/functions');
	const source = join(builder, 'node_modules/@anthropic-ai');
	const nativeName = `claude-code-linux-${arch}`;
	const binary = Buffer.from('synthetic pinned native executable, no credentials or developer settings');
	const json = (path, value) => fs.writeFile(path, JSON.stringify(value));
	for (const name of ['claude-code', nativeName]) await fs.mkdir(join(source, name), { recursive: true });
	await json(join(builder, 'package.json'), {});
	await json(join(source, 'claude-code/package.json'), { name: '@anthropic-ai/claude-code', version: '1.2.3' });
	await json(join(source, nativeName, 'package.json'), { name: `@anthropic-ai/${nativeName}`, version: '1.2.3' });
	await fs.writeFile(join(source, nativeName, 'claude'), binary);
	const addFunction = async (name, sourceText = runtimeReference, config = {}) => {
		const path = join(functionsRoot, name);
		await fs.mkdir(path, { recursive: true });
		await json(join(path, '.vc-config.json'), { runtime: 'nodejs22.x', handler: 'index.js', maxDuration: 300, ...config });
		await fs.writeFile(join(path, 'index.js'), sourceText);
		return path;
	};
	const server = await addFunction('__server.func');
	const stepName = '.well-known/workflow/v1/step.func';
	const step = join(functionsRoot, stepName);
	if (includeStep) await addFunction(stepName, runtimeReference, { architecture: 'arm64', maxDuration: 'max', experimentalTriggers: [{ type: 'queue/v2beta', topic: 'fixture-step' }] });
	const flow = await addFunction('.well-known/workflow/v1/flow.func', 'export default () => {};', { architecture: 'arm64' });
	const webhook = await addFunction('.well-known/workflow/v1/webhook/[token].func', 'export default () => {};', { architecture: 'arm64' });
	await fs.symlink('__server.func', join(functionsRoot, 'index.func'));
	const options = { functionsRoot, resolveFrom: join(builder, 'package.json'), platform: 'linux', arch };
	return { root, source, server, step, stepName, flow, webhook, options, nativeName, binary, json, addFunction };
}

test('Claude runtime packages direct and nested Workflow function roots, deduplicates aliases and aligns CPU', async (t) => {
	const f = await runtimeFixture(t);
	const unrelatedConfigs = await Promise.all([f.flow, f.webhook].map(root => fs.readFile(join(root, '.vc-config.json'), 'utf8')));
	const packaged = await packageClaudeOAuthArtifacts(f.options);
	assert.deepEqual(packaged.map(item => item.function), ['__server.func', f.stepName]);
	for (const root of [f.server, f.step]) {
		const require = createRequire(join(root, 'index.js'));
		const wrapperPath = require.resolve('@anthropic-ai/claude-code/package.json');
		assert.equal(wrapperPath, join(root, 'node_modules/@anthropic-ai/claude-code/package.json'));
		const nativePath = createRequire(wrapperPath).resolve(`@anthropic-ai/${f.nativeName}/package.json`);
		const nativeRoot = dirname(nativePath);
		assert.deepEqual(gunzipSync(await fs.readFile(join(nativeRoot, 'claude.gz'))), f.binary);
		assert.deepEqual((await fs.readdir(nativeRoot)).sort(), ['claude.gz', 'package.json', 'runtime.json']);
		const config = JSON.parse(await fs.readFile(join(root, '.vc-config.json'), 'utf8'));
		assert.equal(config.architecture, 'x86_64');
		assert.equal(config.maxDuration, root === f.server ? 300 : 'max');
		if (root === f.step) assert.deepEqual(config.experimentalTriggers, [{ type: 'queue/v2beta', topic: 'fixture-step' }]);
	}
	for (const root of [f.flow, f.webhook]) await assert.rejects(fs.access(join(root, 'node_modules')));
	assert.deepEqual(await Promise.all([f.flow, f.webhook].map(root => fs.readFile(join(root, '.vc-config.json'), 'utf8'))), unrelatedConfigs);
	assert.equal(JSON.parse(await fs.readFile(join(f.flow, '.vc-config.json'), 'utf8')).architecture, 'arm64');
	// A repeated packaging pass replaces only its runtime, including stale raw
	// executables, while preserving other dependencies and generated settings.
	await fs.writeFile(join(f.step, 'node_modules/@anthropic-ai', f.nativeName, 'claude'), 'stale raw executable');
	await fs.mkdir(join(f.step, 'node_modules/unrelated'), { recursive: true });
	await fs.writeFile(join(f.step, 'node_modules/unrelated/keep'), 'keep');
	await packageClaudeOAuthArtifacts(f.options);
	assert.equal(await fs.readFile(join(f.step, 'node_modules/unrelated/keep'), 'utf8'), 'keep');
	await assert.rejects(fs.access(join(f.step, 'node_modules/@anthropic-ai', f.nativeName, 'claude')));
});

test('Claude verifier rejects original missing-Workflow packaging even when builder dependencies resolve', async (t) => {
	const f = await runtimeFixture(t, { includeStep: false });
	await packageClaudeOAuthArtifacts(f.options);
	await f.addFunction(f.stepName);
	// Node could resolve from the builder's parent node_modules, but Lambda
	// receives only this function directory. This must fail before deployment.
	const outside = createRequire(join(f.step, 'index.js')).resolve('@anthropic-ai/claude-code/package.json');
	assert.ok(outside.startsWith(f.source));
	await assert.rejects(verifyClaudeOAuthArtifacts(f.options), /escapes function root/);
});

test('Claude runtime retains arm64 and rejects an architecture changed after packaging', async (t) => {
	const f = await runtimeFixture(t, { arch: 'arm64' });
	await packageClaudeOAuthArtifacts(f.options);
	const path = join(f.step, '.vc-config.json');
	const config = JSON.parse(await fs.readFile(path, 'utf8'));
	assert.equal(config.architecture, 'arm64');
	await f.json(path, { ...config, architecture: 'x86_64' });
	await assert.rejects(verifyClaudeOAuthArtifacts(f.options), /architecture mismatch/);
});

test('Claude packaging refuses mismatched pinned native versions before copying', async (t) => {
	const f = await runtimeFixture(t);
	await f.json(join(f.source, f.nativeName, 'package.json'), { name: `@anthropic-ai/${f.nativeName}`, version: '9.9.9' });
	await assert.rejects(packageClaudeOAuthArtifacts(f.options), /version or platform mismatch/);
	await assert.rejects(fs.access(join(f.server, 'node_modules')));
});

test('Claude verifier detects corrupted bytes, manifest digest and declared size in the independent step', async (t) => {
	const f = await runtimeFixture(t);
	await packageClaudeOAuthArtifacts(f.options);
	const native = join(f.step, 'node_modules/@anthropic-ai', f.nativeName);
	const manifestPath = join(native, 'runtime.json');
	const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
	await f.json(manifestPath, { ...manifest, sha256: '0'.repeat(64) });
	await assert.rejects(verifyClaudeOAuthArtifacts(f.options), /integrity/);
	await f.json(manifestPath, { ...manifest, bytes: 1 });
	await assert.rejects(verifyClaudeOAuthArtifacts(f.options), /declared size/);
	await f.json(manifestPath, manifest);
	await fs.writeFile(join(native, 'claude.gz'), 'damaged');
	await assert.rejects(verifyClaudeOAuthArtifacts(f.options), /header|gzip|compression/);
});

test('Claude function size limit applies separately to the Workflow step', async (t) => {
	const f = await runtimeFixture(t);
	const packaged = await packageClaudeOAuthArtifacts(f.options);
	const limit = Math.max(...packaged.map(item => item.bytes)) + 100;
	await fs.writeFile(join(f.step, 'extra-asset'), Buffer.alloc(limit));
	await assert.rejects(verifyClaudeOAuthArtifacts({ ...f.options, maxFunctionBytes: limit }), /step\.func exceeds/);
});

test('Claude packaging rejects escaped function aliases and ignores non-function symlink cycles', async (t) => {
	const f = await runtimeFixture(t);
	await fs.symlink(f.options.functionsRoot, join(f.options.functionsRoot, 'cycle'));
	assert.equal((await claudeRuntimeFunctions(f.options.functionsRoot)).length, 2);
	const outside = join(f.root, 'outside.func');
	await fs.mkdir(outside);
	await fs.symlink(outside, join(f.options.functionsRoot, 'escaped.func'));
	await assert.rejects(packageClaudeOAuthArtifacts(f.options), /escapes function root/);
});

test('Claude packaging never writes through a function node_modules escape', async (t) => {
	const f = await runtimeFixture(t);
	const outside = join(f.root, 'external-dependencies');
	await fs.mkdir(outside);
	await fs.writeFile(join(outside, 'sentinel'), 'untouched');
	await fs.symlink(outside, join(f.step, 'node_modules'));
	await assert.rejects(packageClaudeOAuthArtifacts(f.options), /escapes function root/);
	assert.deepEqual(await fs.readdir(outside), ['sentinel']);
});

test('Claude discovery finds a runtime reference in an emitted chunk and rejects escaped handlers', async (t) => {
	const f = await runtimeFixture(t);
	await fs.writeFile(join(f.step, 'index.js'), 'require("./chunks/provider.js")');
	await fs.mkdir(join(f.step, 'chunks'));
	await fs.writeFile(join(f.step, 'chunks/provider.js'), runtimeReference);
	assert.equal((await packageClaudeOAuthArtifacts(f.options)).length, 2);
	await f.json(join(f.step, '.vc-config.json'), { runtime: 'nodejs22.x', handler: '../../../../../__server.func/index.js' });
	await assert.rejects(claudeRuntimeFunctions(f.options.functionsRoot));
});
