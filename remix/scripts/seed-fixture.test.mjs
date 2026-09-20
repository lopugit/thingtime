import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';

import { fixtureFiles, makePng, parseArgs } from './seed-fixture.mjs';

test('seed-fixture arguments are validated and defaulted', () => {
	assert.deepEqual(parseArgs(['create']).files, 3);
	const parsed = parseArgs(['create', '--files', '5', '--name', 'demo-1', '--username', 'fx-demo', '--visibility', 'hidden', '--no-folder', '--dry-run']);
	assert.equal(parsed.files, 5);
	assert.equal(parsed.name, 'demo-1');
	assert.equal(parsed.username, 'fx-demo');
	assert.equal(parsed.visibility, 'hidden');
	assert.equal(parsed.folder, false);
	assert.equal(parsed.dryRun, true);
	assert.deepEqual(parseArgs(['cleanup', 'remix/.fixtures/demo.json']).positional, ['remix/.fixtures/demo.json']);
	assert.equal(parseArgs(['cleanup', '--all']).all, true);
	assert.throws(() => parseArgs(['create', '--files', '99']), /0 to 25/);
	assert.throws(() => parseArgs(['create', '--name', 'Bad Name']), /lowercase/);
	assert.throws(() => parseArgs(['create', '--username', 'x']), /3-32/);
	assert.throws(() => parseArgs(['create', '--visibility', 'friends']), /public, hidden or private/);
	assert.throws(() => parseArgs(['create', '--bogus']), /Unknown option/);
});

test('generated PNGs are structurally valid and distinct per seed', () => {
	const png = makePng(16, 8, 3);
	assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
	assert.equal(png.readUInt32BE(16), 16);
	assert.equal(png.readUInt32BE(20), 8);
	const idatLength = png.readUInt32BE(33);
	assert.equal(png.subarray(37, 41).toString('ascii'), 'IDAT');
	const raw = inflateSync(png.subarray(41, 41 + idatLength));
	assert.equal(raw.byteLength, (16 * 4 + 1) * 8, 'one filter byte per row plus RGBA pixels');
	assert.equal(png.subarray(png.byteLength - 8, png.byteLength - 4).toString('ascii'), 'IEND');
	assert.notDeepEqual(makePng(16, 8, 4), png);
});

test('fixture file sets mix PNG images with one text note and never repeat names', () => {
	const files = fixtureFiles(4);
	assert.deepEqual(files.map((file) => file.contentType), ['image/png', 'image/png', 'image/png', 'text/plain']);
	assert.equal(new Set(files.map((file) => file.name)).size, 4);
	assert.ok(files.every((file) => file.bytes.byteLength > 0));
	assert.deepEqual(fixtureFiles(1).map((file) => file.contentType), ['image/png']);
	assert.deepEqual(fixtureFiles(0), []);
});
