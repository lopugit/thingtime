// Own one disposable replica and all fixture files. No app env or existing DB.
import { isolatedAccountBackupProcess, verifyAccountBackupIsolation } from './account-backup-isolation.mjs';
import { mkdtemp, rm, mkdir, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const mode = process.argv[2] || 'account-profile';
const fixtures = {
  'account-profile': { marker: 'accountProfileBackupProof', script: 'scripts/account-profile-backup.integration.mts', port: 28142 },
  'file-restore': { marker: 'accountFileRestoreProof', script: 'scripts/account-file-restore.integration.mts', port: 28167 },
  'ordinary-restore': { marker: 'ordinaryRestoreProof', script: 'scripts/ordinary-restore.integration.mts', port: 28143 },
  'reference-closure': { marker: 'accountReferenceBackupProof', script: 'scripts/account-reference-backup.integration.mts', port: 28162 }
};
if (!Object.hasOwn(fixtures, mode) || process.argv.length > 3) throw Error('Unsupported account backup proof');
const proofFiles = ['app/api/utils/backups/accountFileRestore.ts','app/api/utils/backups/accountFileRestoreBytes.ts','app/api/utils/backups/accountFileRecovery.ts','app/api/utils/backups/accountInventory.ts','app/api/utils/backups/attachmentRecords.ts','app/api/utils/backups/portableBackup.ts','app/api/utils/files/files.ts','app/api/utils/things/contentExecutionGate.ts','app/api/utils/timeline/recordMutation.ts','app/fileSync/cloudTransport.ts','app/docs/apiDocs.ts','scripts/account-file-restore.integration.mts'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(proofFiles.map(async path => [path, createHash('sha256').update(await readFile(resolve(import.meta.dirname, '..', path))).digest('hex')])));
const initialSourceHashes = mode === 'file-restore' ? await sourceHashes() : null;
const testedGitBase = mode === 'file-restore' ? execFileSync('git',['rev-parse','HEAD'],{cwd:resolve(import.meta.dirname,'../..'),encoding:'utf8'}).trim() : null;
const fixture = fixtures[mode];
const proofMarker = fixture.marker;
const port = fixture.port;
const probe = createServer();
await new Promise((resolve, reject) => {
	probe.once('error', reject);
	probe.listen(port, '127.0.0.1', resolve);
});
await new Promise((resolve) => probe.close(resolve));
const directory = await mkdtemp(join(tmpdir(), 'thingtime-account-profile-backup-'));
await chmod(directory, 0o700);
await mkdir(join(directory, 'db'));
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR || tmpdir() };
const uri = `mongodb://127.0.0.1:${port}/thingtime?replicaSet=account-profile-backup`;
try {
	await verifyAccountBackupIsolation(port, env);
} catch (error) {
	await rm(directory, { recursive: true, force: true });
	throw error;
}
const mongo = isolatedAccountBackupProcess(
	process.env.THINGTIME_TEST_MONGOD || 'mongod',
	[
		'--bind_ip',
		'127.0.0.1',
		'--port',
		String(port),
		'--dbpath',
		join(directory, 'db'),
		'--replSet',
		'account-profile-backup',
		'--logpath',
		join(directory, 'mongod.log'),
		'--wiredTigerCacheSizeGB',
		'0.25',
		'--nounixsocket'
	],
	{ env, stdio: 'ignore' },
	port,
	true
);
let child,
	cancelled = false;
