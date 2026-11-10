// Explicit fallback when the installed agent browser manager is unavailable.
// No personal profile, credentials, host mounts, published ports, or network.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { build } from 'vite';
const root = fileURLToPath(new URL('..', import.meta.url));
const artifactRoot = process.env.TT_QA_ARTIFACT_DIR || mkdtempSync(path.join(tmpdir(), 'tt-lopu-credential-qa-'));
const image = process.env.TT_QA_IMAGE,
	seccomp = process.env.TT_QA_SECCOMP;
assert.ok(
	image && seccomp && path.isAbsolute(seccomp),
	'Set TT_QA_IMAGE to an installed isolated runtime and TT_QA_SECCOMP to its Chromium sandbox profile.'
);
const name = `tt-lopu-credentials-${randomUUID()}`;
const args = ['--context', process.env.TT_QA_DOCKER_CONTEXT || 'colima-thingtime-agents'];
const docker = (more, options = {}) => {
	const result = spawnSync('docker', [...args, ...more], { maxBuffer: 64 * 1024 * 1024, ...options });
	if (result.status !== 0 && !options.allowFailure) throw new Error(`Docker ${more[0]} failed: ${result.stderr?.toString()}`);
	return result;
};
mkdirSync(artifactRoot, { recursive: true });
const dist = path.join(artifactRoot, 'dist'),
	results = path.join(artifactRoot, 'results');
mkdirSync(results, { recursive: true });
await build({
	root,
	configFile: false,
	envDir: false,
	resolve: { alias: { '~': `${root}/app` } },
	esbuild: { jsx: 'automatic' },
	build: { outDir: dist, emptyOutDir: true, rollupOptions: { input: `${root}/scripts/lopu-credentials.browser.html` } }
});
let created = false,
	child;
const copyResults = () => {
	const files = docker(
		['exec', name, 'node', '-e', "process.stdout.write(JSON.stringify(require('fs').readdirSync('/home/pwuser/credential-qa/results')))"],
		{ allowFailure: true }
	);
	if (files.status !== 0) return;
	for (const file of JSON.parse(files.stdout)) {
		assert.equal(path.basename(file), file);
		const data = docker(['exec', name, 'cat', `/home/pwuser/credential-qa/results/${file}`], { allowFailure: true });
		if (!data.status) writeFileSync(path.join(results, file), data.stdout);
	}
	const reportPath = path.join(results, 'report.json');
	try {
		const report = readFileSync(reportPath, 'utf8').replaceAll('&', '&amp;').replaceAll('<', '&lt;');
		const shot = readdirSync(results)
			.filter((name) => name.endsWith('.png'))
			.at(-1);
		writeFileSync(
			path.join(results, 'viewer.html'),
			`<meta http-equiv="refresh" content="3"><title>[QA] Lopu credentials</title><h1>Isolated Lopu credential QA</h1><pre>${report}</pre>${
				shot ? `<img style="max-width:100%" src="${shot}">` : ''
			}`
		);
	} catch {
		/* first frame has not arrived */
	}
};
try {
	docker([
		'create',
		'--name',
		name,
		'--label',
		'com.thingtime.qa=lopu-credentials',
		'--network',
		'none',
		'--read-only',
		'--cap-drop',
		'ALL',
		'--security-opt',
		'no-new-privileges=true',
		'--security-opt',
		`seccomp=${seccomp}`,
		'--user',
		'1000:1000',
		'--init',
		'--shm-size',
		'512m',
		'--memory',
		'2g',
		'--cpus',
		'2',
		'--pids-limit',
		'512',
		'--tmpfs',
		'/tmp:rw,nosuid,nodev,size=768m',
		'--tmpfs',
		'/home/pwuser:rw,nosuid,nodev,uid=1000,gid=1000,mode=700,size=1g',
		'--entrypoint',
		'node',
		image,
		'-e',
		'setInterval(()=>{},60000)'
	]);
	created = true;
	const container = JSON.parse(docker(['inspect', name]).stdout)[0],
		host = container.HostConfig;
	assert.equal(host.NetworkMode, 'none');
	assert.equal(host.ReadonlyRootfs, true);
	assert.deepEqual(host.CapDrop, ['ALL']);
	assert.ok(!host.Privileged && !(host.Binds?.length) && !Object.keys(host.PortBindings || {}).length && !container.Mounts.length && host.SecurityOpt.includes('no-new-privileges=true'));
	writeFileSync(
		path.join(results, 'boundary.json'),
		JSON.stringify(
			{
				container: container.Id,
				image: container.Image,
				network: 'none',
				readonlyRootfs: true,
				capDrop: ['ALL'],
				hostMounts: 0,
				ports: 0,
				noNewPrivileges: true
			},
			null,
			2
		)
	);
	docker(['start', name]);
	docker(['exec', name, 'mkdir', '-p', '/home/pwuser/credential-qa/dist']);
	const archive = spawnSync('tar', ['-cf', '-', '-C', dist, '.'], { maxBuffer: 64 * 1024 * 1024 });
	assert.equal(archive.status, 0);
	docker(['exec', '-i', name, 'tar', '-xf', '-', '-C', '/home/pwuser/credential-qa/dist'], { input: archive.stdout });
	docker(['exec', '-i', name, 'sh', '-c', 'cat > /home/pwuser/credential-qa/check.cjs'], {
		input: readFileSync(`${root}/scripts/check-lopu-credentials-browser.cjs`)
	});
	console.log(`Viewer: ${path.join(results, 'viewer.html')}`);
	child = spawn('docker', [...args, 'exec', name, 'node', '/home/pwuser/credential-qa/check.cjs'], { stdio: 'inherit' });
	const interval = setInterval(copyResults, 3000),
		timeout = setTimeout(() => child.kill('SIGTERM'), 240000);
	const code = await new Promise((resolve) => child.once('exit', resolve));
	clearInterval(interval);
	clearTimeout(timeout);
	copyResults();
	assert.equal(code, 0, 'Isolated browser acceptance failed. Inspect the retained report and screenshots.');
} finally {
	if (created) {
		docker(['stop', '--time', '5', name]);
		assert.equal(JSON.parse(docker(['inspect', name]).stdout)[0].State.Running, false);
		docker(['rm', name]);
	}
	console.log(`Evidence retained: ${results}`);
}
