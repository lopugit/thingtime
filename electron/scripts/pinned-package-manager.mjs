import { constants } from 'node:fs';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const exactPnpmPattern = /^pnpm@\d+\.\d+\.\d+$/u;

function shellQuote(value) {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function resolveCorepack(environment) {
	const searchPath = environment.PATH;
	if (typeof searchPath !== 'string' || searchPath.length === 0) {
		throw new Error('PATH is required to resolve Corepack for the pinned Electron package-manager shim.');
	}

	for (const directory of searchPath.split(path.delimiter)) {
		const candidate = path.resolve(directory || '.', 'corepack');
		try {
			await access(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Keep looking through the inherited executable search path.
		}
	}

	throw new Error('Corepack is required to run Electron packaging with the pinned pnpm version.');
}

export async function createPinnedPnpmEnvironment(packageManager, baseEnvironment = process.env) {
	if (typeof packageManager !== 'string' || !exactPnpmPattern.test(packageManager)) {
		throw new Error('electron/package.json must pin an exact pnpm packageManager version.');
	}

	const corepack = await resolveCorepack(baseEnvironment);
	const shimDirectory = await mkdtemp(path.join(tmpdir(), 'thingtime-electron-pnpm-'));
	const shimPath = path.join(shimDirectory, 'pnpm');

	try {
		const source = `#!/bin/sh\nexec ${shellQuote(corepack)} ${shellQuote(packageManager)} "$@"\n`;
		await writeFile(shimPath, source, { encoding: 'utf8', mode: 0o700 });
	} catch (error) {
		await rm(shimDirectory, { force: true, recursive: true });
		throw error;
	}

	const environment = {
		...baseEnvironment,
		PATH: `${shimDirectory}${path.delimiter}${baseEnvironment.PATH}`
	};
	const expectedVersion = packageManager.slice('pnpm@'.length);
	const versionCheck = spawnSync(shimPath, ['--version'], {
		env: environment,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
	const resolvedVersion = versionCheck.stdout?.trim();
	if (versionCheck.error || versionCheck.status !== 0 || resolvedVersion !== expectedVersion) {
		await rm(shimDirectory, { force: true, recursive: true });
		throw new Error(
			`Electron packaging requires pnpm ${expectedVersion}, but the isolated collector shim resolved ${resolvedVersion || 'no version'}.`
		);
	}

	return {
		environment,
		shimPath,
		dispose: () => rm(shimDirectory, { force: true, recursive: true })
	};
}
