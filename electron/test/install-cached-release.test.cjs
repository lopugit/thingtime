'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const helperPromise = import('../scripts/install-cached-release.mjs');

test('detached cached launch waits, verifies again, then reopens the cached app', async () => {
	const { executeCachedReleasePlan } = await helperPromise;
	const events = [];
	const sourceApp = '/private/tmp/Thingtime.app';
	const targetApp = await executeCachedReleasePlan(
		{ action: 'launch', sourceApp, targetDir: '/Users/test/Applications', waitForPid: 4321 },
		{
			waitForExit: async (pid) => events.push(['wait', pid]),
			verifyApp: (appPath) => events.push(['verify', appPath]),
			openApp: (appPath) => {
				events.push(['open', appPath]);
				return { status: 0 };
			}
		}
	);

	assert.equal(targetApp, sourceApp);
	assert.deepEqual(events, [
		['wait', 4321],
		['verify', sourceApp],
		['open', sourceApp]
	]);
});

test('a failed detached verification blocks the launch', async () => {
	const { executeCachedReleasePlan } = await helperPromise;
	let opened = false;
	await assert.rejects(
		() => executeCachedReleasePlan(
			{ action: 'launch', sourceApp: '/private/tmp/Thingtime.app', targetDir: '/Users/test/Applications', waitForPid: 4321 },
			{
				waitForExit: async () => {},
				verifyApp: () => { throw new Error('tampered cache'); },
				openApp: () => {
					opened = true;
					return { status: 0 };
				}
			}
		),
		/tampered cache/u
	);
	assert.equal(opened, false);
});

test('detached cache verification always invokes the production verifier', async () => {
	const { verifyCachedReleaseSource } = await helperPromise;
	let invocation;
	verifyCachedReleaseSource('/private/tmp/Thingtime.app', (command, args, options) => {
		invocation = { command, args, options };
		return { status: 0 };
	});

	assert.equal(invocation.command, process.execPath);
	assert.match(invocation.args[0], new RegExp(`verify-signed-app\\.mjs$`, 'u'));
	assert.deepEqual(invocation.args.slice(1), ['--mode', 'production', '/private/tmp/Thingtime.app']);
	assert.equal(invocation.options.env.ELECTRON_RUN_AS_NODE, '1');
});
