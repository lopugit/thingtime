#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { hostname } = require('node:os');
const path = require('node:path');

const remixDir = path.resolve(__dirname, '..');
const manifestPath = path.join(remixDir, 'package.json');
const corepackBin = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';

// pnpm has no per-project mutex, and two installers writing one node_modules
// (the post-checkout bootstrap in the background plus a developer's own
// `npm run worktree-setup`, or dev + lint started together) leave half-linked
// packages behind. A directory lock serialises them: the second waits for the
// first, then runs its own (now nearly free) pass.
const installLockPath = path.join(remixDir, 'node_modules', '.thingtime-install.lock');
const INSTALL_LOCK_WAIT_MS = 10 * 60 * 1000;

// A dead parent can leave pnpm running. Detect it promptly, but preserve the
// lock until the operator verifies this checkout has no surviving installer.
const inspectInstallOwner = (lockPath) => {
	let files;
	try { files = readdirSync(lockPath); } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
	const markers = files.filter(name => /^owner-[a-f0-9-]+\.json$/.test(name));
	if (files.length !== 1 || markers.length !== 1) return false;
	const marker = path.join(lockPath, markers[0]);
	let owner;
	try { owner = JSON.parse(readFileSync(marker, 'utf8')); } catch { return false; }
	if (owner.hostname !== hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
	try { process.kill(owner.pid, 0); return false; } catch (error) { if (error.code !== 'ESRCH') return false; }
	throw new Error(`[deps] Interrupted installer lock at ${lockPath}. Its owner exited, but a child installer may remain. Verify no installer is using this checkout, remove this lock's owner marker and empty directory, then rerun bootstrap.`);
};

/* global Atomics, SharedArrayBuffer */
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const withInstallLock = (run, { lockPath = installLockPath, logger = console } = {}) => {
	mkdirSync(path.dirname(lockPath), { recursive: true });
	const ownerName = `owner-${randomUUID()}.json`;
	const started = Date.now();
	let announced = false;
	for (;;) {
		try {
			mkdirSync(lockPath);
			writeFileSync(path.join(lockPath, ownerName), JSON.stringify({ pid: process.pid, hostname: hostname() }), { flag: 'wx', mode: 0o600 });
			break;
		} catch (error) {
			if (error.code !== 'EEXIST') throw error;
			let age = 0;
			try {
				age = Date.now() - statSync(lockPath).mtimeMs;
			} catch {
				continue; // released between our attempt and the stat
			}
			if (inspectInstallOwner(lockPath)) {
				continue;
			}
			// Old empty locks have no owner evidence. Never remove them merely
			// because time elapsed: another installer may still be working.
			let ownerless;
			try { ownerless = readdirSync(lockPath).length === 0; } catch (readError) {
				if (readError.code === 'ENOENT') continue; // holder released after our owner check
				throw readError;
			}
			if (age > 1000 && ownerless) {
				throw new Error(`[deps] Ownerless install lock at ${lockPath}. Verify no installer is using this checkout, remove only the empty lock directory, then rerun bootstrap.`);
			}
			if (Date.now() - started > INSTALL_LOCK_WAIT_MS) {
				throw new Error(`[deps] Another dependency install has held ${lockPath} for over ${INSTALL_LOCK_WAIT_MS / 60000} minutes.`);
			}
			if (!announced) {
				logger.log('[deps] Another dependency install is running; waiting for it to finish…');
				announced = true;
			}
			sleepSync(500);
		}
	}
	try {
		return run();
	} finally {
		try { unlinkSync(path.join(lockPath, ownerName)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
		try { rmdirSync(lockPath); } catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
	}
};

const toolProbes = {
	eslint: {
		packageName: 'eslint',
		binName: 'eslint',
		args: (baseDir) => ['--print-config', path.join(baseDir, 'scripts', 'ensure-dependencies.js')]
	},
	prettier: {
		packageName: 'prettier',
		binName: 'prettier',
		args: () => ['--version']
	}
};

const directDependencyNames = () => {
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

	return [
		...Object.keys(manifest.dependencies || {}),
		...Object.keys(manifest.devDependencies || {}),
		...Object.keys(manifest.optionalDependencies || {})
	].sort();
};

const packageManifestPath = (dependencyName) => path.join(remixDir, 'node_modules', ...dependencyName.split('/'), 'package.json');

const missingDirectDependencies = () => directDependencyNames().filter((dependencyName) => !existsSync(packageManifestPath(dependencyName)));

const packageBinPath = (baseDir, packageName, binName) => {
	const dependencyManifestPath = path.join(baseDir, 'node_modules', ...packageName.split('/'), 'package.json');
	const manifest = JSON.parse(readFileSync(dependencyManifestPath, 'utf8'));
	const relativeBinPath = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin && manifest.bin[binName];

	if (!relativeBinPath) {
		throw new Error(`${packageName} does not expose the ${binName} CLI.`);
	}

	return path.resolve(path.dirname(dependencyManifestPath), relativeBinPath);
};

const probeTool = (toolName, { baseDir = remixDir, spawn = spawnSync } = {}) => {
	const probe = toolProbes[toolName];

	if (!probe) {
		throw new Error(`[deps] Unknown tool probe: ${toolName}`);
	}

	try {
		const binPath = packageBinPath(baseDir, probe.packageName, probe.binName);

		if (!existsSync(binPath)) {
			return false;
		}

		const result = spawn(process.execPath, [binPath, ...probe.args(baseDir)], {
			cwd: baseDir,
			stdio: 'ignore',
			env: { ...process.env, CI: 'true' }
		});

		return !result.error && result.status === 0;
	} catch {
		return false;
	}
};

const brokenToolNames = (toolNames, options) => [...new Set(toolNames)].filter((toolName) => !probeTool(toolName, options));

const summarize = (dependencyNames) => {
	const shown = dependencyNames.slice(0, 8);
	const suffix = dependencyNames.length > shown.length ? `, and ${dependencyNames.length - shown.length} more` : '';

	return `${shown.join(', ')}${suffix}`;
};

const runInstall = ({ force = false } = {}) =>
	withInstallLock(() => {
		const args = ['pnpm', 'install', '--frozen-lockfile', '--prefer-offline', ...(force ? ['--force'] : [])];
		const result = spawnSync(corepackBin, args, {
			cwd: remixDir,
			stdio: 'inherit',
			env: { ...process.env, CI: 'true' }
		});

		if (result.error) {
			throw new Error(`[deps] Could not run ${corepackBin}: ${result.error.message}. Install or enable Corepack, then re-run the command.`);
		}

		if (result.status !== 0) {
			throw new Error(`[deps] pnpm install failed with exit code ${result.status || 1}.`);
		}
	});

const ensureDependencies = ({
	checkOnly = false,
	quiet = false,
	tools = [],
	findMissing = missingDirectDependencies,
	findBrokenTools = brokenToolNames,
	install = runInstall,
	logger = console
} = {}) => {
	let missing = findMissing();
	let brokenTools = findBrokenTools(tools);

	if (!missing.length && !brokenTools.length) {
		if (!quiet && checkOnly) {
			const toolsSuffix = tools.length ? ` Tool probes passed: ${[...new Set(tools)].join(', ')}.` : '';
			logger.log(`[deps] All direct Remix dependencies are linked.${toolsSuffix}`);
		}
		return;
	}

	if (checkOnly) {
		const issues = [
			missing.length ? `missing or broken links: ${summarize(missing)}` : '',
			brokenTools.length ? `unusable tools: ${summarize(brokenTools)}` : ''
		].filter(Boolean);

		throw new Error(`[deps] Dependency health check failed (${issues.join('; ')}).`);
	}

	if (missing.length) {
		logger.log(`[deps] Missing or broken dependency links (${summarize(missing)}); repairing with pnpm install --prefer-offline…`);
		install();
		missing = findMissing();
		brokenTools = findBrokenTools(tools);
	}

	if (missing.length || brokenTools.length) {
		const issues = [missing.length ? `links: ${summarize(missing)}` : '', brokenTools.length ? `tools: ${summarize(brokenTools)}` : ''].filter(
			Boolean
		);

		logger.warn(`[deps] Dependency graph is incomplete (${issues.join('; ')}); repairing once with pnpm install --force…`);
		install({ force: true });
		missing = findMissing();
		brokenTools = findBrokenTools(tools);
	}

	if (missing.length || brokenTools.length) {
		const issues = [
			missing.length ? `missing links: ${summarize(missing)}` : '',
			brokenTools.length ? `unusable tools: ${summarize(brokenTools)}` : ''
		].filter(Boolean);

		throw new Error(`[deps] Dependency repair finished, but the graph is still incomplete (${issues.join('; ')}).`);
	}

	logger.log('[deps] Remix dependencies are ready.');
};

const parseToolNames = (args) =>
	args
		.filter((argument) => argument.startsWith('--tool='))
		.flatMap((argument) => argument.slice('--tool='.length).split(','))
		.map((toolName) => toolName.trim())
		.filter(Boolean);

if (require.main === module) {
	const checkOnly = process.argv.includes('--check');
	const quiet = process.argv.includes('--quiet');
	const tools = parseToolNames(process.argv.slice(2));

	try {
		ensureDependencies({ checkOnly, quiet, tools });
	} catch (error) {
		console.error(error.message || error);
		process.exit(1);
	}
}

module.exports = {
	brokenToolNames,
	directDependencyNames,
	ensureDependencies,
	missingDirectDependencies,
	parseToolNames,
	probeTool,
	withInstallLock
};
