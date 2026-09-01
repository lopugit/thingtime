'use strict';

const assert = require('node:assert/strict');
const {
	cpSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync
} = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');

const installerPromise = import('../scripts/install-local-app.mjs');

function makeApp(root, identifier, marker) {
	const app = path.join(root, 'Thingtime.app');
	const executable = path.join(app, 'Contents', 'MacOS', 'Thingtime');
	mkdirSync(path.dirname(executable), { recursive: true });
	writeFileSync(path.join(app, 'bundle-id.txt'), identifier);
	writeFileSync(path.join(app, 'marker.txt'), marker);
	writeFileSync(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
	return app;
}

function identifierReader(app) {
	return readFileSync(path.join(app, 'bundle-id.txt'), 'utf8');
}

function installOptions(sourceApp, targetDir, overrides = {}) {
	return {
		allowNonDarwin: true,
		copyApp: (source, destination) => cpSync(source, destination, { recursive: true }),
		identifierReader,
		nodeRunningPids: () => [],
		registerMetadata: () => {},
		runningPids: () => [],
		serviceLifecycle: {
			snapshot: () => ({ registered: false }),
			start: () => {},
			stop: () => {}
		},
		sourceApp,
		targetDir,
		verifyApp: () => {},
		...overrides
	};
}

function registeredServiceLifecycle(targetDir, events, { failFirstStart = false } = {}) {
	let startCount = 0;
	return {
		snapshot: () => ({ registered: true }),
		stop: () => events.push('stop'),
		start: () => {
			startCount += 1;
			const marker = readFileSync(path.join(targetDir, 'Thingtime.app', 'marker.txt'), 'utf8');
			events.push(`start:${marker}`);
			if (failFirstStart && startCount === 1) throw new Error('new service failed');
		}
	};
}

function fixture() {
	const root = mkdtempSync(path.join(tmpdir(), 'thingtime-installer-'));
	const sourceRoot = path.join(root, 'source');
	const targetDir = path.join(root, 'Applications');
	mkdirSync(sourceRoot, { recursive: true });
	mkdirSync(targetDir, { recursive: true });
	return { root, sourceApp: makeApp(sourceRoot, 'com.thingtime.desktop', 'new'), targetDir };
}

test('refuses to replace an app with another bundle identifier', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	try {
		const target = makeApp(value.targetDir, 'com.example.not-thingtime', 'original');
		assert.throws(() => installLocalApp(installOptions(value.sourceApp, value.targetDir)), /bundle identifier/u);
		assert.equal(readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'original');
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('refuses a symbolic-link install destination', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	try {
		const elsewhere = path.join(value.root, 'elsewhere');
		makeApp(elsewhere, 'com.thingtime.desktop', 'external');
		symlinkSync(path.join(elsewhere, 'Thingtime.app'), path.join(value.targetDir, 'Thingtime.app'));
		assert.throws(() => installLocalApp(installOptions(value.sourceApp, value.targetDir)), /symbolic link/u);
		assert.equal(readFileSync(path.join(elsewhere, 'Thingtime.app', 'marker.txt'), 'utf8'), 'external');
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('serializes concurrent install attempts with an exclusive lock', async () => {
	const { acquireInstallLock, installLocalApp } = await installerPromise;
	const value = fixture();
	const release = acquireInstallLock(value.targetDir);
	try {
		assert.throws(() => installLocalApp(installOptions(value.sourceApp, value.targetDir)), /already in progress/u);
	} finally {
		release();
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('leaves the installed app untouched when copying fails', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	try {
		const target = makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		assert.throws(
			() => installLocalApp(installOptions(value.sourceApp, value.targetDir, { copyApp: () => { throw new Error('copy failed'); } })),
			/copy failed/u
		);
		assert.equal(readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'original');
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('restores the prior app when final installed verification fails', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	try {
		const target = makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		let verificationCount = 0;
		assert.throws(
			() =>
				installLocalApp(
					installOptions(value.sourceApp, value.targetDir, {
						verifyApp: () => {
							verificationCount += 1;
							if (verificationCount === 3) throw new Error('installed verification failed');
						}
					})
				),
			/installed verification failed/u
		);
		assert.equal(readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'original');
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('refuses replacement while the installed executable is running', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	try {
		const target = makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		assert.throws(
			() => installLocalApp(installOptions(value.sourceApp, value.targetDir, { runningPids: () => [123, 456] })),
			/running PIDs: 123, 456/u
		);
		assert.equal(readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'original');
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('atomically replaces the intended app and cleans temporary state', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	try {
		makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		const result = installLocalApp(installOptions(value.sourceApp, value.targetDir));
		assert.equal(readFileSync(path.join(result.targetApp, 'marker.txt'), 'utf8'), 'new');
		assert.deepEqual(readdirSync(value.targetDir), ['Thingtime.app']);
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('stops and restarts a registered persistent node around atomic replacement', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	const events = [];
	try {
		makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		const serviceLifecycle = registeredServiceLifecycle(value.targetDir, events);
		const result = installLocalApp(installOptions(value.sourceApp, value.targetDir, { serviceLifecycle }));
		assert.equal(readFileSync(path.join(result.targetApp, 'marker.txt'), 'utf8'), 'new');
		assert.deepEqual(events, ['stop', 'start:new']);
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('restores the prior node service when the desktop app remains open after node shutdown', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	const events = [];
	try {
		const target = makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		assert.throws(
			() =>
				installLocalApp(
					installOptions(value.sourceApp, value.targetDir, {
						runningPids: () => [321],
						serviceLifecycle: registeredServiceLifecycle(value.targetDir, events)
					})
				),
			/running PID: 321/u
		);
		assert.equal(readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'original');
		assert.deepEqual(events, ['stop', 'start:original']);
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('restores the prior app before restarting its persistent node after verification failure', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	const events = [];
	try {
		const target = makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		let verificationCount = 0;
		assert.throws(
			() =>
				installLocalApp(
					installOptions(value.sourceApp, value.targetDir, {
						serviceLifecycle: registeredServiceLifecycle(value.targetDir, events),
						verifyApp: () => {
							verificationCount += 1;
							if (verificationCount === 3) throw new Error('installed verification failed');
						}
					})
				),
			/installed verification failed/u
		);
		assert.equal(readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'original');
		assert.deepEqual(events, ['stop', 'start:original']);
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('restores the prior app and retries its node service when the replacement service cannot start', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	const events = [];
	try {
		const target = makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		assert.throws(
			() =>
				installLocalApp(
					installOptions(value.sourceApp, value.targetDir, {
						serviceLifecycle: registeredServiceLifecycle(value.targetDir, events, { failFirstStart: true })
					})
				),
			/new service failed/u
		);
		assert.equal(readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'original');
		assert.deepEqual(events, ['stop', 'start:new', 'start:original']);
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('refuses an unmanaged persistent node process without stopping it', async () => {
	const { installLocalApp } = await installerPromise;
	const value = fixture();
	try {
		const target = makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		assert.throws(
			() => installLocalApp(installOptions(value.sourceApp, value.targetDir, { nodeRunningPids: () => [777] })),
			/unmanaged Thingtime Node.*777/u
		);
		assert.equal(readFileSync(path.join(target, 'marker.txt'), 'utf8'), 'original');
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});

test('validates the managed LaunchAgent marker and exact installed helper path', async () => {
	const { assertManagedNodeLaunchAgent } = await installerPromise;
	const helper = '/Users/test/Applications/Thingtime.app/Contents/Helpers/Thingtime Node.app/Contents/MacOS/ThingtimeNode';
	const plist = `<!-- Managed by Thingtime Electron. -->
<key>Label</key>
    <string>com.thingtime.desktop.node</string>
<key>ProgramArguments</key>
<array>
    <string>${helper}</string>
</array>`;
	assert.doesNotThrow(() => assertManagedNodeLaunchAgent(plist, helper));
	assert.throws(() => assertManagedNodeLaunchAgent(plist.replace('Managed by Thingtime Electron', 'Foreign owner'), helper), /not an Electron-managed agent/u);
	assert.throws(() => assertManagedNodeLaunchAgent(plist, `${helper}-other`), /not an Electron-managed agent/u);
});

test('default node lifecycle targets only the managed exact-label service and plist', async () => {
	const { createNodeServiceLifecycle } = await installerPromise;
	const value = fixture();
	const events = [];
	let registered = true;
	try {
		const targetApp = makeApp(value.targetDir, 'com.thingtime.desktop', 'original');
		const helper = path.join(targetApp, 'Contents', 'Helpers', 'Thingtime Node.app', 'Contents', 'MacOS', 'ThingtimeNode');
		const launchAgentPath = path.join(value.root, 'Library', 'LaunchAgents', 'com.thingtime.desktop.node.plist');
		mkdirSync(path.dirname(launchAgentPath), { recursive: true });
		writeFileSync(
			launchAgentPath,
			`<!-- Managed by Thingtime Electron. -->
<key>Label</key>
    <string>com.thingtime.desktop.node</string>
<key>ProgramArguments</key>
<array>
    <string>${helper}</string>
</array>`
		);
		const runner = (command, args) => {
			events.push([command, ...args]);
			if (args[0] === 'print') {
				return { status: registered ? 0 : 1, stdout: '', stderr: registered ? '' : 'Could not find service' };
			}
			if (args[0] === 'bootout') {
				if (!registered) return { status: 1, stdout: '', stderr: 'Could not find service' };
				registered = false;
				return { status: 0, stdout: '', stderr: '' };
			}
			if (args[0] === 'bootstrap') registered = true;
			return { status: 0, stdout: '', stderr: '' };
		};
		const lifecycle = createNodeServiceLifecycle({ launchAgentPath, runner, targetApp, uid: 501 });
		const state = lifecycle.snapshot();
		lifecycle.stop(state);
		lifecycle.start(state);

		assert.equal(registered, true);
		assert.deepEqual(events, [
			['/bin/launchctl', 'print', 'gui/501/com.thingtime.desktop.node'],
			['/bin/launchctl', 'bootout', 'gui/501/com.thingtime.desktop.node'],
			['/bin/launchctl', 'bootout', 'gui/501/com.thingtime.desktop.node'],
			['/bin/launchctl', 'enable', 'gui/501/com.thingtime.desktop.node'],
			['/bin/launchctl', 'bootstrap', 'gui/501', launchAgentPath]
		]);
	} finally {
		rmSync(value.root, { force: true, recursive: true });
	}
});
