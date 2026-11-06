'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const { DEFAULT_ENV_FILES, launchEntries, readEnvFileList, writeLaunchConfig } = require('./worktree-bootstrap.cjs');

const withCheckout = (run) => {
	const root = mkdtempSync(path.join(tmpdir(), 'tt-bootstrap-'));
	try {
		return run(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
};

test('the env files to carry over come from .worktreeinclude, never dependency or build state', () => {
	withCheckout((root) => {
		assert.deepEqual(readEnvFileList(root), DEFAULT_ENV_FILES, 'no include file: the built-in list');
		writeFileSync(
			path.join(root, '.worktreeinclude'),
			['# comment', '', '.env', 'remix/.env.local', 'iOS/.env.test', 'node_modules/', '.cache/', 'dist/', 'remix/.env.auto', 'remix/package.json'].join('\n')
		);
		assert.deepEqual(readEnvFileList(root), ['.env', 'remix/.env.local', 'iOS/.env.test', 'remix/.env.auto']);
	});
});

test('launch.json gets an attach entry for the PM2 stack plus a foreground entry, and keeps foreign entries', () => {
	withCheckout((root) => {
		const context = { ports: { web: 12345, hmr: 12344, api: 12346 } };
		assert.deepEqual(launchEntries(context), [
			{ name: 'thingtime-web-12345', url: 'http://127.0.0.1:12345' },
			{ name: 'thingtime-web-12345-foreground', runtimeExecutable: 'npm', runtimeArgs: ['--prefix', 'remix', 'run', 'dev'], port: 12345 }
		]);
		mkdirSync(path.join(root, '.claude'));
		const file = path.join(root, '.claude', 'launch.json');
		writeFileSync(
			file,
			JSON.stringify({ version: '0.0.1', configurations: [{ name: 'thingtime-web-9999', runtimeExecutable: 'npm', runtimeArgs: ['--prefix', 'remix', 'run', 'dev'], port: 9999 }, { name: 'docs', url: 'http://127.0.0.1:4000' }] })
		);
		assert.equal(writeLaunchConfig(root, context, () => {}), true);
		const written = JSON.parse(readFileSync(file, 'utf8'));
		assert.deepEqual(
			written.configurations.map((entry) => entry.name),
			['thingtime-web-12345', 'thingtime-web-12345-foreground', 'docs'],
			'stale thingtime entries replaced, the developer’s own entry kept'
		);
		assert.equal(writeLaunchConfig(root, context, () => {}), false, 'idempotent');
	});
});
