'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { brokenToolNames, directDependencyNames, ensureDependencies, parseToolNames } = require('./ensure-dependencies.js');

const silentLogger = {
	log() {},
	warn() {}
};

test('forces a relink when a tool is broken despite complete direct links', () => {
	let repaired = false;
	const installs = [];

	ensureDependencies({
		tools: ['eslint'],
		findMissing: () => [],
		findBrokenTools: () => (repaired ? [] : ['eslint']),
		install: (options) => {
			installs.push(options);
			repaired = true;
		},
		logger: silentLogger
	});

	assert.deepEqual(installs, [{ force: true }]);
});

test('check-only mode reports broken tools without mutating dependencies', () => {
	let installed = false;

	assert.throws(
		() =>
			ensureDependencies({
				checkOnly: true,
				tools: ['eslint'],
				findMissing: () => [],
				findBrokenTools: () => ['eslint'],
				install: () => {
					installed = true;
				},
				logger: silentLogger
			}),
		/unusable tools: eslint/
	);
	assert.equal(installed, false);
});

test('validation tools are direct and start successfully', () => {
	assert.ok(directDependencyNames().includes('prettier'));
	assert.deepEqual(brokenToolNames(['eslint', 'prettier']), []);
});

test('parses repeated and comma-separated tool probes', () => {
	assert.deepEqual(parseToolNames(['--tool=eslint', '--quiet', '--tool=prettier,eslint']), ['eslint', 'prettier', 'eslint']);
});