const stopped = once(mongo, 'exit').catch(() => []);
const terminate = () => {
	cancelled = true;
	child?.kill('SIGTERM');
	mongo.kill('SIGTERM');
};
process.once('SIGTERM', terminate);
process.once('SIGINT', terminate);
try {
	// mongosh's initial selection timeout can expire while mongod is still
	// creating its data files. Wait for THIS child's readiness, not a guessed
	// sleep or a connection to whichever process happens to own the port.
	const deadline = Date.now() + 30000;
	let ready = false;
	while (Date.now() < deadline && !ready) {
		assert.ok(!cancelled && mongo.exitCode === null && mongo.signalCode === null, 'Disposable mongod stopped before readiness');
		const log = await readFile(join(directory, 'mongod.log'), 'utf8').catch((error) => {
			if (error.code === 'ENOENT') return '';
			throw error;
		});
		ready = log.includes('"msg":"Waiting for connections"');
		if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
	}
	assert.ok(ready && !cancelled, 'Disposable mongod did not become ready');
	const shell = isolatedAccountBackupProcess(
		'mongosh',
		[
			'--quiet',
			`mongodb://127.0.0.1:${port}/?directConnection=true`,
			'--eval',
			`rs.initiate({_id:'account-profile-backup',members:[{_id:0,host:'127.0.0.1:${port}'}]}); while(!db.hello().isWritablePrimary){sleep(100)}`
		],
		{ env, stdio: ['ignore', 'pipe', 'pipe'] },
		port
	);
	child = shell;
	let bootstrapOutput = '';
	shell.stdout.on('data', (b) => (bootstrapOutput += b));
	shell.stderr.on('data', (b) => (bootstrapOutput += b));
	const bootstrapTimer = setTimeout(() => shell.kill('SIGTERM'), 30000);
	const [bootstrapCode] = await once(shell, 'exit');
	clearTimeout(bootstrapTimer);
	assert.equal(bootstrapCode, 0, 'Disposable replica bootstrap failed: ' + bootstrapOutput.slice(-1000));
	assert.equal(cancelled, false, 'Fixture was cancelled');
	child = isolatedAccountBackupProcess(
		process.execPath,
		['--import', 'tsx', fixture.script],
		{
			cwd: resolve(import.meta.dirname, '..'),
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {
				...env,
				MONGODB_CONNECTION_STRING: uri,
				THINGTIME_ACCOUNT_PROFILE_TEST_DIRECTORY: directory,
				THINGTIME_EMAIL_PROVIDER: 'console',
				NODE_ENV: 'test'
			}
		},
		port
	);
	let output = '';
	child.stdout.on('data', (b) => (output += b));
	child.stderr.on('data', (b) => (output += b));
	const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
	const [code] = await once(child, 'exit');
	clearTimeout(timer);
	// Console email output can include one-use fixture links. Never forward it.
	const result = output.split('\n').find((line) => line.startsWith('{"' + proofMarker + '":'));
	if (code !== 0 || !result) {
		const { writeFile } = await import('node:fs/promises');
		const failureLog = join(tmpdir(), `thingtime-${mode}-backup-failure.log`);
		await writeFile(failureLog, output.replace(/https?:\/\/[^\s"<>]+/g, '[url withheld]'), { mode: 0o600 });
		throw Error('Account profile API proof failed; private diagnostic log: ' + failureLog);
	}
	let evidence;
 if (mode === 'file-restore') {
  assert.deepEqual(await sourceHashes(), initialSourceHashes, 'Runtime source changed during the proof; preserve stdout but do not publish it as final-source acceptance');
  const { writeFile, mkdir, chmod } = await import('node:fs/promises');
  const evidenceRoot = join(tmpdir(),'thingtime-account-file-restore-evidence'); await mkdir(evidenceRoot,{recursive:true,mode:0o700}); await chmod(evidenceRoot,0o700);
  const receipt = { ...JSON.parse(result), command: 'corepack pnpm --dir remix run test:backups:file-restore', testedGitBase, sourceFiles: initialSourceHashes, recordedAt: new Date().toISOString() };
  const bytes = JSON.stringify(receipt), digest = createHash('sha256').update(bytes).digest('hex');
  evidence = join(evidenceRoot,`${Date.now()}-${digest}.json`); await writeFile(evidence,bytes+'\n',{mode:0o600,flag:'wx'});
 }
 console.log(JSON.stringify({ ...JSON.parse(result), ...(evidence ? { evidence } : {}), isolation: 'OS-enforced loopback-only; redirects, hostname and direct-IP denial verified' }));
} finally {
	terminate();
	await stopped;
	await rm(directory, { recursive: true, force: true });
}
