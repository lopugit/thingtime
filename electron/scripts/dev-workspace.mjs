import { cp, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const { stopOwnedProcessGroup } = createRequire(import.meta.url)('../lib/local-runtime.cjs');
export const developmentEnvironment = () => Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'USER', 'LANG', 'SHELL'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));

export function retainedWorkspace(name, home = homedir()) {
	if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) throw new Error('Use a lowercase development workspace name containing letters, numbers and hyphens.');
	const root = path.join(home, 'Library/Application Support/Thingtime Dev', name);
	const identity = `com.thingtime.desktop.dev.${createHash('sha256').update(name).digest('hex').slice(0, 12)}`;
	const apiPort = 21000 + (parseInt(createHash('sha256').update(name).digest('hex').slice(0, 8), 16) % 11000) * 3;
	return { root, identity, name, profile: path.join(root, 'profile'), source: path.join(root, 'source/electron'),
		runtime: path.join(root, 'runtime/Electron.app'), app: path.join(home, 'Applications', `Thingtime Dev ${name}.app`),
		settings: path.join(root, 'settings.json'), log: path.join(root, 'development.log'), apiPort, databasePort: apiPort + 1, inspectorPort: apiPort + 2 };
}

export async function claimWorkspace(workspace) {
	await mkdir(workspace.root, { recursive: true, mode: 0o700 });
	const file = path.join(workspace.root, 'launcher.json');
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const handle = await open(file, 'wx', 0o600);
			await handle.writeFile(JSON.stringify({ pid: process.pid, childPid: null })); await handle.close();
			const release = () => rm(file, { force: true });
			release.recordChild = childPid => writeFile(file, JSON.stringify({ pid: process.pid, childPid }), { mode: 0o600 });
			return release;
		} catch (error) {
			if (error.code !== 'EEXIST') throw error;
			const { pid, childPid } = JSON.parse(await readFile(file, 'utf8'));
			if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Development workspace ownership is invalid; preserve it for inspection.');
			try { process.kill(pid, 0); throw new Error('This development workspace is already active. Quit its app before preparing or starting it again.'); }
			catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
			if (childPid === null || childPid === undefined) throw new Error('The prior launcher stopped before child ownership was established. Preserve the workspace for process inspection.');
			if (childPid !== null && childPid !== undefined) {
				if (!Number.isSafeInteger(childPid) || childPid < 1) throw new Error('Development child ownership is invalid; preserve it for inspection.');
				try { process.kill(-childPid, 0); throw new Error('The development app or its services remain active after the launcher stopped. Stop that owned workspace before preparing it.'); }
				catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
			}
			await rm(file);
		}
	}
	throw new Error('Could not claim the development workspace.');
}

const shell = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
function run(command, args, env, timeout) {
	const result = spawnSync(command, args, { stdio: 'inherit', ...(env ? { env } : {}), ...(timeout ? { timeout, killSignal: 'SIGKILL' } : {}) });
	if (result.error || result.status !== 0) throw new Error(`Development bundle preparation failed: ${command}.`);
}

