#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);

export const repositoryRoot = resolve(dirname(scriptPath), '..');
export const remixOutputDirectory = resolve(repositoryRoot, 'remix/.vercel/output');
export const rootOutputDirectory = resolve(repositoryRoot, '.vercel/output');

export async function verifyVercelOutput(outputDirectory) {
	const [indexHtml, rawConfig] = await Promise.all([
		readFile(resolve(outputDirectory, 'static/index.html'), 'utf8'),
		readFile(resolve(outputDirectory, 'config.json'), 'utf8')
	]);

	if (!indexHtml.includes('<div id="root"></div>')) {
		throw new Error(`${outputDirectory} is missing the Vite root shell.`);
	}

	const config = JSON.parse(rawConfig);
	const routes = config.routes ?? [];
	const filesystemIndex = routes.findIndex((route) => route.handle === 'filesystem');
	const spaIndex = routes.findIndex((route) => route.src === '/(?:.*)' && route.dest === '/index.html');

	if (filesystemIndex === -1 || spaIndex === -1 || filesystemIndex > spaIndex) {
		throw new Error(`${outputDirectory}/config.json must check filesystem assets before the SPA fallback.`);
	}
}

export async function stageVercelOutput({ sourceDirectory = remixOutputDirectory, destinationDirectory = rootOutputDirectory } = {}) {
	const source = resolve(sourceDirectory);
	const destination = resolve(destinationDirectory);

	if (source === destination) {
		throw new Error('The Remix and repository-root Vercel output directories must differ.');
	}

	// Prove the source before touching a previous root artifact. This makes local
	// reruns failure-safe and prevents a partial Nitro build replacing good output.
	await verifyVercelOutput(source);

	const stagingDirectory = `${destination}.staging-${process.pid}`;
	await rm(stagingDirectory, { force: true, recursive: true });
	await mkdir(dirname(destination), { recursive: true });

	try {
		// Nitro emits relative function aliases such as `[...].func ->
		// ./__server.func`. Node resolves symlink targets while copying unless
		// verbatimSymlinks is enabled, which would make the promoted artifact
		// point back into remix/.vercel/output instead of remaining self-contained.
		await cp(source, stagingDirectory, { recursive: true, verbatimSymlinks: true });
		await verifyVercelOutput(stagingDirectory);
		await rm(destination, { force: true, recursive: true });
		await rename(stagingDirectory, destination);
	} finally {
		await rm(stagingDirectory, { force: true, recursive: true });
	}

	await verifyVercelOutput(destination);
}

function run(command, args, cwd) {
	return new Promise((resolveRun, rejectRun) => {
		const child = spawn(command, args, {
			cwd,
			env: process.env,
			stdio: 'inherit'
		});

		child.once('error', rejectRun);
		child.once('exit', (code, signal) => {
			if (code === 0) {
				resolveRun();
				return;
			}

			rejectRun(new Error(signal ? `${command} was terminated by ${signal}.` : `${command} exited with status ${code}.`));
		});
	});
}

export async function buildForVercel() {
	const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
	await run(corepack, ['pnpm', '--dir', 'remix', 'run', 'build'], repositoryRoot);
	await stageVercelOutput();
	console.log('[vercel-build] Root .vercel/output is ready.');
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
	buildForVercel().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
