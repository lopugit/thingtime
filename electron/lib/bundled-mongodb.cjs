'use strict';

const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Official Community archives, pinned from https://downloads.mongodb.org/full.json.
// Never resolve a floating version while building or on a user's machine.
const VERSION = '8.0.34';
const ARCHIVES = Object.freeze({
	arm64: { name: `mongodb-macos-arm64-${VERSION}.tgz`, sha256: '3255cbf2e70cc5de04220046e006067d20068656d1bfa674828768a51d20d5a6' },
	x64: { name: `mongodb-macos-x86_64-${VERSION}.tgz`, sha256: '3d391b8c41df069671afaa88ca21def057178aecce1813437539143b71f28152' }
});
const SOURCE = Object.freeze({
	name: `mongodb-source-${VERSION}.tar.gz`,
	url: `https://codeload.github.com/mongodb/mongo/tar.gz/refs/tags/r${VERSION}`,
	sha256: 'b86778267f530e430fc3013a37578e9698cf9b58aa185e93f0cf5c8e92465974'
});
const NOTICES = ['LICENSE-Community.txt', 'MPL-2', 'THIRD-PARTY-NOTICES', 'README'];

function archiveFor(arch) {
	const archive = ARCHIVES[arch];
	if (!archive) throw new Error(`Bundled MongoDB does not support architecture ${arch}.`);
	return { ...archive, url: `https://fastdl.mongodb.org/osx/${archive.name}` };
}
async function digest(file) {
	const hash = crypto.createHash('sha256');
	for await (const chunk of createReadStream(file)) hash.update(chunk);
	return hash.digest('hex');
}
async function verifyDigest(file, expected) {
	if ((await fs.lstat(file)).isSymbolicLink() || await digest(file) !== expected) throw new Error('MongoDB artifact checksum verification failed.');
}
async function verifyBundledMongo(root, { run = spawnSync, arch = process.arch, execute = true, pinned = true } = {}) {
	const archive = archiveFor(arch);
	const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
	if (!/^\d+\.\d+\.\d+$/u.test(manifest.version) || !/^[a-f0-9]{64}$/u.test(manifest.sourceSha256) ||
		(pinned && (manifest.version !== VERSION || manifest.arch !== arch || manifest.archiveSha256 !== archive.sha256 || manifest.sourceSha256 !== SOURCE.sha256)))
		throw new Error('Bundled MongoDB manifest does not match the pinned release.');
	const sourceName = `mongodb-source-${manifest.version}.tar.gz`;
	for (const name of ['bin/mongod', ...NOTICES, sourceName, 'SOURCE.txt']) {
		const stat = await fs.lstat(path.join(root, name));
		if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error('Bundled MongoDB artifact is missing or invalid.');
	}
	await fs.access(path.join(root, 'bin/mongod'), fs.constants.X_OK);
	await verifyDigest(path.join(root, sourceName), manifest.sourceSha256);
	if (execute) {
		const result = run(path.join(root, 'bin/mongod'), ['--version'], { encoding: 'utf8', timeout: 30000 });
		if (result.error || result.status !== 0 || !result.stdout?.startsWith(`db version v${manifest.version}\n`))
			throw new Error('Bundled mongod cannot execute or has the wrong version.');
	}
	return manifest;
}
module.exports = { VERSION, SOURCE, NOTICES, archiveFor, digest, verifyDigest, verifyBundledMongo };
