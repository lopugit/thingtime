const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

const APPLICATIONS = Object.freeze({
	'com.thingtime.desktop': 'Thingtime.app',
	'com.thingtime.desktop.node': 'Thingtime Node.app',
	'com.thingtime.desktop.recovery': 'Thingtime Recovery.app',
	'com.thingtime.Commander': 'Commander.app',
	'com.thingtime.ThingDisk': 'ThingDisk.app',
	'com.lopudesigns.ThingDock': 'ThingDock.app'
});

async function bundleIdentifier(bundle) {
	try {
		return (await run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(bundle, 'Contents', 'Info.plist')], { encoding: 'utf8', timeout: 3000 })).stdout.trim();
	} catch { return null; }
}

// Current Desktop and its bundled Node win over older standalone installations.
async function prepareAppLocations({ root, outerApp, helperApp, applicationDirs, identify = bundleIdentifier }) {
	const selected = new Map();
	const consider = async (candidate) => {
		try {
			const resolved = await fs.realpath(candidate);
			if (!(await fs.stat(resolved)).isDirectory()) return;
			const id = await identify(resolved);
			if (Object.hasOwn(APPLICATIONS, id) && !selected.has(id)) selected.set(id, resolved);
		} catch (error) { if (error.code !== 'ENOENT') throw error; }
	};
	for (const candidate of [outerApp, helperApp].filter(Boolean)) await consider(candidate);
	for (const directory of applicationDirs) {
		let entries;
		try { entries = await fs.readdir(directory); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
		const canonicalNames = new Set(Object.values(APPLICATIONS));
		const candidates = entries.filter((name) => !name.startsWith('.') && name.endsWith('.app'));
		candidates.sort((a, b) => Number(canonicalNames.has(b)) - Number(canonicalNames.has(a)) || a.localeCompare(b));
		for (const name of candidates) await consider(path.join(directory, name));
	}
	if (!selected.size) throw new Error('No installed Thingtime apps were found.');
	await fs.mkdir(root, { recursive: true, mode: 0o700 });
	const stat = await fs.lstat(root);
	if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o022)) {
		throw new Error('The App Locations folder must be a private folder owned by you.');
	}
	// Never replace a regular file or folder someone placed here.
	for (const name of Object.values(APPLICATIONS)) {
		try { if (!(await fs.lstat(path.join(root, name))).isSymbolicLink()) throw new Error(`Move ${name} out of App Locations and try again.`); }
		catch (error) { if (error.code !== 'ENOENT') throw error; }
	}
	for (const [id, name] of Object.entries(APPLICATIONS)) {
		const link = path.join(root, name);
		await fs.unlink(link).catch((error) => { if (error.code !== 'ENOENT') throw error; });
		if (selected.has(id)) await fs.symlink(selected.get(id), link);
	}
	return { directory: root, count: selected.size };
}

module.exports = { prepareAppLocations };
