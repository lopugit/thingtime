const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');

test('retained workspaces cannot select the stable profile and have deterministic distinct identities and ports', async () => {
	const { retainedWorkspace } = await import('../scripts/dev-workspace.mjs');
	for (const invalid of ['', '..', '../Thingtime', '/Applications', 'bad name']) assert.throws(() => retainedWorkspace(invalid));
	const first = retainedWorkspace('retention', '/private/dev-home');
	assert.deepEqual(first, retainedWorkspace('retention', '/private/dev-home'));
	assert.notEqual(first.identity, retainedWorkspace('other', '/private/dev-home').identity);
	assert.match(first.profile, /Thingtime Dev\/retention\/profile$/);
	assert.ok(first.apiPort >= 21000 && first.inspectorPort <= 54000);
	assert.notEqual(first.apiPort, first.databasePort);
});

test('a dead launcher cannot replace a snapshot while its detached child group is alive', async () => {
	const { claimWorkspace, retainedWorkspace } = await import('../scripts/dev-workspace.mjs');
	const home = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-dev-orphan-test-'));
	const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
	try {
		await once(child, 'spawn');
		const exited = spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' });
		const workspace = retainedWorkspace('retention', home);
		await fs.mkdir(workspace.root, { recursive: true });
		await fs.writeFile(path.join(workspace.root, 'launcher.json'), JSON.stringify({ pid: exited.pid, childPid: child.pid }));
		await assert.rejects(claimWorkspace(workspace), /remain active/);
	} finally {
		process.kill(-child.pid, 'SIGTERM'); await once(child, 'exit');
		await fs.rm(home, { recursive: true, force: true });
	}
});

test('workspace-specific app names apply only to parallel development', async () => {
	const source = await fs.readFile(path.join(__dirname, '../main.cjs'), 'utf8');
	const setup = source.slice(0, source.indexOf("const { checkEndpointCompatibility"));
	const run = (isPackaged, env) => {
		const calls = [];
		const app = { isPackaged, setName: value => calls.push(['name', value]), setPath: (key, value) => calls.push([key, value]) };
		require('node:vm').runInNewContext(setup, { process: { env }, require: name => name === 'electron' ? { app } : require(name) });
		return calls;
	};
	const env = { THINGTIME_DESKTOP_PARALLEL_DEV: '1', THINGTIME_DESKTOP_DEV_PROFILE: '/private/synthetic-profile', THINGTIME_DESKTOP_DEV_NAME: 'Thingtime Dev retention' };
	assert.deepEqual(run(true, env), []);
	assert.deepEqual(run(false, {}), []);
	assert.deepEqual(run(false, env), [['name', 'Thingtime Dev retention'], ['userData', '/private/synthetic-profile']]);
	assert.throws(() => run(false, { ...env, THINGTIME_DESKTOP_DEV_NAME: 'Thingtime' }), /isolated development app name/);
});

test('parallel local-runtime initialization never invokes the OS password helper', async () => {
	const source = await fs.readFile(path.join(__dirname, '../main.cjs'), 'utf8');
	const setup = source.slice(source.indexOf('async function initializeDesktopSettings()'), source.indexOf('async function checkSelectedEndpointCompatibility'));
	for (const parallelDevMode of [true, false]) {
		let disconnects = 0;
		const context = { parallelDevMode, process: { platform: 'darwin' }, path, __dirname,
			app: { getPath: () => '/private/dev-profile', isPackaged: false }, safeStorage: {},
			desktopActivities: { initialize: async () => {}, nodeEnabled: () => true },
			LocalRuntime: class { async initialize() {} snapshot() { return { enabled: true }; } },
			passwordProvider: { disconnect: async () => { disconnects++; } },
			DesktopSettingsStore: class { async initialize() { return { selectedEndpoint: { url: 'http://127.0.0.1:46533/' } }; } snapshot() { return {}; } },
			SessionAuthority: class { async initialize() {} }, readWebBuildMetadata: () => ({}), setApiFallbackEndpoint: () => {},
			localRuntime: null, desktopSettings: null, activeApiEndpoint: null, sessionAuthority: null, endpointCompatibility: null };
		await require('node:vm').runInNewContext(setup + '\ninitializeDesktopSettings()', context);
		assert.equal(disconnects, parallelDevMode ? 0 : 1);
	}
});

test('workspace ownership prevents a second launcher and preserves retained state after releasing', async () => {
	const { claimWorkspace, retainedWorkspace, workspaceEnvironment } = await import('../scripts/dev-workspace.mjs');
	const home = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-dev-workspace-test-'));
	try {
		const workspace = retainedWorkspace('retention', home);
		const release = await claimWorkspace(workspace);
		await assert.rejects(claimWorkspace(workspace), /already active/);
		await fs.writeFile(workspace.settings, JSON.stringify({ adminUsernames: ['synthetic-retention'] }));
		assert.deepEqual(await workspaceEnvironment(workspace), { ADMIN_USERNAMES: 'synthetic-retention' });
		await release();
		assert.equal(JSON.parse(await fs.readFile(workspace.settings, 'utf8')).adminUsernames[0], 'synthetic-retention');
		await fs.writeFile(workspace.settings, JSON.stringify({ adminUsernames: ['invalid,admin'] }));
		await assert.rejects(workspaceEnvironment(workspace), /Invalid/);
	} finally { await fs.rm(home, { recursive: true, force: true }); }
});

test('retained stop lets the leader quit before signalling its child services', { skip: process.platform !== 'darwin' }, async () => {
	const { retainedWorkspace, stopWorkspace } = await import('../scripts/dev-workspace.mjs');
	const home = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-dev-quit-test-'));
	const workspace = retainedWorkspace('retention', home);
	const ready = path.join(home, 'ready'), result = path.join(home, 'result'), childSignal = path.join(home, 'child-signal');
	const workerCode = `const fs=require('fs');process.on('SIGTERM',()=>{fs.writeFileSync(${JSON.stringify(childSignal)},'');process.exit(0)});fs.writeFileSync(${JSON.stringify(ready + '-child')},'');setInterval(()=>{},1000);`;
	const leaderCode = `const fs=require('fs');const child=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(workerCode)}],{stdio:'ignore'});process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({prematureChildSignal:fs.existsSync(${JSON.stringify(childSignal)})}));child.once('exit',()=>process.exit(0));child.kill('SIGTERM')},150));const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(ready + '-child')})){fs.writeFileSync(${JSON.stringify(ready)},'');clearInterval(timer)}},10);`;
	const child = spawn(process.execPath, ['-e', leaderCode], { detached: true, stdio: 'ignore' });
	const exited = once(child, 'exit');
	try {
		await fs.mkdir(workspace.root, { recursive: true });
		await fs.writeFile(path.join(workspace.root, 'launcher.json'), JSON.stringify({ pid: process.pid, childPid: child.pid }));
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline) { try { await fs.access(ready); break; } catch {} await new Promise(resolve => setTimeout(resolve, 20)); }
		await fs.access(ready);
		await stopWorkspace({ ...workspace, runtime: path.dirname(process.execPath) });
		await exited;
		assert.equal(JSON.parse(await fs.readFile(result, 'utf8')).prematureChildSignal, false);
	} finally {
		try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
		await fs.rm(home, { recursive: true, force: true });
	}
});