export async function stopWorkspace(workspace) {
	const file = path.join(workspace.root, 'launcher.json');
	let owner;
	try { owner = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
	if (!Number.isSafeInteger(owner.childPid) || owner.childPid < 1) throw new Error('Workspace preparation is active or child ownership is unavailable; preserve it for inspection.');
	const readMembers = (requireKnown = true) => {
		const listing = spawnSync('/bin/ps', ['-axo', 'pid=,pgid=,comm='], { encoding: 'utf8' });
		if (listing.error || listing.status !== 0) throw new Error('Could not verify development process ownership.');
		const members = listing.stdout.split('\n').map(line => /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line)).filter(match => match && Number(match[2]) === owner.childPid);
		if (requireKnown && members.some(match => !match[3].startsWith(workspace.runtime + '/') && !match[3].startsWith(path.join(workspace.source, 'dist/database') + '/'))) throw new Error('Development process ownership changed; no process was stopped.');
		return members;
	};
	const members = readMembers();
	if (members.some(match => Number(match[1]) === owner.childPid)) {
		// Let Electron flush its Chromium session and close its managed replica
		// before considering signals to any child process.
		try { process.kill(owner.childPid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
		const deadline = Date.now() + 10000;
		while (Date.now() < deadline) {
			// Exiting processes can briefly lose their executable name. Observe
			// without signalling; any fallback rechecks every path strictly.
			if (!readMembers(false).length) break;
			await new Promise(resolve => setTimeout(resolve, 100));
		}
	}
	if (readMembers().length) await stopOwnedProcessGroup(owner.childPid);
	// A live launcher removes its own claim after observing child shutdown.
	const launcher = spawnSync('/bin/ps', ['-p', String(owner.pid), '-o', 'pid='], { encoding: 'utf8' });
	if (!launcher.error && launcher.status === 1 && !launcher.stdout.trim()) await rm(file, { force: true });
}

async function exists(file) { try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function assertContainedDependencies(root, boundary = root) {
	for (const item of await readdir(root, { withFileTypes: true })) {
		const file = path.join(root, item.name);
		if (item.isSymbolicLink()) {
			const destination = await realpath(file);
			if (!destination.startsWith(boundary + '/')) throw new Error('Development dependencies must remain within the retained snapshot.');
		} else if (item.isDirectory()) await assertContainedDependencies(file, boundary);
	}
}

export async function workspaceEnvironment(workspace) {
	try {
		const settings = JSON.parse(await readFile(workspace.settings, 'utf8'));
		if (!Array.isArray(settings.adminUsernames) || settings.adminUsernames.some(name => !/^[a-zA-Z0-9_-]+$/.test(name))) throw new Error('Invalid synthetic development admin usernames.');
		return { ADMIN_USERNAMES: settings.adminUsernames.join(',') };
	} catch (error) { if (error.code === 'ENOENT') return { ADMIN_USERNAMES: '' }; throw error; }
}

export async function prepareWorkspace(workspace, electronDir, electronExecutable) {
	if (process.platform !== 'darwin') throw new Error('Retained development app bundles currently require macOS.');
	await mkdir(workspace.root, { recursive: true, mode: 0o700 });
	const stage = path.join(workspace.root, `.prepare-${randomUUID()}`);
	const stagedSource = path.join(stage, 'source/electron');
	const stagedRuntime = path.join(stage, 'runtime/Electron.app');
	const stagedApp = path.join(stage, 'Thingtime Dev.app');
	const oldSource = path.join(stage, 'previous-source');
	const oldRuntime = path.join(stage, 'previous-runtime');
	let sourceActivated = false, runtimeActivated = false, appActivated = false;
	try {
		await mkdir(stagedSource, { recursive: true });
		for (const item of ['main.cjs', 'preload.cjs', 'package.json', 'pnpm-lock.yaml', 'lib', 'scripts']) {
			await cp(path.join(electronDir, item), path.join(stagedSource, item), { recursive: true });
		}
		// A separate production-only dependency install survives source-worktree
		// archival. Internal pnpm links are allowed; external links are refused.
		run('corepack', ['pnpm@10.12.1', '--dir', stagedSource, 'install', '--prod', '--ignore-scripts', '--frozen-lockfile'], developmentEnvironment());
		await assertContainedDependencies(path.join(stagedSource, 'node_modules'));
		for (const item of ['web', 'ai', 'mail', 'database']) {
			await cp(path.join(electronDir, 'dist', item), path.join(stagedSource, 'dist', item), { recursive: true, dereference: true });
		}
		run(process.execPath, [path.join(stagedSource, 'scripts/verify-web-build.mjs')], developmentEnvironment());
		const originalBundle = path.resolve(electronExecutable, '../../..');
		const readPlist = (bundle, key) => {
			const result = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' });
			return result.status === 0 ? result.stdout.trim() : null;
		};
		const replaceRuntime = !await exists(workspace.runtime) || readPlist(workspace.runtime, 'CFBundleIdentifier') !== workspace.identity || readPlist(workspace.runtime, 'CFBundleVersion') !== readPlist(originalBundle, 'CFBundleVersion');
		if (replaceRuntime) {
			await mkdir(path.dirname(stagedRuntime), { recursive: true });
			run('/usr/bin/ditto', [originalBundle, stagedRuntime]);
			const plist = path.join(stagedRuntime, 'Contents/Info.plist');
			run('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleIdentifier ${workspace.identity}`, plist]);
			run('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleName Thingtime Dev ${workspace.name}`, plist]);
			// Explicit UI development identity; no distribution/TCC claim.
			run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', stagedRuntime]);
		}
		run('/usr/bin/codesign', ['--verify', '--deep', '--strict', replaceRuntime ? stagedRuntime : workspace.runtime]);
		const contents = path.join(stagedApp, 'Contents');
		await mkdir(path.join(contents, 'MacOS'), { recursive: true });
		await writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${xml(workspace.identity)}.launcher</string><key>CFBundleName</key><string>Thingtime Dev ${xml(workspace.name)}</string><key>CFBundleExecutable</key><string>ThingtimeDev</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n`);
		const launcher = `#!/bin/sh\nexec ${shell(process.execPath)} ${shell(path.join(workspace.source, 'scripts/dev-parallel.mjs'))} ${shell(`--workspace=${workspace.name}`)} --use-staged >> ${shell(workspace.log)} 2>&1\n`;
		await writeFile(path.join(contents, 'MacOS/ThingtimeDev'), launcher, { mode: 0o755 });
		run('/usr/bin/codesign', ['--force', '--sign', '-', stagedApp]);
		// Validate everything before moving the known-good source. Keep the
		// previous snapshot until native configuration also succeeds.
		const finalSourceRoot = path.dirname(workspace.source);
		if (await exists(finalSourceRoot)) await rename(finalSourceRoot, oldSource);
		await rename(path.join(stage, 'source'), finalSourceRoot); sourceActivated = true;
		if (replaceRuntime) {
			if (await exists(path.dirname(workspace.runtime))) await rename(path.dirname(workspace.runtime), oldRuntime);
			await rename(path.join(stage, 'runtime'), path.dirname(workspace.runtime)); runtimeActivated = true;
		}
		await mkdir(workspace.profile, { recursive: true, mode: 0o700 });
		const bootstrap = path.join(stage, 'configure-local-runtime.cjs');
		const receipt = path.join(stage, 'bootstrap-result.json');
		await writeFile(bootstrap, `const {app,safeStorage}=require('electron');\nconst {LocalRuntime}=require(${JSON.stringify(path.join(workspace.source, 'lib/local-runtime.cjs'))});\napp.setName(${JSON.stringify(`Thingtime Dev ${workspace.name}`)});app.setPath('userData',${JSON.stringify(workspace.profile)});\napp.whenReady().then(async()=>{const runtime=new LocalRuntime({userData:app.getPath('userData'),safeStorage,parallelDev:true,bundledMongodPath:${JSON.stringify(path.join(workspace.source, 'dist/database/mongodb/bin/mongod'))}});await runtime.initialize();await runtime.configure({enabled:true,databaseMode:'managed',apiPort:${workspace.apiPort},databasePort:${workspace.databasePort}});require('node:fs').writeFileSync(${JSON.stringify(receipt)},JSON.stringify({configured:true,apiPort:${workspace.apiPort},databasePort:${workspace.databasePort}}));app.quit();}).catch(error=>{console.error(error.message);app.exit(1);});\n`);
		run(process.execPath, ['--check', bootstrap], developmentEnvironment());
		run(path.join(workspace.runtime, 'Contents/MacOS/Electron'), [bootstrap], developmentEnvironment(), 30000);
		const configured = JSON.parse(await readFile(receipt, 'utf8'));
		if (configured.configured !== true || configured.apiPort !== workspace.apiPort || configured.databasePort !== workspace.databasePort) throw new Error('Development local runtime configuration did not complete.');
		await mkdir(path.dirname(workspace.app), { recursive: true });
		if (await exists(workspace.app)) await rename(workspace.app, path.join(stage, 'previous-app'));
		await rename(stagedApp, workspace.app); appActivated = true;
		const metadata = JSON.parse(await readFile(path.join(workspace.source, 'dist/web/metadata.json'), 'utf8'));
		await writeFile(path.join(workspace.root, 'development.json'), JSON.stringify({ source: electronDir, sourceSha: metadata.gitCommit, bundleIdentifier: workspace.identity, app: workspace.app, profile: workspace.profile, resources: path.join(workspace.source, 'dist'), nativeNodeBridge: 'disabled', apiPort: workspace.apiPort, databasePort: workspace.databasePort, inspectorPort: workspace.inspectorPort }, null, 2));
	} catch (error) {
		if (sourceActivated) await rm(path.dirname(workspace.source), { recursive: true, force: true });
		if (await exists(oldSource)) await rename(oldSource, path.dirname(workspace.source));
		if (runtimeActivated) await rm(path.dirname(workspace.runtime), { recursive: true, force: true });
		if (await exists(oldRuntime)) await rename(oldRuntime, path.dirname(workspace.runtime));
		if (appActivated) await rm(workspace.app, { recursive: true, force: true });
		if (await exists(path.join(stage, 'previous-app'))) await rename(path.join(stage, 'previous-app'), workspace.app);
		throw error;
	} finally { await rm(stage, { recursive: true, force: true }); }
}
