'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { archiveFor, verifyDigest, verifyBundledMongo, VERSION, SOURCE } = require('../lib/bundled-mongodb.cjs');

test('download verification rejects tampering and symlinks before extraction', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'thingtime-mongo-integrity-'));
	try {
		const file = path.join(root, 'archive');
		await fs.writeFile(file, 'original');
		const digest = crypto.createHash('sha256').update('original').digest('hex');
		await verifyDigest(file, digest);
		await fs.symlink(file, path.join(root, 'link'));
		await assert.rejects(verifyDigest(path.join(root, 'link'), digest), /checksum/);
		await fs.writeFile(file, 'tampered');
		await assert.rejects(verifyDigest(file, digest), /checksum/);
	} finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('release verification rejects wrong architecture and incomplete bundled database', async () => {
	assert.throws(() => archiveFor('universal'), /does not support/);
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'thingtime-mongo-release-'));
	try {
		await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ version: 'old', arch: 'arm64' }));
		await assert.rejects(verifyBundledMongo(root, { arch: 'arm64' }), /pinned release/);
		await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({
			version: VERSION, arch: 'arm64', archiveSha256: archiveFor('arm64').sha256, sourceSha256: SOURCE.sha256
		}));
		await assert.rejects(verifyBundledMongo(root, { arch: 'arm64' }), { code: 'ENOENT' });
	} finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('candidate MongoDB code runs only after trust verification and new builds require the bundle', async () => {
	const scripts = path.join(__dirname, '../scripts');
	const signed = await fs.readFile(path.join(scripts, 'verify-signed-app.mjs'), 'utf8');
	assert.ok(signed.indexOf('await verifyBundledMongo(') > signed.indexOf('await verifySignedArtifacts('));
	assert.ok(signed.indexOf('await verifyBundledMongo(') > signed.indexOf("stapler', 'validate'"));
	assert.match(signed, /pinned: requireBundledMongo, execute: requireBundledMongo/u);
	assert.match(signed, /requireBundledMongo \|\| existsSync\(mongoRoot\)/u);
	for (const script of ['build-local-app.mjs', 'build-production-app.mjs', 'build-unsigned-release.mjs']) {
		assert.match(await fs.readFile(path.join(scripts, script), 'utf8'), /'--require-bundled-mongo'/u);
	}
});
