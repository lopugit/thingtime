import { mkdir, mkdtemp, writeFile, copyFile, rename, rm, chmod, lstat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { VERSION, SOURCE, NOTICES, archiveFor, verifyDigest, verifyBundledMongo } = require('../lib/bundled-mongodb.cjs');
if (process.platform !== 'darwin') throw new Error('Bundled MongoDB currently targets the macOS desktop app.');
const arch = process.arch;
const archive = archiveFor(arch);
const electronDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseDir = path.join(electronDir, 'dist/database');
const cache = path.join(homedir(), 'Library/Caches/com.thingtime.desktop/mongodb', VERSION);
await mkdir(cache, { recursive: true, mode: 0o700 });
await mkdir(databaseDir, { recursive: true });

async function obtain(artifact) {
	const destination = path.join(cache, artifact.name);
	try {
		await lstat(destination);
		await verifyDigest(destination, artifact.sha256);
		return destination;
	} catch (error) {
		// A corrupt cached artifact fails the build instead of being trusted or
		// silently replaced. Remove that exact cache entry to retry its download.
		if (error.code !== 'ENOENT') throw error;
	}
	const temporary = `${destination}.${process.pid}.download`;
	try {
		const response = await fetch(artifact.url, { signal: AbortSignal.timeout(180000), redirect: 'error' });
		if (!response.ok || !response.body) throw new Error(`MongoDB download failed (${response.status}).`);
		let size = 0;
		const limit = new Transform({ transform(chunk, _encoding, done) {
			size += chunk.length;
			done(size > 512 * 1024 * 1024 ? new Error('MongoDB archive exceeds its download limit.') : null, chunk);
		} });
		await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
		await verifyDigest(temporary, artifact.sha256);
		await rename(temporary, destination);
		return destination;
	} finally {
		await rm(temporary, { force: true });
	}
}

const binaryArchive = await obtain(archive);
const sourceArchive = await obtain(SOURCE);
const stage = await mkdtemp(path.join(databaseDir, '.mongodb-stage-'));
try {
	// The archive digest is verified before tar sees it. Extract only the
	// server and notices; no Compass installer, shell, or system launch daemon.
	const list = spawnSync('/usr/bin/tar', ['-tzf', binaryArchive], { encoding: 'utf8' });
	if (list.status !== 0) throw new Error('Cannot inspect the pinned MongoDB archive.');
	const members = list.stdout.trim().split('\n');
	const prefix = members[0].split('/')[0];
	if (!/^mongodb-macos-[a-zA-Z0-9_.-]+$/u.test(prefix)) throw new Error('Unexpected MongoDB archive root.');
	const selected = ['bin/mongod', ...NOTICES].map((name) => `${prefix}/${name}`);
	if (selected.some((name) => !members.includes(name))) throw new Error('MongoDB archive is missing its server or license notices.');
	const extracted = spawnSync('/usr/bin/tar', ['-xzf', binaryArchive, '-C', stage, '--strip-components=1', ...selected], { stdio: 'inherit' });
	if (extracted.status !== 0) throw new Error('Cannot extract the pinned MongoDB archive.');
	await chmod(path.join(stage, 'bin/mongod'), 0o755);
	await copyFile(sourceArchive, path.join(stage, SOURCE.name));
	await writeFile(path.join(stage, 'SOURCE.txt'), `MongoDB Community Server ${VERSION}\n\nThe unmodified upstream server is distributed under LICENSE-Community.txt (SSPL).\nCorresponding upstream release source is included in ${SOURCE.name}.\nUpstream source: https://github.com/mongodb/mongo/tree/r${VERSION}\nBuild instructions are in the source archive. Third-party notices are included.\nThingtime starts this server only when the optional local database is enabled.\n`);
	await writeFile(path.join(stage, 'manifest.json'), JSON.stringify({
		version: VERSION, arch, minimumMacOS: '14.0', archiveUrl: archive.url,
		archiveSha256: archive.sha256, sourceUrl: SOURCE.url, sourceSha256: SOURCE.sha256
	}, null, 2) + '\n');
	await verifyBundledMongo(stage);
	await rm(path.join(databaseDir, 'mongodb'), { recursive: true, force: true });
	await rename(stage, path.join(databaseDir, 'mongodb'));
	console.log(`Staged MongoDB Community ${VERSION} (${arch}), source and licenses.`);
} finally {
	await rm(stage, { recursive: true, force: true });
}
