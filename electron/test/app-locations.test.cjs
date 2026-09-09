const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { prepareAppLocations } = require('../lib/app-locations.cjs');

async function fixture(t) {
	const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'thingtime-locations-'));
	t.after(() => fs.rm(temp, { recursive: true, force: true }));
	const apps = path.join(temp, 'Applications');
	const desktop = path.join(apps, 'Thingtime.app');
	const helper = path.join(desktop, 'Contents/Helpers/Thingtime Node.app');
	const oldNode = path.join(apps, 'Thingtime Node.app');
	for (const dir of [helper, oldNode, path.join(apps, 'Commander.app'), path.join(apps, '.Commander backup.app'), path.join(apps, 'Unrelated.app')]) await fs.mkdir(dir, { recursive: true });
	const identify = (bundle) => ({ 'Thingtime.app': 'com.thingtime.desktop', 'Thingtime Node.app': 'com.thingtime.desktop.node', 'Commander.app': 'com.thingtime.Commander', '.Commander backup.app': 'com.thingtime.Commander' })[path.basename(bundle)];
	return { root: path.join(temp, 'links'), outerApp: desktop, helperApp: helper, applicationDirs: [apps, path.join(temp, 'missing')], identify };
}
test('uses current embedded Node, includes installed family apps and refreshes idempotently', async (t) => {
	const options = await fixture(t);
	assert.equal((await prepareAppLocations(options)).count, 3);
	assert.equal(await fs.readlink(path.join(options.root, 'Thingtime Node.app')), await fs.realpath(options.helperApp));
	assert.deepEqual((await fs.readdir(options.root)).sort(), ['Commander.app', 'Thingtime Node.app', 'Thingtime.app']);
	await prepareAppLocations(options);
	await fs.rm(path.join(options.applicationDirs[0], 'Commander.app'), { recursive: true });
	await prepareAppLocations(options);
	assert.equal((await fs.readdir(options.root)).length, 2); // Hidden backup must not reappear as Commander.
});
test('refuses a symlinked output folder and preserves user files', async (t) => {
	const options = await fixture(t);
	await fs.symlink(options.applicationDirs[0], options.root);
	await assert.rejects(prepareAppLocations(options), /private folder/);
	await fs.unlink(options.root);
	await fs.mkdir(options.root, { mode: 0o700 });
	const file = path.join(options.root, 'Thingtime.app');
	await fs.writeFile(file, 'keep me');
	await assert.rejects(prepareAppLocations(options), /Move Thingtime.app/);
	assert.equal(await fs.readFile(file, 'utf8'), 'keep me');
});
