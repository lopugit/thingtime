/** Real compiled frontend/API route proof. Disposable identities and backend;
 * no personal profile, app settings, mock API response or direct DB content. */
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const root = resolve(import.meta.dirname, '..');
try { createRequire(join(root,'../MCP/package.json')).resolve('playwright'); } catch { throw Error('Install the declared browser dependency with npm --prefix MCP ci; see TESTING.md.'); }
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-restore-route-evidence'));
const bundle = resolve(process.env.THINGTIME_ROUTE_TEST_SERVER_BUNDLE || join(root, '.output/server/index.mjs'));
const runtimeFiles = [
	'app/routes/thing.tsx',
	'app/components/Builder/ContentExecutionHold.tsx',
	'app/components/Builder/liveComponent.tsx',
	'app/api/utils/capabilities/requireCapability.client.ts'
];
const hashes = async () =>
	Object.fromEntries(
		await Promise.all(
			runtimeFiles.map(async (file) => [
				file,
				createHash('sha256')
					.update(await readFile(join(root, file)))
					.digest('hex')
			])
		)
	);
const source = {
	head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
	sourceTree: JSON.parse(execFileSync(process.execPath, ['../scripts/graphify-cas.mjs', 'fingerprint'], {cwd:root,encoding:'utf8'})),
	runtime: await hashes(),
	clientIndex: createHash('sha256')
		.update(await readFile(join(root, 'dist/index.html')))
		.digest('hex'),
	serverEntry: createHash('sha256')
		.update(await readFile(bundle))
		.digest('hex')
};
assert.match(
	await readFile(bundle, 'utf8'),
	/export \{[^}]*middleware/,
	'Pass a compiled Nitro node_middleware server; no guessed adapter fallback.'
);
for (const port of [28166, 28167]) {
	const probe = createServer();
	await new Promise((ok, fail) => {
		probe.once('error', fail);
		probe.listen(port, '127.0.0.1', ok);
	});
	await new Promise((ok) => probe.close(ok));
}
const scratch = await mkdtemp(join(tmpdir(), 'thingtime-real-restore-route-'));
await mkdir(evidence, { recursive: true, mode: 0o700 });
for (const file of ['failure.json', 'failure.png', 'failure-visible.txt']) await rm(join(evidence, file), { force: true });
let child;
try {
	await cp(dirname(bundle), join(scratch, 'server'), { recursive: true });
	await cp(join(root, 'dist'), join(scratch, 'client'), { recursive: true });
	assert.equal(
		createHash('sha256')
			.update(await readFile(join(scratch, 'client/index.html')))
			.digest('hex'),
		source.clientIndex,
		'Client build changed during artifact capture'
	);
	child = spawn(process.execPath, ['--import', 'tsx', 'scripts/restore-execution-route.integration.mts'], {
		cwd: root,
		env: {
			PATH: process.env.PATH,
			HOME: process.env.HOME,
			TMPDIR: scratch,
			NODE_ENV: 'test',
			JWT_SECRET: randomBytes(32).toString('hex'),
			THINGTIME_ROUTE_TEST_DIRECTORY: evidence,
			THINGTIME_ROUTE_TEST_DATABASE_DIRECTORY: join(scratch, 'db'),
			THINGTIME_ROUTE_TEST_SOURCE: JSON.stringify(source),
			THINGTIME_ROUTE_TEST_CLIENT: join(scratch, 'client'),
			THINGTIME_ROUTE_TEST_BUNDLE: join(scratch, 'server/index.mjs')
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let output = '';
	child.stdout.on('data', (part) => (output += part));
	child.stderr.on('data', (part) => (output += part));
	const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
	const [code] = await once(child, 'exit');
	clearTimeout(timer);
	await writeFile(join(evidence, 'run.log'), output.replace(/https?:\/\/[^\s"<>]+/g, '[url withheld]'), { mode: 0o600 });
	assert.deepEqual(await hashes(), source.runtime, 'Runtime sources changed during acceptance');
	assert.equal(code, 0, 'Real restore route proof failed; see private evidence ' + evidence);
	console.log('PASS real compiled /thing route; evidence ' + evidence);
} finally {
	if (child?.exitCode === null) child.kill('SIGTERM');
	await rm(scratch, { recursive: true, force: true });
}
